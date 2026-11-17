/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Resident world clock.
 *
 * The observatory / community page refreshes a short `heartbeatUntil`
 * presence lease. Sweeps only advance worlds with someone on the page.
 * MiniMax talks need presence plus leftover hourly budget (and a key).
 * An open stake board is served first so evidence is not starved.
 */

import { and, eq, gt, inArray, isNotNull, or, sql } from 'drizzle-orm';

import { runDeepMindBeat, runOneForecastJob } from './deepMindBeat.js';

import {
  loadSocietyAgents,
  loadSocietyConverseCooldown,
  loadSocietyMemoriesForAgents,
  loadSocietyPlans,
  loadSocietyRelations,
  persistEmergenceReport,
  persistSocietyState,
  pruneSocietyHistory,
  loadOccupancyModel,
  loadObjectTip,
  loadLatestObjectStateEvents,
  loadRecentSocietyEvents,
  worlds,
  type DrizzleDb,
} from '@opengame/platform-db';
import {
  acquireRedisLock,
  leaseActive,
  pickSocietyLlmLane,
  orderLiveWorldsForCourse,
  pacedTalkSlotsThisWalk,
  societyTalkMinutesLeftInHour,
  societyTalkMuteReason,
  societyWorldLockKey,
  worldBelongsToShard,
  type RedisLikeForLock,
} from '@opengame/platform-shared';
import {
  consumeEmergencySocietyTalk,
  peekSocietyTalkBudget,
  releaseSocietyTalks,
  reserveSocietyTalks,
  settleSocietyTalks,
  societyTalkBudgetOpen,
  type SocietyTalkBudgetRedis,
} from './societyTalkBudget.js';
import {
  asTalkRetryRedis,
  drainTalkPersistRetry,
  enqueueTalkPersistRetry,
} from './talkPersistRetry.js';
import { gatheringInvitationText, gatheringSeedText, openingRumorFromSpec, parseWorldSpec, anonymousLeadName } from '@opengame/world-spec';
import {
  buildEmergenceReportCard,
  embedderFromEnv,
  lastConverseAtFromEvents,
  mergePersistedMemories,
  overlayPersistedSociety,
  societyStateFromSpec,
  stepSociety,
  finishSocietyTalks,
  replayPersistedObjectStates,
  applyGoalFromEvents,
  applyOccupancySnapshot,
  snapshotWorldObjects,
  isCensusSpeech,
  type HeldTalk,
  type LlmTextFn,
  type PendingSocietyTalk,
  type SocietyEvent,
  type SocietyState,
  activeAgentIds,
  moderateSocietyEvents,
  preferredTaskLane,
  FRAME_MAX_BYTES,
  SOCIETY_FRAME_VERSION,
  shouldKeyframe,
  trimFrameForBudget,
} from '@opengame/world-agents';

import { createSocietyLlm, societyTalkTimeoutMs } from './societyRunner.js';
import { isGenerationBusy } from './generationBusy.js';
import { loadCourseSteeringHintForWorker } from './courseSteeringLoader.js';
import { createTalkScheduler, laneForParticipants } from './talkScheduler.js';
import {
  absorbReflections,
  absorbTalkOutcomes,
  beginTownMind,
  mindFor,
  mindOnFor,
  plantCommitments,
  saveTownMind,
  takeTownLlm,
  townMindFrame,
  townMindTalkOpts,
} from './societyMindTick.js';
import { worldIdsWithLiveCourseStakes } from './courseTalkPriority.js';

export interface SocietyHeartbeatOptions {
  readonly db: DrizzleDb;
  readonly redis: RedisLikeForLock;
  /** Publishes `society:<worldId>` frames so viewers stream instead of polling. */
  readonly publish?: (channel: string, message: string) => Promise<unknown>;
  /** Hourly MiniMax talk caps. Missing Redis fails closed for talks. */
  readonly talkBudget?: SocietyTalkBudgetRedis;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function envFloat(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** A dialogue event that actually carries spoken turns (not a failure marker). */
function isSpokenDialogue(e: SocietyEvent): boolean {
  return e.kind === 'dialogue' && e.payload['skipped'] !== true;
}

/** Drop template/census recitals from the live frame so the stage does not look busy. */
function publishableSocietyEvents(
  events: readonly SocietyEvent[],
): SocietyEvent[] {
  const out: SocietyEvent[] = [];
  for (const e of events) {
    if (e.kind !== 'dialogue') {
      out.push(e);
      continue;
    }
    // A failed beat carries no turns but must still reach the stage — silence
    // reads as a boring town, a marker reads as a model problem.
    if (e.payload['skipped'] === true) {
      out.push(e);
      continue;
    }
    if (e.payload['degraded'] === true) continue;
    const turns = Array.isArray(e.payload['turns'])
      ? (e.payload['turns'] as Array<{ text?: unknown }>)
      : [];
    const kept = turns.filter((row) => {
      const text = typeof row?.text === 'string' ? row.text.trim() : '';
      return text.length >= 4 && !isCensusSpeech(text);
    });
    if (!kept.length) continue;
    out.push({
      ...e,
      payload: { ...e.payload, turns: kept },
    });
  }
  return out;
}

function heartbeatEnabled(): boolean {
  const raw = (process.env['PLATFORM_SOCIETY_HEARTBEAT'] ?? '1').toLowerCase();
  return raw !== '0' && raw !== 'false' && raw !== 'off';
}

function heartbeatLlmEnabled(): boolean {
  const raw = (process.env['PLATFORM_SOCIETY_HEARTBEAT_LLM'] ?? '1').toLowerCase();
  return raw !== '0' && raw !== 'false' && raw !== 'off';
}

/** Wall-clock ms between heartbeat sweeps. */
function intervalMs(): number {
  const n = envInt('PLATFORM_SOCIETY_HEARTBEAT_INTERVAL_MS', 2_000);
  return Math.max(500, Math.min(n, 2_000));
}

/** Sim-hours advanced per heartbeat step. */
function dtHours(): number {
  const n = envFloat('PLATFORM_SOCIETY_DT_HOURS', 0.25);
  return n > 0 ? Math.min(1, n) : 0.25;
}

/** Cap on worlds advanced per sweep, so one busy instance cannot stall others. */
function maxWorldsPerSweep(): number {
  return Math.max(1, envInt('PLATFORM_SOCIETY_HEARTBEAT_MAX_WORLDS', 8));
}

function workerShards(): { readonly index: number; readonly count: number } {
  const count = Math.max(1, envInt('OPENGAME_WORKER_SHARDS', 1));
  const index = envInt('OPENGAME_WORKER_SHARD', 0);
  return { index, count };
}

/** How many worlds in this sweep may walk at the same time. 1 keeps the old order. */
function sweepParallel(): number {
  return Math.max(1, envInt('OPENGAME_WORLD_SWEEP_PARALLEL', 1));
}

/** How long a heartbeat walk may hold the world lock. Talks run after unlock. */
function walkLockTtlMs(): number {
  return Math.max(8_000, envInt('PLATFORM_SOCIETY_WALK_LOCK_MS', 20_000));
}

function talkTimeoutMs(): number {
  return societyTalkTimeoutMs();
}

/** Talks (model-backed or heuristic) attempted per heartbeat walk. */
const DEFAULT_TALKS_PER_STEP = 2;
/**
 * Model talks queued on one walk. The hourly 36/80 cap is spread by
 * {@link pacedTalkSlotsThisWalk}; this is only the per-walk ceiling.
 */
const DEFAULT_LLM_TALKS_PER_STEP = 2;
/** Plan / reflect / importance calls per walk, shared across the town. */
const DEFAULT_PLAN_LLM_PER_STEP = 4;
/** How many agents may re-plan with the model per walk. */
const DEFAULT_REACT_LLM_PER_STEP = 3;

/**
 * Model-backed talks queued on one walk. Do not lift a `.env` of 1 up to a
 * floor — that used to fire six MiniMax circles every 3s and dump the hour.
 * Set 0 to mute model talks without muting the walk.
 */
function llmTalksPerStep(talks: number, useLlm: boolean): number {
  if (!useLlm) return 0;
  const n = envInt(
    'PLATFORM_SOCIETY_MAX_LLM_TALKS_PER_STEP',
    DEFAULT_LLM_TALKS_PER_STEP,
  );
  if (n <= 0) return 0;
  return Math.min(talks, Math.max(n, DEFAULT_LLM_TALKS_PER_STEP));
}

/**
 * Amortized plan / reflect / importance calls. Talks have a separate cap.
 *
 * This was 1, which meant almost every resident fell back to the heuristic
 * schedule and the town looked scripted.
 */
function planLlmPerStep(useLlm: boolean): number {
  if (!useLlm) return 0;
  return Math.max(
    0,
    envInt('PLATFORM_SOCIETY_MAX_PLAN_LLM_PER_STEP', DEFAULT_PLAN_LLM_PER_STEP),
  );
}

/** Agents allowed to re-plan mid-step in reaction to what they just observed. */
function reactLlmPerStep(useLlm: boolean): number {
  if (!useLlm) return 0;
  return Math.max(
    0,
    envInt(
      'PLATFORM_SOCIETY_MAX_REACT_LLM_PER_STEP',
      DEFAULT_REACT_LLM_PER_STEP,
    ),
  );
}

/** Importance-ranked memory rows hydrated per agent each walk. */
function memoryHydrationPerAgent(): number {
  return Math.max(8, envInt('PLATFORM_SOCIETY_MEMORY_PER_AGENT', 48));
}

/** Recency-ranked rows hydrated per agent, on top of the importance slice. */
function memoryHydrationRecentPerAgent(): number {
  return Math.max(0, envInt('PLATFORM_SOCIETY_MEMORY_RECENT_PER_AGENT', 24));
}

let _embedder: ReturnType<typeof embedderFromEnv> | undefined;
function heartbeatEmbedder(): ReturnType<typeof embedderFromEnv> {
  _embedder ??= embedderFromEnv();
  return _embedder;
}

/** Concurrent talk batches across all worlds. */
function talkParallelCap(): number {
  return Math.max(1, envInt('PLATFORM_SOCIETY_MAX_PARALLEL_TALKS', 8));
}

const lastPoseSigByWorld = new Map<string, Map<string, string>>();
const lastFrameSigByWorld = new Map<string, Map<string, string>>();
const frameSeqByWorld = new Map<string, number>();

function poseSigOf(a: {
  x: number;
  y: number;
  regionId: string;
  currentAction: string;
}): string {
  return `${a.x.toFixed(1)}|${a.y.toFixed(1)}|${a.regionId}|${a.currentAction}`;
}

/** Undefined means write every resident. Empty means nothing moved. */
function changedPoseKeys(
  worldId: string,
  agents: ReadonlyArray<{
    id: string;
    x: number;
    y: number;
    regionId: string;
    currentAction: string;
  }>,
): string[] | undefined {
  if (process.env['OPENGAME_POSE_DELTA'] !== '1') return undefined;
  const prev = lastPoseSigByWorld.get(worldId) ?? new Map<string, string>();
  const next = new Map<string, string>();
  const changed: string[] = [];
  for (const agent of agents) {
    const sig = poseSigOf(agent);
    next.set(agent.id, sig);
    if (prev.get(agent.id) !== sig) changed.push(agent.id);
  }
  lastPoseSigByWorld.set(worldId, next);
  return changed;
}

const talkScheduler = createTalkScheduler({
  cap: talkParallelCap,
  onError: (worldId, err) => {
    console.warn('[society-heartbeat] background talk failed', worldId, err);
  },
});

function enqueueWorldTalk(
  worldId: string,
  lane: string,
  run: () => Promise<void>,
): void {
  talkScheduler.enqueue(worldId, run, { lane });
}

/**
 * Concurrent talk batches allowed per world.
 *
 * The scheduler used to chain a world's batches end to end, so a walk's
 * conversations could not start until the previous MiniMax round finished — with
 * 3s walks and multi-second calls the town was quiet most of the time.
 */
function worldTalkLaneCap(): number {
  return Math.max(1, envInt('PLATFORM_SOCIETY_MAX_WORLD_TALK_LANES', 3));
}

/** Extra converse jobs queued while a world's MiniMax call is still running. */
const talkBacklogByWorld = new Map<string, PendingSocietyTalk[]>();
/** Wall-clock of the last reserved MiniMax talk, for hourly pacing. */
const lastTalkReservedAt = new Map<string, number>();
/** Stamp onto the next walk so those residents stay put. */
const heldTalksByWorld = new Map<string, HeldTalk[]>();
/** Last heuristic report card, attached to SSE so the inspector updates live. */
const lastReportByWorld = new Map<
  string,
  ReturnType<typeof buildEmergenceReportCard>
>();
/** Wall-clock of the last walk per world, so idle worlds release their caches. */
const lastTouchedByWorld = new Map<string, number>();

/**
 * How long a world's per-world caches survive without a walk.
 *
 * A worker that has served many projects otherwise keeps a report card and a
 * held-talk list for every world it ever advanced.
 */
const WORLD_CACHE_TTL_MS = 30 * 60_000;

export function evictIdleWorldCaches(
  now: number,
  maps: ReadonlyArray<Map<string, unknown>>,
  touched: Map<string, number>,
  ttlMs = WORLD_CACHE_TTL_MS,
): number {
  let dropped = 0;
  for (const [worldId, at] of touched) {
    if (now - at <= ttlMs) continue;
    touched.delete(worldId);
    for (const m of maps) m.delete(worldId);
    dropped += 1;
  }
  return dropped;
}

function jobsToHeld(
  jobs: readonly PendingSocietyTalk[],
  simTime: number,
): HeldTalk[] {
  return jobs.map((j) => ({
    participantIds: j.people.map((p) => p.id),
    names: Object.fromEntries(j.people.map((p) => [p.id, p.name])),
    sinceSimTime: simTime,
  }));
}

function rememberHeld(
  worldId: string,
  jobs: readonly PendingSocietyTalk[],
  simTime: number,
): void {
  if (!jobs.length) return;
  heldTalksByWorld.set(worldId, [
    ...(heldTalksByWorld.get(worldId) ?? []),
    ...jobsToHeld(jobs, simTime),
  ]);
}

function forgetHeld(worldId: string, jobs: readonly PendingSocietyTalk[]): void {
  const ids = new Set(jobs.flatMap((j) => j.people.map((p) => p.id)));
  const left = (heldTalksByWorld.get(worldId) ?? []).filter(
    (h) => !h.participantIds.some((id) => ids.has(id)),
  );
  if (left.length) heldTalksByWorld.set(worldId, left);
  else heldTalksByWorld.delete(worldId);
}

interface LiveWorldRow {
  readonly id: string;
  readonly projectId: string;
  readonly specJson: unknown;
  readonly heartbeatUntil: Date | null;
  readonly townTimeUntil: Date | null;
  readonly authorWatchUntil: Date | null;
  readonly lightUntil?: Date | null;
  readonly lightBonusPerHour?: number | null;
  readonly clockPaused?: boolean;
  readonly mindEnabled?: boolean | null;
}

function worldLightOpts(world: {
  readonly lightUntil?: Date | string | null;
  readonly lightBonusPerHour?: number | null;
}) {
  return {
    leaseBonus: world.lightBonusPerHour ?? 0,
    litUntil: world.lightUntil ?? null,
  };
}

/** Presence lease — someone is on the page. */
export function viewerLeaseActive(
  until: Date | string | null | undefined,
): boolean {
  return leaseActive(until);
}

/**
 * Worlds with an unexpired observer lease. Generated towns that nobody is
 * watching must not keep MiniMax busy (or starve the open observatory).
 */
/** Comma-separated world ids that keep walking (and talking, under caps) with nobody watching. */
export function demoWarmWorldIds(): readonly string[] {
  const raw = process.env['PLATFORM_DEMO_WORLD_IDS'] ?? '';
  return raw
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

async function selectLiveWorlds(
  db: DrizzleDb,
  limit: number,
): Promise<LiveWorldRow[]> {
  const warm = demoWarmWorldIds();
  const shard = workerShards();
  const watched = and(
    isNotNull(worlds.heartbeatUntil),
    gt(worlds.heartbeatUntil, new Date()),
  );
  const rows = await db
    .select({
      id: worlds.id,
      projectId: worlds.projectId,
      specJson: worlds.specJson,
      heartbeatUntil: worlds.heartbeatUntil,
      townTimeUntil: worlds.townTimeUntil,
      authorWatchUntil: worlds.authorWatchUntil,
      lightUntil: worlds.lightUntil,
      lightBonusPerHour: worlds.lightBonusPerHour,
      clockPaused: worlds.clockPaused,
      mindEnabled: worlds.mindEnabled,
    })
    .from(worlds)
    .where(
      and(
        eq(worlds.clockPaused, false),
        warm.length > 0 ? or(watched, inArray(worlds.id, [...warm])) : watched,
        sql`exists (select 1 from deployments d where d.project_id = ${worlds.projectId} and d.channel = 'preview')`,
      ),
    )
    .orderBy(sql`${worlds.lastHeartbeatAt} ASC NULLS FIRST`)
    .limit(shard.count > 1 ? limit * shard.count : limit);
  const picked = (rows as LiveWorldRow[]).filter((row) =>
    worldBelongsToShard(row.id, shard.index, shard.count),
  );
  return picked.slice(0, limit);
}

/** Advance one world by one walk. Talks are queued on state.pendingTalks. */
async function advanceWorld(
  input: SocietyHeartbeatOptions & {
    readonly world: LiveWorldRow;
    readonly llm?: LlmTextFn;
    readonly llmLit?: LlmTextFn;
    /** Generation owns MiniMax: keep walking, mute talks. */
    readonly muteTalks?: boolean;
    readonly muteReason?:
      | 'generate'
      | 'no_key'
      | 'unwatched'
      | 'no_permit'
      | 'budget'
      | 'keys_exhausted';
    readonly keepAlive?: boolean;
  },
): Promise<{
  events: SocietyEvent[];
  pendingTalks: NonNullable<SocietyState['pendingTalks']>;
  state: SocietyState | null;
  publishFrame: ((events: readonly SocietyEvent[]) => Promise<void>) | null;
}> {
  const empty = {
    events: [] as SocietyEvent[],
    pendingTalks: [] as NonNullable<SocietyState['pendingTalks']>,
    state: null as SocietyState | null,
    publishFrame: null as
      | ((events: readonly SocietyEvent[]) => Promise<void>)
      | null,
  };
  const { db, world } = input;
  const [alive] = await db
    .select({ id: worlds.id })
    .from(worlds)
    .where(eq(worlds.id, world.id))
    .limit(1);
  if (!alive) return empty;

  await db
    .update(worlds)
    .set({ lastHeartbeatAt: new Date() })
    .where(eq(worlds.id, world.id))
    .catch(() => undefined);

  const spec = parseWorldSpec(world.specJson);
  const npcs = spec.entities.filter((e) => e.kind === 'npc');
  if (npcs.length < 2) return empty;

  const state = societyStateFromSpec(spec);
  // Per-agent window (not a global tip-40): plans and retrieval need yesterday's
  // reflections, which a town-wide importance ranking routinely drops. The 12
  // rows this used to load were also all high-importance, so residents lost the
  // ordinary recent events that make a fresh line possible.
  const [agents, plans, relations, memories, tip, occupancy] = await Promise.all([
    loadSocietyAgents(db, world.id),
    loadSocietyPlans(db, world.id),
    loadSocietyRelations(db, world.id),
    loadSocietyMemoriesForAgents(
      db,
      world.id,
      npcs.map((n) => n.id),
      { perAgent: memoryHydrationPerAgent(), recentPerAgent: memoryHydrationRecentPerAgent() },
    ),
    loadSocietyConverseCooldown(db, world.id),
    loadOccupancyModel(db, world.id).catch(() => null),
  ]);
  if (agents.length) {
    overlayPersistedSociety(state, {
      ...(tip.simTime > 0 ? { simTime: tip.simTime } : {}),
      agents,
      plans,
      relations,
      memories,
      lastConverseAt: lastConverseAtFromEvents(
        tip.recentEvents as SocietyEvent[],
      ),
      events: tip.recentEvents,
    });
  }
  applyOccupancySnapshot(state, occupancy);
  const [objectEvents, objectTip, recentForGoals] = await Promise.all([
    loadLatestObjectStateEvents(db, world.id, { limit: 200 }).catch(() => []),
    loadObjectTip(db, world.id).catch(() => null),
    loadRecentSocietyEvents(db, world.id, { limit: 80 }).catch(() => []),
  ]);
  replayPersistedObjectStates(state.objects, {
    tip: objectTip,
    events: objectEvents,
  });
  applyGoalFromEvents(state.agents, recentForGoals);
  state.heldTalks = heldTalksByWorld.get(world.id) ?? [];

  const seedText = openingRumorFromSpec(
    spec.entities.find((e) => e.kind === 'npc')?.name ?? anonymousLeadName(spec),
    spec,
  );
  const invitationText = gatheringInvitationText(spec);

  // Generation owns MiniMax: mute the model, not the town. Template-degraded
  // beats still diffuse memory when the key is missing or a generate is running.
  const muteTalks = Boolean(input.muteTalks);
  const useLlm = Boolean(input.llm) && !muteTalks;

  const publishFrame = async (events: readonly SocietyEvent[]) => {
    if (!input.publish) return;
    const hasTalk = events.some((e) => isSpokenDialogue(e));
    let report = lastReportByWorld.get(world.id);
    if (!report || hasTalk) {
      report = buildEmergenceReportCard({
        state,
        events,
        seedText,
        invitationText,
      });
      lastReportByWorld.set(world.id, report);
    }
    const visible = publishableSocietyEvents(events);
    const talkBudget = await peekSocietyTalkBudget(
      input.talkBudget,
      world.id,
      Date.now(),
      worldLightOpts(world),
    );
    const compactFrame = process.env['OPENGAME_FRAME_COMPACT'] === '1';
    const mappedAgents = state.agents.map((a) => ({
      id: a.id,
      name: a.name,
      regionId: a.regionId,
      regionName: state.anchors?.get(a.regionId)?.name,
      areaId: a.areaId,
      areaName: a.areaName,
      x: a.x,
      y: a.y,
      currentAction: a.currentAction,
      goalX: a.goalX,
      goalY: a.goalY,
      goalPlace: a.goalPlace,
      goalReason: a.goalReason,
      drive: a.drive,
      needs: a.needs
        ? {
            hunger: a.needs.hunger,
            energy: a.needs.energy,
            social: a.needs.social,
            curiosity: a.needs.curiosity,
          }
        : undefined,
    }));
    const frameSeq = (frameSeqByWorld.get(world.id) ?? 0) + 1;
    frameSeqByWorld.set(world.id, frameSeq);
    const keyframe =
      process.env['OPENGAME_FRAME_COMPACT'] === '1' && shouldKeyframe(frameSeq);
    let frameAgents = mappedAgents;
    let agentsDelta = false;
    if (compactFrame) {
      const prev = lastFrameSigByWorld.get(world.id) ?? new Map<string, string>();
      const next = new Map<string, string>();
      const moved = [];
      for (const agent of mappedAgents) {
        const sig = poseSigOf(agent);
        next.set(agent.id, sig);
        if (prev.get(agent.id) !== sig) moved.push(agent);
      }
      lastFrameSigByWorld.set(world.id, next);
      frameAgents = moved;
      agentsDelta = true;
    }
    if (keyframe) {
      frameAgents = mappedAgents;
      agentsDelta = false;
    }
    let frameRelations = [...state.relations.entries()].map(([key, r]) => {
      const [from, to] = key.split('|');
      return {
        from: from ?? '',
        to: to ?? '',
        summary: r.summary,
        affinity: r.affinity,
        kind: r.kind,
        lastInteractSimTime: state.lastConverseAt.get(key),
      };
    });
    if (compactFrame) {
      frameRelations = frameRelations
        .sort((a, b) => Math.abs(b.affinity) - Math.abs(a.affinity))
        .slice(0, 48);
    }
    const mindFrame = mindOnFor(world.id, world) ? townMindFrame(world.id) : null;
    const frameBody = trimFrameForBudget(
      {
        frameVersion: SOCIETY_FRAME_VERSION,
        keyframe,
          worldId: world.id,
          simTime: state.simTime,
          talkBudget,
          events: visible,
          agents: frameAgents,
          ...(agentsDelta ? { agentsDelta: true } : {}),
          relations: frameRelations,
          ...(mindFrame
            ? { opinion: mindFrame.opinion, crowd: mindFrame.crowd }
            : {}),
          objects: snapshotWorldObjects(state.objects, state.anchors),
          llm: useLlm,
          talksMuted: muteTalks,
          skipReason: muteTalks
            ? (input.muteReason ?? 'budget')
            : visible.some((e) => e.payload?.['skipReason'] === 'keys_exhausted')
              ? 'keys_exhausted'
              : undefined,
          dialogueKind: visible.some((e) => isSpokenDialogue(e))
            ? 'model'
            : 'none',
          degraded: false,
          report: {
            summary: report.summary,
            informationSpread: report.informationSpread,
            relationshipFormation: report.relationshipFormation,
            coordination: report.coordination,
            dialogueQuality: report.dialogueQuality,
          },
        },
        compactFrame ? FRAME_MAX_BYTES : Number.MAX_SAFE_INTEGER,
      );
    await input
      .publish(`society:${world.id}`, JSON.stringify(frameBody))
      .catch((err) => {
        console.warn('[society-heartbeat] publish failed', world.id, err);
      });
  };

  const talks = Math.max(
    1,
    envInt('PLATFORM_SOCIETY_MAX_TALKS_PER_STEP', DEFAULT_TALKS_PER_STEP),
  );
  const talkBacklogCap = Math.max(
    2,
    envInt('PLATFORM_SOCIETY_TALK_BACKLOG', 12),
  );
  const backlogCount = talkBacklogByWorld.get(world.id)?.length ?? 0;
  // Only shunt to the backlog once every lane is taken; below that a new walk's
  // conversations can start alongside the ones already in flight.
  const inflightBusy = talkScheduler.inflight(world.id) >= worldTalkLaneCap();
  const room = Math.max(0, talkBacklogCap - backlogCount);
  const canQueueMore = useLlm && room > 0;
  const budgetView = useLlm
    ? await peekSocietyTalkBudget(
        input.talkBudget,
        world.id,
        Date.now(),
        worldLightOpts(world),
      )
    : null;
  const remaining = budgetView?.remaining ?? 0;
  const lastTalkAt = lastTalkReservedAt.get(world.id);
  const paced = canQueueMore
    ? pacedTalkSlotsThisWalk({
        remaining,
        minutesLeftInHour: societyTalkMinutesLeftInHour(),
        pending: Math.max(1, backlogCount),
        minutesSinceLastTalk:
          lastTalkAt != null ? (Date.now() - lastTalkAt) / 60_000 : undefined,
        walkIntervalMinutes: intervalMs() / 60_000,
        keepAlive: Boolean(input.keepAlive),
      })
    : 0;
  let llmTalks =
    paced > 0 ? Math.min(paced, llmTalksPerStep(talks, useLlm), room) : 0;
  if (llmTalks > 0) {
    const talkOk = await takeTownLlm(input.talkBudget, 'talk', llmTalks, world.id);
    if (!talkOk) llmTalks = 0;
  }
  if (useLlm && paced === 0 && remaining > 0) {
    console.log(
      `[society-tick] talk paced skip worldId=${world.id} remaining=${remaining}`,
    );
  }
  let planLlm = planLlmPerStep(useLlm);
  if (planLlm > 0) {
    const reflectOk = await takeTownLlm(
      input.talkBudget,
      'reflect',
      planLlm,
      world.id,
    );
    if (!reflectOk) planLlm = 0;
  }
  let locomotionFlushed = false;
  const courseSteering = useLlm
    ? await loadCourseSteeringHintForWorker(db, world.id).catch(() => null)
    : null;
  const mindOn = mindOnFor(world.id, world);
  const mindEvents = mindOn
    ? await beginTownMind({
        db,
        worldId: world.id,
        state,
        redis: input.talkBudget,
        llm: useLlm ? input.llm : undefined,
        scheduler: talkScheduler,
      }).catch((err) => {
        console.warn('[society-mind] tick failed', world.id, err);
        return [] as SocietyEvent[];
      })
    : [];
  const talkMind = mindOn
    ? townMindTalkOpts(world.id)
    : { recentTopics: [], beliefCards: {}, askOutcomes: false };
  const agentById = new Map(state.agents.map((agent) => [agent.id, agent]));
  const liveMind = mindFor(world.id);
  const eligibleList = mindOn
    ? activeAgentIds({
        agentCount: state.agents.length,
        agentIds: state.agents.map((agent) => agent.id),
        regionOf: (id) => agentById.get(id)?.regionId,
        occupationOf: (id) => agentById.get(id)?.occupation,
        nameOf: (id) => agentById.get(id)?.name,
        leaderIds: liveMind.opinions
          .filter((row) => Math.abs(row.stance) >= 1)
          .map((row) => row.agentId),
        policyTags: liveMind.policies.at(-1)?.tags,
        collectiveRegionId: liveMind.collective?.regionId,
      })
    : undefined;
  const events = await stepSociety(state, {
    dtHours: dtHours(),
    ...(useLlm && input.llm ? { llm: input.llm } : {}),
    ...(useLlm && (input.llmLit ?? input.llm)
      ? { talkLlm: input.llmLit ?? input.llm }
      : {}),
    maxConversationsPerStep: llmTalks,
    maxLlmConversationsPerStep: llmTalks,
    maxPlanLlmCallsPerStep: planLlm,
    converseOnlyLlm: true,
    llmImportance: planLlm > 0,
    maxReactLlmCallsPerStep: reactLlmPerStep(useLlm),
    embed: heartbeatEmbedder(),
    skipConversations: useLlm && llmTalks > 0,
    ...(courseSteering ? { courseSteering } : {}),
    recentTopics: talkMind.recentTopics,
    beliefCards: talkMind.beliefCards,
    askOutcomes: talkMind.askOutcomes,
    ...(talkMind.spotlightTopic ? { spotlightTopic: talkMind.spotlightTopic } : {}),
    ...(eligibleList ? { llmEligibleIds: new Set(eligibleList) } : {}),
    onTalkOutcomes: (outcomes, people, topic) => {
      const next = absorbTalkOutcomes(
        world.id,
        outcomes,
        people,
        topic,
        state.simTime,
      );
      plantCommitments(state, next);
    },
    flushLocomotion: async (_st, soFar) => {
      const poseKeys = changedPoseKeys(world.id, state.agents);
      await persistSocietyState(db, world.id, state, [...soFar], {
        ...(poseKeys?.length === 0 ? { omitPoses: true } : {}),
        ...(poseKeys && poseKeys.length > 0 ? { onlyAgentKeys: poseKeys } : {}),
      });
      await publishFrame(soFar);
      locomotionFlushed = true;
    },
  });
  const pendingTalks = [...(state.pendingTalks ?? [])];
  state.pendingTalks = [];
  if (pendingTalks.length && inflightBusy) {
    const existing = talkBacklogByWorld.get(world.id) ?? [];
    talkBacklogByWorld.set(
      world.id,
      [...existing, ...pendingTalks].slice(0, talkBacklogCap),
    );
  }
  const restRaw = locomotionFlushed
    ? events.filter(
        (e) =>
          e.kind === 'dialogue' ||
          e.kind === 'reflection' ||
          e.kind === 'use-object',
      )
    : events;
  const rest = mindOn ? moderateSocietyEvents(restRaw) : restRaw;
  const poseKeys = changedPoseKeys(world.id, state.agents);
  await persistSocietyState(db, world.id, state, [...rest, ...mindEvents], {
    fullRelations: !agents.length,
    ...(poseKeys?.length === 0 ? { omitPoses: true } : {}),
    ...(poseKeys && poseKeys.length > 0 ? { onlyAgentKeys: poseKeys } : {}),
  });
  if (mindOn) {
    absorbReflections(world.id, events);
    await saveTownMind(
      db,
      world.id,
      state.simTime,
      mindFor(world.id),
    ).catch((err) => {
      console.warn('[society-mind] persist failed', world.id, err);
    });
  }
  await publishFrame(locomotionFlushed ? rest : [...events, ...mindEvents]);
  if (events.some((e) => isSpokenDialogue(e))) {
    const report =
      lastReportByWorld.get(world.id) ??
      buildEmergenceReportCard({
        state,
        events,
        seedText,
        invitationText,
      });
    lastReportByWorld.set(world.id, report);
    await persistEmergenceReport(
      db,
      world.id,
      state.simTime,
      report as unknown as Record<string, unknown>,
    ).catch(() => undefined);
  }

  await db
    .update(worlds)
    .set({ lastHeartbeatAt: new Date() })
    .where(eq(worlds.id, world.id));

  return {
    events,
    pendingTalks: inflightBusy ? [] : pendingTalks,
    state,
    publishFrame,
  };
}

/** Wall-clock ms between prunes for a given world. */
const PRUNE_EVERY_MS = 5 * 60_000;
const lastPrunedAt = new Map<string, number>();

/**
 * A resident clock generates history forever. Trim the positional churn on a slow
 * cadence so the tables stay bounded without touching the narrative record.
 */
async function maybePrune(db: DrizzleDb, worldId: string): Promise<void> {
  const last = lastPrunedAt.get(worldId) ?? 0;
  if (Date.now() - last < PRUNE_EVERY_MS) return;
  lastPrunedAt.set(worldId, Date.now());
  try {
    const pruned = await pruneSocietyHistory(db, worldId, {
      keepDetailHours: envInt('PLATFORM_SOCIETY_KEEP_DETAIL_HOURS', 48),
      keepMemoryHours: envInt('PLATFORM_SOCIETY_KEEP_MEMORY_HOURS', 72),
    });
    if (pruned.events || pruned.memories) {
      console.log(
        `[society-heartbeat] pruned world=${worldId} events=${pruned.events} memories=${pruned.memories}`,
      );
    }
  } catch (err) {
    console.warn('[society-heartbeat] prune failed', worldId, err);
  }
}

/**
 * Advance one world under the cross-process lock. Skips silently when another
 * process holds it — the next sweep will pick the world up.
 */
async function advanceWorldLocked(
  input: SocietyHeartbeatOptions & {
    readonly world: LiveWorldRow;
    readonly llm?: LlmTextFn;
    readonly llmLit?: LlmTextFn;
    readonly muteTalks?: boolean;
    readonly muteReason?:
      | 'generate'
      | 'no_key'
      | 'unwatched'
      | 'no_permit'
      | 'budget'
      | 'keys_exhausted';
    readonly keepAlive?: boolean;
  },
): Promise<'stepped' | 'busy' | 'error'> {
  const lock = await acquireRedisLock(
    input.redis,
    societyWorldLockKey(input.world.id),
    { ttlMs: walkLockTtlMs(), waitMs: 0 },
  );
  if (!lock) return 'busy';
  let follow: {
    pendingTalks: NonNullable<SocietyState['pendingTalks']>;
    state: SocietyState;
    publishFrame: (events: readonly SocietyEvent[]) => Promise<void>;
  } | null = null;
  let status: 'stepped' | 'busy' | 'error' = 'stepped';
  try {
    // Walk + persist under the lock, then release before MiniMax so the next
    // sweep can keep people moving.
    const result = await advanceWorld(input);
    if (
      result.state &&
      result.publishFrame &&
      (result.pendingTalks.length ||
        (talkBacklogByWorld.get(input.world.id)?.length ?? 0) > 0)
    ) {
      follow = {
        pendingTalks: result.pendingTalks,
        state: result.state,
        publishFrame: result.publishFrame,
      };
    }
    await maybePrune(input.db, input.world.id);
    status = 'stepped';
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/keys_exhausted|全部无效|SocietyLlmKeysExhausted/.test(msg)) {
      console.error(
        '[society-heartbeat] 推理密钥全部无效，本进程心跳改为只走路。',
        msg.slice(0, 240),
      );
    } else if (/23503|world_id_fkey|is not present in table "worlds"/.test(msg)) {
      console.warn(
        `[society-heartbeat] skip deleted world ${input.world.id}`,
      );
    } else {
      console.error('[society-heartbeat] step failed', input.world.id, err);
    }
    status = 'error';
  } finally {
    await lock.release();
  }

  if (follow && (input.llm || input.llmLit)) {
    const captured = follow;
    const worldId = input.world.id;
    const db = input.db;
    const backlog = talkBacklogByWorld.get(worldId) ?? [];
    talkBacklogByWorld.delete(worldId);
    const llmJobs = [...backlog, ...captured.pendingTalks].filter(
      (j) => j.talkLlm,
    );
    const light = worldLightOpts(input.world);
    const budgetView = await peekSocietyTalkBudget(
      input.talkBudget,
      worldId,
      Date.now(),
      light,
    );
    const lastTalkAt = lastTalkReservedAt.get(worldId);
    const take = pacedTalkSlotsThisWalk({
      remaining: budgetView?.remaining ?? 0,
      minutesLeftInHour: societyTalkMinutesLeftInHour(),
      pending: llmJobs.length,
      minutesSinceLastTalk:
        lastTalkAt != null ? (Date.now() - lastTalkAt) / 60_000 : undefined,
      walkIntervalMinutes: intervalMs() / 60_000,
      keepAlive: Boolean(input.keepAlive),
    });
    const nowJobs = llmJobs.slice(0, take);
    const leftover = llmJobs.slice(take);
    if (leftover.length) {
      talkBacklogByWorld.set(worldId, leftover.slice(0, 12));
    }
    if (!nowJobs.length) return status;
    const reservedAt = Date.now();
    const claimed = await reserveSocietyTalks(
      input.talkBudget,
      worldId,
      nowJobs.length,
      reservedAt,
      light,
    );
    if (!claimed) {
      talkBacklogByWorld.set(
        worldId,
        [...nowJobs, ...(talkBacklogByWorld.get(worldId) ?? [])].slice(0, 12),
      );
      return status;
    }
    lastTalkReservedAt.set(worldId, Date.now());
    const lane = laneForParticipants(
      nowJobs.flatMap((j) => j.people.map((p) => p.id)),
    );
    enqueueWorldTalk(worldId, lane, async () => {
      const runJobs = async (jobs: PendingSocietyTalk[]) => {
        if (!jobs.length) return;
        rememberHeld(worldId, jobs, captured.state.simTime);
        try {
          const talkerIds = [
            ...new Set(jobs.flatMap((j) => j.people.map((p) => p.id))),
          ];
          const talkMemories = await loadSocietyMemoriesForAgents(
            db,
            worldId,
            talkerIds,
            { perAgent: 120 },
          );
          mergePersistedMemories(captured.state, talkMemories);
          captured.state.pendingTalks = jobs;
          const talkLlm =
            claimed === 'lit' ? (input.llmLit ?? input.llm) : input.llm;
          const talkSteering = await loadCourseSteeringHintForWorker(
            db,
            worldId,
          ).catch(() => null);
          let talkEvents: SocietyEvent[];
          try {
            const queuedMind = mindOnFor(worldId)
              ? townMindTalkOpts(worldId)
              : {
                  recentTopics: [] as string[],
                  beliefCards: {},
                  askOutcomes: false,
                  spotlightTopic: undefined as string | undefined,
                };
            talkEvents = await finishSocietyTalks(captured.state, {
              llm: talkLlm,
              embed: heartbeatEmbedder(),
              ...(talkSteering ? { courseSteering: talkSteering } : {}),
              recentTopics: queuedMind.recentTopics,
              beliefCards: queuedMind.beliefCards,
              askOutcomes: queuedMind.askOutcomes,
              ...(queuedMind.spotlightTopic
                ? { spotlightTopic: queuedMind.spotlightTopic }
                : {}),
              onTalkOutcomes: (outcomes, people, topic) => {
                const next = absorbTalkOutcomes(
                  worldId,
                  outcomes,
                  people,
                  topic,
                  captured.state.simTime,
                );
                plantCommitments(captured.state, next);
              },
            });
          } catch (err) {
            await settleSocietyTalks(
              input.talkBudget,
              worldId,
              jobs.length,
              0,
              reservedAt,
              claimed,
              light,
            );
            throw err;
          }
          const spoken = talkEvents.filter((e) => isSpokenDialogue(e)).length;
          await settleSocietyTalks(
            input.talkBudget,
            worldId,
            jobs.length,
            spoken,
            reservedAt,
            claimed,
            light,
          );
          if (spoken < jobs.length) {
            console.log(
              `[society-talk] settle worldId=${worldId} reserved=${jobs.length} spoken=${spoken}`,
            );
          }
          const persistLock = await acquireRedisLock(
            input.redis,
            societyWorldLockKey(worldId),
            { ttlMs: walkLockTtlMs(), waitMs: 8_000 },
          );
          const parked = talkEvents as unknown[];
          if (!persistLock) {
            const queued = await enqueueTalkPersistRetry(
              asTalkRetryRedis(input.redis),
              worldId,
              parked,
            );
            if (!queued) {
              await releaseSocietyTalks(
                input.talkBudget,
                worldId,
                spoken,
                reservedAt,
                claimed,
              );
            }
            return;
          }
          const retryEvents = (await drainTalkPersistRetry(
            asTalkRetryRedis(input.redis),
            worldId,
          )) as typeof talkEvents;
          const toPersist = mindOnFor(worldId)
            ? moderateSocietyEvents([...retryEvents, ...talkEvents])
            : [...retryEvents, ...talkEvents];
          try {
            await persistSocietyState(db, worldId, captured.state, toPersist, {
              omitPoses: true,
            });
            if (mindOnFor(worldId)) {
              absorbReflections(worldId, talkEvents);
              await saveTownMind(
                db,
                worldId,
                captured.state.simTime,
                mindFor(worldId),
              ).catch(() => undefined);
            }
            if (talkEvents.some((e) => isSpokenDialogue(e))) {
              const talkSpec = parseWorldSpec(input.world.specJson);
              const report =
                lastReportByWorld.get(worldId) ??
                buildEmergenceReportCard({
                  state: captured.state,
                  events: talkEvents,
                  seedText: openingRumorFromSpec(
                    anonymousLeadName(talkSpec),
                    talkSpec,
                  ),
                  invitationText: gatheringInvitationText(talkSpec),
                });
              lastReportByWorld.set(worldId, report);
              await persistEmergenceReport(
                db,
                worldId,
                captured.state.simTime,
                report as unknown as Record<string, unknown>,
              ).catch(() => undefined);
            }
          } catch (err) {
            const queued = await enqueueTalkPersistRetry(
              asTalkRetryRedis(input.redis),
              worldId,
              toPersist,
            );
            if (!queued) {
              await releaseSocietyTalks(
                input.talkBudget,
                worldId,
                spoken,
                reservedAt,
                claimed,
              );
            }
            throw err;
          } finally {
            await persistLock.release();
          }
          await captured.publishFrame(talkEvents);
        } finally {
          forgetHeld(worldId, jobs);
        }
      };
      // One reserved circle per walk. Do not drain the backlog here — that
      // re-created the "sudden pile of talks" after a quiet stretch.
      await runJobs(nowJobs);
    });
  }
  return status;
}

export interface SocietyHeartbeatHandle {
  readonly stop: () => Promise<void>;
}

/**
 * Start the resident clock. Sweeps are serialized with themselves so a slow
 * sweep cannot pile up behind itself.
 */
export function startSocietyHeartbeat(
  options: SocietyHeartbeatOptions,
): SocietyHeartbeatHandle {
  if (!heartbeatEnabled()) {
    console.log('[society-heartbeat] disabled (PLATFORM_SOCIETY_HEARTBEAT=0)');
    return { stop: async () => undefined };
  }

  let stopped = false;
  let sweeping = false;
  let llm: LlmTextFn | undefined;
  let llmLit: LlmTextFn | undefined;
  let llmResolved = false;
  let lastGenPauseLog = 0;

  const sweep = async (): Promise<void> => {
    if (stopped || sweeping) return;
    sweeping = true;
    try {
      const genBusy = isGenerationBusy();
      const rawLive = await selectLiveWorlds(options.db, maxWorldsPerSweep());
      if (!rawLive.length) {
        await runOneForecastJob(options.db).catch((err) => {
          console.warn('[forecast]', err instanceof Error ? err.message : err);
        });
        return;
      }
      const keepAliveIds = await worldIdsWithLiveCourseStakes(
        options.db,
        rawLive.map((w) => w.id),
      ).catch(() => new Set<string>());
      const live = orderLiveWorldsForCourse(rawLive, keepAliveIds);
      if (genBusy) {
        const now = Date.now();
        if (now - lastGenPauseLog > 120_000) {
          lastGenPauseLog = now;
          console.log(
            '[society-heartbeat] 生成中暂停对白；已有预览的镇子继续走动',
          );
        }
      }
      if (!genBusy && heartbeatLlmEnabled() && !llmResolved) {
        llmResolved = true;
        try {
          llm = await createSocietyLlm(talkTimeoutMs(), 'floor');
          llmLit = await createSocietyLlm(talkTimeoutMs(), 'lit', {
            consumeEmergency: () =>
              consumeEmergencySocietyTalk(options.talkBudget),
          });
        } catch (err) {
          llm = undefined;
          llmLit = undefined;
          console.error(
            '[society-heartbeat] 无法创建社会 LLM：',
            err instanceof Error ? err.message : err,
          );
        }
        if (!llm && !llmLit) {
          console.error(
            '[society-heartbeat] 未配置推理密钥，无法产生真实对白。人物继续走动，不会用模板冒充模型。',
          );
        } else {
          console.log(
            `[society-heartbeat] llm=on floor=${llm ? 'on' : 'off'} lit=${llmLit ? 'on' : 'off'}`,
          );
        }
      }
      evictIdleWorldCaches(
        Date.now(),
        [
          talkBacklogByWorld,
          lastTalkReservedAt,
          heldTalksByWorld,
          lastReportByWorld,
          lastPrunedAt,
        ],
        lastTouchedByWorld,
      );
      const queue = [...live];
      const lanes = Math.min(sweepParallel(), Math.max(1, queue.length));
      await Promise.all(
        Array.from({ length: lanes }, async () => {
          while (!stopped && queue.length) {
            const world = queue.shift();
            if (!world) return;
            await walkOne(world);
          }
        }),
      );
      await runOneForecastJob(options.db).catch((err) => {
        console.warn('[forecast]', err instanceof Error ? err.message : err);
      });
      async function walkOne(world: LiveWorldRow): Promise<void> {
        lastTouchedByWorld.set(world.id, Date.now());
        const light = worldLightOpts(world);
        const [budgetOpen, budgetView] = await Promise.all([
          societyTalkBudgetOpen(
            options.talkBudget,
            world.id,
            Date.now(),
            light,
          ),
          peekSocietyTalkBudget(
            options.talkBudget,
            world.id,
            Date.now(),
            light,
          ),
        ]);
        const llmLane = pickSocietyLlmLane({
          litBonus: budgetView?.litBonus,
          litUntil: world.lightUntil,
          leaseBonus: world.lightBonusPerHour,
        });
        const floorLlm = llm ?? (llmLane === 'lit' ? llmLit : undefined);
        const talkClient =
          preferredTaskLane('talk', llmLane) === 'lit' ? (llmLit ?? floorLlm) : floorLlm;
        const worldLlm = talkClient;
        const warmed = demoWarmWorldIds().includes(world.id);
        const presenceUntil =
          warmed && !leaseActive(world.heartbeatUntil)
            ? new Date(Date.now() + 60_000)
            : world.heartbeatUntil;
        const mute = societyTalkMuteReason({
          presenceUntil,
          authorWatchUntil: world.authorWatchUntil,
          townTimeUntil: world.townTimeUntil,
          clockPaused: world.clockPaused,
          generateBusy: genBusy,
          hasLlm: Boolean(worldLlm),
          budgetOpen,
        });
        await advanceWorldLocked({
          ...options,
          world,
          keepAlive: keepAliveIds.has(world.id),
          ...(mute
            ? { muteTalks: true, muteReason: mute }
            : { llm: floorLlm, llmLit: talkClient }),
        });
        await runDeepMindBeat({ db: options.db, worldId: world.id }).catch((err) => {
          console.warn(
            '[deep-mind]',
            world.id,
            err instanceof Error ? err.message : err,
          );
        });
      }
    } catch (err) {
      console.error('[society-heartbeat] sweep failed', err);
    } finally {
      sweeping = false;
    }
  };

  const timer = setInterval(() => void sweep(), intervalMs());
  console.log(
    `[society-heartbeat] on intervalMs=${intervalMs()} dtHours=${dtHours()} maxWorlds=${maxWorldsPerSweep()} llm=${heartbeatLlmEnabled() ? 'real' : 'off'}`,
  );

  return {
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      // Let an in-flight sweep finish so it does not die mid-persist.
      for (let i = 0; i < 40 && sweeping; i++) {
        await new Promise((r) => setTimeout(r, 50));
      }
    },
  };
}

/**
 * Refresh a world's viewer lease. Called when someone opens the stage, so worlds
 * people actually look at keep breathing without being permanently enabled.
 */
export async function touchSocietyHeartbeat(
  db: DrizzleDb,
  worldId: string,
  ttlMs = 10 * 60_000,
): Promise<void> {
  const until = new Date(Date.now() + ttlMs);
  // Presence only. Paid 镇时 leases stay on town_time_until and must not
  // move when someone just glances.
  await db
    .update(worlds)
    .set({
      heartbeatUntil: sql`GREATEST(COALESCE(${worlds.heartbeatUntil}, to_timestamp(0)), ${until.toISOString()}::timestamptz)`,
    })
    .where(eq(worlds.id, worldId));
}
