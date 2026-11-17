/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Live society tick / continue-from-now (hydrate DB → stepSociety).
 */

import {
  jobs,
  loadSocietyAgents,
  loadSocietyConverseCooldown,
  loadSocietyLiveTip,
  loadSocietyMemoriesBefore,
  loadSocietyMemoriesForAgents,
  loadSocietyPlans,
  loadSocietyRelations,
  loadRecentSocietyEvents,
  persistEmergenceReport,
  persistSocietyState,
  persistSocietyMemories,
  loadOccupancyModel,
  loadObjectTip,
  loadLatestObjectStateEvents,
  worlds,
  type DrizzleDb,
} from '@opengame/platform-db';
import { and, eq, inArray } from 'drizzle-orm';
import {
  acquireRedisLock,
  societyWorldLockKey,
  type RedisLikeForLock,
} from '@opengame/platform-shared';
import { gatheringInvitationText, gatheringSeedText, parseWorldSpec } from '@opengame/world-spec';
import {
  buildEmergenceReportCard,
  maybeLlmJudgeReportCard,
  embedderFromEnv,
  lastConverseAtFromEvents,
  overlayPersistedSociety,
  mergePersistedMemories,
  clearTalkCooldownAfterWhispers,
  runSocietyHours,
  societyStateFromSpec,
  stepSociety,
  finishSocietyTalks,
  createMemoryEntry,
  applyObjectStateEvents,
  replayPersistedObjectStates,
  applyGoalFromEvents,
  interviewAgent,
  interviewFromMemories,
  snapshotWorldObjects,
  nearestAreaAnchor,
  stampPlaceNames,
  applyOccupancySnapshot,
  rumorMemory,
  whisperMemory,
  societyCopyAscii,
  townWideSpeaker,
  MemoryStream,
  stampPaidInfluence,
  paidInterveneTouch,
  maybeReflectAfterAdopt,
  type InterviewResult,
  type LlmTextFn,
  type PlanPlace,
  type PlanSegment,
  type SocietyEvent,
  type SocietyState,
  type PendingSocietyTalk,
  type SocietyRelation,
} from '@opengame/world-agents';

export type DialogueKind = 'model' | 'template' | 'none';
export type LlmSkipReason =
  | 'budget'
  | 'no_key'
  | 'generate'
  | 'unwatched'
  | 'no_permit'
  | 'keys_exhausted';

export function societyClockMeta(input: {
  readonly llmConfigured: boolean;
  readonly useLlm: boolean;
  readonly generateBusy?: boolean;
  readonly muteReason?: LlmSkipReason;
  readonly events: readonly SocietyEvent[];
  readonly retrievalDegraded?: boolean;
}): {
  llm: boolean;
  llmConfigured: boolean;
  llmUsed: boolean;
  dialogueKind: DialogueKind;
  skipReason?: LlmSkipReason;
  degraded: boolean;
  talksMuted: boolean;
  retrievalDegraded: boolean;
} {
  const generateBusy = Boolean(input.generateBusy);
  const useLlm = input.useLlm && !generateBusy && !input.muteReason;
  const hasDialogue = input.events.some((e) => e.kind === 'dialogue');
  const template = input.events.some(
    (e) => e.kind === 'dialogue' && e.payload['degraded'] === true,
  );
  const dialogueKind: DialogueKind = !hasDialogue
    ? 'none'
    : template
      ? 'template'
      : 'model';
  const skipReason: LlmSkipReason | undefined = input.muteReason
    ? input.muteReason
    : !input.llmConfigured
      ? 'no_key'
      : generateBusy
        ? 'generate'
        : !useLlm
          ? 'budget'
          : undefined;
  return {
    llm: input.llmConfigured && useLlm,
    llmConfigured: input.llmConfigured,
    llmUsed: useLlm,
    dialogueKind,
    skipReason,
    degraded: dialogueKind === 'template',
    talksMuted: generateBusy || !useLlm,
    retrievalDegraded: Boolean(input.retrievalDegraded),
  };
}

export function societyDtHours(): number {
  const n = Number(process.env['PLATFORM_SOCIETY_DT_HOURS'] ?? 0.25);
  return Number.isFinite(n) && n > 0 ? Math.min(1, n) : 0.25;
}

/** Same hour + same text upserts instead of stacking duplicate paid traces. */
export function paidTraceStamp(text: string, simTime: number): string {
  const body = text.trim().slice(0, 240);
  let hash = 2166136261;
  for (let i = 0; i < body.length; i += 1) {
    hash ^= body.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${Math.floor(simTime)}_${(hash >>> 0).toString(16)}`;
}

function snapshotPaidRelations(
  relations: Map<string, SocietyRelation>,
  simTime: number,
): ReturnType<typeof relationSnapshot> {
  return [...relations.entries()].map(([key, r]) => {
    const [from, to] = key.split('|');
    return {
      from: from ?? '',
      to: to ?? '',
      summary: r.summary,
      affinity: r.affinity,
      kind: r.kind,
      lastInteractSimTime: simTime,
    };
  });
}

async function reflectAdoptedTargets(input: {
  readonly stream: MemoryStream;
  readonly targets: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  readonly simTime: number;
  readonly stamp: string;
}): Promise<void> {
  let n = 0;
  for (const a of input.targets) {
    await maybeReflectAfterAdopt({
      stream: input.stream,
      agentId: a.id,
      agentName: a.name,
      nowSimTime: input.simTime,
      idFactory: () => `refl_adopt_${a.id}_${input.stamp}_${n++}`,
    });
  }
}

function envInt(name: string, fallback: number, max: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 0 ? Math.min(max, Math.floor(n)) : fallback;
}

export interface SocietyTalkCaps {
  /** Conversations per step, model-backed or template-degraded. */
  readonly total: number;
  /** How many of those may call the model. */
  readonly llm: number;
  /** Plan/replan/reflect model calls per step (amortized cognition). */
  readonly planLlm: number;
}

/**
 * A cap of 0 used to mute the whole town whenever the model budget was gone.
 * Total stays > 0 so residents always meet and diffuse memories; only the
 * model spend is throttled.
 */
export function societyTalkCaps(useLlm: boolean): SocietyTalkCaps {
  const rawLlm = envInt('PLATFORM_SOCIETY_MAX_LLM_TALKS_PER_STEP', 3, 24);
  // 1–2 used to collapse the town to a single MiniMax beat; floor at 3.
  const llm = rawLlm <= 0 ? 0 : Math.max(3, rawLlm);
  const total = Math.max(
    Math.max(llm, 1),
    envInt('PLATFORM_SOCIETY_MAX_TALKS_PER_STEP', 4, 24),
  );
  const planLlm = envInt('PLATFORM_SOCIETY_MAX_PLAN_LLM_PER_STEP', 1, 16);
  return {
    total: useLlm ? Math.max(total, llm) : total,
    llm: useLlm ? llm : 0,
    planLlm: useLlm ? planLlm : 0,
  };
}

/** Wall-clock left in the tick budget below which we stop paying for tokens. */
function societyLlmReserveMs(): number {
  return envInt('PLATFORM_SOCIETY_LLM_RESERVE_MS', 3_500, 60_000);
}

let genBusyCached = false;
let genBusyUntil = 0;

/** Cross-process: API ticks must not steal MiniMax while a generate job runs. */
async function isGenerateJobRunning(db: DrizzleDb): Promise<boolean> {
  const now = Date.now();
  if (now < genBusyUntil) return genBusyCached;
  try {
    const rows = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(
        and(
          eq(jobs.status, 'running'),
          inArray(jobs.type, ['generate', 'world_generate']),
        ),
      )
      .limit(1);
    genBusyCached = rows.length > 0;
  } catch {
    genBusyCached = false;
  }
  genBusyUntil = now + 5_000;
  return genBusyCached;
}

/** One shared embedder per process so its text cache actually pays off. */
let _embedder: ReturnType<typeof embedderFromEnv> | undefined;
let _embedderResolved = false;
export function societyEmbedder(): ReturnType<typeof embedderFromEnv> {
  if (!_embedderResolved) {
    _embedder = embedderFromEnv();
    _embedderResolved = true;
    console.log(`[society] embeddings ${_embedder ? 'enabled' : 'hash-fallback'}`);
  }
  return _embedder;
}

export function societySeedHours(): number {
  const n = Number(process.env['PLATFORM_SOCIETY_SEED_HOURS'] ?? 16);
  return Number.isFinite(n) && n > 0 ? Math.min(48, n) : 16;
}

export function defaultSocietySeedText(
  leadName: string,
  spec?: Parameters<typeof gatheringSeedText>[1],
): string {
  return gatheringSeedText(leadName, spec);
}

async function overlayFromDb(
  db: DrizzleDb,
  worldId: string,
  state: SocietyState,
  options?: {
    readonly memoryLimit?: number;
    /** Live ticks: tip + agents + relations + day plans + small memory tip. */
    readonly live?: boolean;
  },
): Promise<void> {
  const t0 = Date.now();

  if (options?.live) {
    const tip = await loadSocietyConverseCooldown(db, worldId);
    console.log(
      `[society-tick] db tip events=${tip.recentEvents.length} simTime=${tip.simTime} ms=${Date.now() - t0}`,
    );
    const [agents, relations, plans, memories, occupancy] = await Promise.all([
      loadSocietyAgents(db, worldId),
      loadSocietyRelations(db, worldId),
      loadSocietyPlans(db, worldId),
      loadSocietyMemoriesForAgents(
        db,
        worldId,
        state.agents.map((a) => a.id),
        {
          perAgent: LIVE_MEMORY_PER_AGENT,
          recentPerAgent: LIVE_MEMORY_RECENT_PER_AGENT,
        },
      ),
      loadOccupancyModel(db, worldId).catch(() => null),
    ]);
    console.log(
      `[society-tick] db agents n=${agents.length} plans=${plans.length} mem=${memories.length} ms=${Date.now() - t0}`,
    );
    overlayPersistedSociety(state, {
      simTime: tip.simTime || state.simTime,
      agents,
      memories,
      plans,
      relations,
      lastConverseAt: lastConverseAtFromEvents(tip.recentEvents),
    });
    applyOccupancySnapshot(state, occupancy);
    console.log(`[society-tick] overlay live ms=${Date.now() - t0}`);
    return;
  }

  const tip = await loadSocietyLiveTip(db, worldId);
  console.log(
    `[society-tick] db tip events=${tip.recentEvents.length} simTime=${tip.simTime} ms=${Date.now() - t0}`,
  );
  const agents = await loadSocietyAgents(db, worldId);
  console.log(
    `[society-tick] db agents n=${agents.length} ms=${Date.now() - t0}`,
  );

  const memories = await loadSocietyMemoriesBefore(db, worldId, 1e12, {
    limit: options?.memoryLimit ?? LIVE_MEMORY_LIMIT,
  });
  const plans = await loadSocietyPlans(db, worldId);
  const relations = await loadSocietyRelations(db, worldId);
  overlayPersistedSociety(state, {
    simTime: tip.simTime || state.simTime,
    agents,
    memories,
    plans,
    relations,
    lastConverseAt: lastConverseAtFromEvents(tip.recentEvents),
  });
  const occupancy = await loadOccupancyModel(db, worldId).catch(() => null);
  applyOccupancySnapshot(state, occupancy);
}

export async function hydrateSocietyState(input: {
  readonly db: DrizzleDb;
  readonly worldId: string;
  readonly specJson: unknown;
  readonly seedText?: string;
  readonly memoryLimit?: number;
  readonly live?: boolean;
}): Promise<{
  state: SocietyState;
  existed: boolean;
  seedText: string;
  invitationText: string;
}> {
  const spec = parseWorldSpec(input.specJson);
  const npcs = spec.entities.filter((e) => e.kind === 'npc');
  if (npcs.length < 2) {
    throw new Error('need ≥2 NPCs for society run');
  }
  const seedText =
    input.seedText ?? defaultSocietySeedText(npcs[0]!.name, spec);
  const invitationText = gatheringInvitationText(spec);
  const state = societyStateFromSpec(spec, { seedText });
  const prior = await loadSocietyAgents(input.db, input.worldId);
  if (prior.length === 0) {
    return { state, existed: false, seedText, invitationText };
  }
  await overlayFromDb(input.db, input.worldId, state, {
    memoryLimit: input.memoryLimit ?? LIVE_MEMORY_LIMIT,
    live: input.live,
  });
  const [objectEvents, objectTip, recentForGoals] = await Promise.all([
    loadLatestObjectStateEvents(input.db, input.worldId, { limit: 200 }).catch(
      () => [],
    ),
    loadObjectTip(input.db, input.worldId).catch(() => null),
    loadRecentSocietyEvents(input.db, input.worldId, { limit: 80 }).catch(
      () => [],
    ),
  ]);
  replayPersistedObjectStates(state.objects, {
    tip: objectTip,
    events: objectEvents,
  });
  applyGoalFromEvents(state.agents, recentForGoals);
  return { state, existed: true, seedText, invitationText };
}

function clipNeeds(raw: unknown): {
  hunger: number;
  energy: number;
  social: number;
  curiosity: number;
} | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const n = (k: string): number => {
    const v = o[k];
    return typeof v === 'number' && Number.isFinite(v)
      ? Math.max(0, Math.min(1, Math.round(v * 100) / 100))
      : 0;
  };
  return {
    hunger: n('hunger'),
    energy: n('energy'),
    social: n('social'),
    curiosity: n('curiosity'),
  };
}

function agentSnapshot(state: SocietyState) {
  return state.agents.map((a) => ({
    id: a.id,
    name: a.name,
    regionId: a.regionId,
    regionName: state.anchors?.get(a.regionId)?.name,
    areaId: a.areaId,
    areaName: a.areaName,
    x: a.x,
    y: a.y,
    currentAction: a.currentAction,
    padded: a.padded,
    stance: a.stance,
    goalX: a.goalX,
    goalY: a.goalY,
    goalPlace: a.goalPlace,
    goalReason: a.goalReason,
    drive: a.drive,
    needs: clipNeeds(a.needs),
  }));
}

function objectSnapshot(state: SocietyState) {
  return snapshotWorldObjects(state.objects, state.anchors);
}

function relationSnapshot(state: SocietyState) {
  return [...state.relations.entries()].map(([key, r]) => {
    const [from, to] = key.split('|');
    return {
      from: from ?? '',
      to: to ?? '',
      summary: r.summary,
      affinity: r.affinity,
      kind: r.kind,
      lastInteractSimTime: state.lastConverseAt?.get(key),
    };
  });
}

const MAX_PAYLOAD_STR = 240;
const MAX_PLAN_SEGMENTS = 12;
const MAX_DIALOGUE_TURNS = 6;

function clipStr(v: unknown, max = MAX_PAYLOAD_STR): string | undefined {
  if (typeof v !== 'string') return undefined;
  return v.length > max ? `${v.slice(0, max)}…` : v;
}

/**
 * Strip embeddings / verbose plan text so API JSON.stringify cannot blow up
 * (RangeError: Invalid string length) and the browser stays clickable.
 */
export function slimSocietyEventPayload(
  kind: string,
  payload: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!payload || typeof payload !== 'object') return {};
  if (kind === 'emergence_report') {
    return {
      summary: clipStr(payload['summary'], 320) ?? '',
    };
  }
  if (kind === 'plan') {
    const segs = Array.isArray(payload['segments'])
      ? (payload['segments'] as Array<Record<string, unknown>>)
      : [];
    return {
      dayIndex: payload['dayIndex'],
      replan: payload['replan'],
      reason: clipStr(payload['reason'], 80),
      objectId: payload['objectId'],
      segments: segs.slice(0, MAX_PLAN_SEGMENTS).map((s) => ({
        startHour: s['startHour'],
        endHour: s['endHour'],
        activity: clipStr(s['activity'], 80) ?? '',
        locationId:
          typeof s['locationId'] === 'string' ? s['locationId'] : undefined,
        locationName: clipStr(s['locationName'], 80),
      })),
    };
  }
  if (kind === 'move' || kind === 'action') {
    return {
      regionId: payload['regionId'],
      x: payload['x'],
      y: payload['y'],
      activity: clipStr(payload['activity'], 80),
      areaId: payload['areaId'],
      areaName: clipStr(payload['areaName'], 80),
      goalX: payload['goalX'],
      goalY: payload['goalY'],
      goalPlace: clipStr(payload['goalPlace'], 80),
      goalReason: clipStr(payload['goalReason'], 80),
      talkingWith: clipStr(payload['talkingWith'], 40),
      reason: payload['reason'],
      drive: payload['drive'],
      fromRegionId: payload['fromRegionId'],
      toRegionId: payload['toRegionId'],
      portalId: payload['portalId'],
    };
  }
  if (kind === 'dialogue' || kind === 'intervene') {
    const turns = Array.isArray(payload['turns'])
      ? (payload['turns'] as Array<Record<string, unknown>>)
      : [];
    const out: Record<string, unknown> = {
      with: payload['with'],
      summary: clipStr(payload['summary'], 200),
      text: clipStr(payload['text'], 200),
      kind: payload['kind'],
      town: payload['town'],
      degraded: payload['degraded'],
      adopt: payload['adopt'],
      paid: payload['paid'],
    };
    const talkSeq = Number(payload['talkSeq']);
    if (Number.isFinite(talkSeq) && talkSeq > 0) out['talkSeq'] = talkSeq;
    const circleIndex = Number(payload['circleIndex']);
    if (Number.isFinite(circleIndex) && circleIndex > 0) {
      out['circleIndex'] = circleIndex;
    }
    if (Array.isArray(payload['participants'])) {
      out['participants'] = (payload['participants'] as unknown[])
        .filter((id): id is string => typeof id === 'string')
        .slice(0, 8);
    }
    if (turns.length) {
      out['turns'] = turns.slice(0, MAX_DIALOGUE_TURNS).map((t) => ({
        speakerId: t['speakerId'],
        speakerName: clipStr(t['speakerName'], 40),
        text: clipStr(t['text'], 160) ?? '',
      }));
    }
    return out;
  }
  // Generic: drop arrays that look like embeddings; clip strings.
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (k === 'embedding' || k === 'embeddings') continue;
    if (Array.isArray(v) && v.length > 32 && v.every((x) => typeof x === 'number')) {
      continue;
    }
    if (typeof v === 'string') {
      out[k] = clipStr(v, MAX_PAYLOAD_STR);
    } else if (
      v == null ||
      typeof v === 'number' ||
      typeof v === 'boolean'
    ) {
      out[k] = v;
    } else if (Array.isArray(v) && v.length <= 16) {
      out[k] = v;
    }
  }
  return out;
}

function talkSeqOfEvent(payload: Record<string, unknown> | undefined): number {
  const n = Number(payload?.['talkSeq']);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Keep rumors/chats in a last-N window so opening replay is not only walks. */
export function mergePinnedSocietyEvents<
  T extends {
    readonly id: string;
    readonly kind: string;
    readonly simTime: number;
    readonly payload?: Record<string, unknown>;
  },
>(recent: readonly T[], extra: readonly T[]): T[] {
  const byId = new Map<string, T>();
  for (const e of extra) byId.set(e.id, e);
  for (const e of recent) byId.set(e.id, e);
  return [...byId.values()].sort((a, b) => {
    if (a.simTime !== b.simTime) return a.simTime - b.simTime;
    const sa = talkSeqOfEvent(a.payload);
    const sb = talkSeqOfEvent(b.payload);
    if (sa !== sb) return sa - sb;
    return String(a.id).localeCompare(String(b.id));
  });
}

function eventDto(e: SocietyEvent) {
  return {
    id: e.id,
    simTime: e.simTime,
    kind: e.kind,
    agentId: e.agentId ?? null,
    payload: slimSocietyEventPayload(
      e.kind,
      e.payload as Record<string, unknown>,
    ),
  };
}

const worldLocks = new Map<string, Promise<unknown>>();

/** How long a caller may wait for the per-world lock before failing fast. */
const WORLD_LOCK_WAIT_MS = 2_000;
/** User-facing intervene/whisper: wait for the in-flight tick instead of 423 immediately. */
const WORLD_LOCK_WAIT_INTERVENE_MS = 12_000;
/** Live hydrate memory cap (full hydrate / FF only). */
const LIVE_MEMORY_LIMIT = 200;
/**
 * Per-resident memories on a live walk (talks load a deeper window for speakers).
 * Layered so the recency slice survives a town-wide importance ranking.
 */
const LIVE_MEMORY_PER_AGENT = 48;
const LIVE_MEMORY_RECENT_PER_AGENT = 24;

const talkTailJobs = new Map<string, PendingSocietyTalk[]>();
const talkTailBusy = new Set<string>();

export function scheduleSocietyTalkTail(input: {
  readonly db: DrizzleDb;
  readonly worldId: string;
  readonly specJson: unknown;
  readonly llm?: LlmTextFn;
  readonly jobs: readonly PendingSocietyTalk[];
}): void {
  if (!input.jobs.length || !input.llm) return;
  const existing = talkTailJobs.get(input.worldId) ?? [];
  talkTailJobs.set(
    input.worldId,
    [...existing, ...input.jobs].slice(0, 8),
  );
  void pumpSocietyTalkTail(input);
}

async function pumpSocietyTalkTail(input: {
  readonly db: DrizzleDb;
  readonly worldId: string;
  readonly specJson: unknown;
  readonly llm?: LlmTextFn;
}): Promise<void> {
  if (talkTailBusy.has(input.worldId)) return;
  talkTailBusy.add(input.worldId);
  try {
    for (;;) {
      const jobs = talkTailJobs.get(input.worldId);
      if (!jobs?.length) break;
      talkTailJobs.set(input.worldId, []);
      try {
        const { state } = await hydrateSocietyState({
          db: input.db,
          worldId: input.worldId,
          specJson: input.specJson,
          live: true,
        });
        const talkerIds = [
          ...new Set(jobs.flatMap((j) => j.people.map((p) => p.id))),
        ];
        const talkMemories = await loadSocietyMemoriesForAgents(
          input.db,
          input.worldId,
          talkerIds,
          { perAgent: 120 },
        );
        mergePersistedMemories(state, talkMemories);
        state.pendingTalks = [...jobs];
        const events = await finishSocietyTalks(state, {
          llm: input.llm,
          embed: societyEmbedder(),
        });
        if (events.length) {
          await withWorldLock(
            input.worldId,
            async () => {
              await persistSocietyState(input.db, input.worldId, state, events, {
                omitPoses: true,
              });
            },
            { holdMs: 20_000 },
          );
        }
      } catch (err) {
        if (isSocietyBusyError(err)) {
          talkTailJobs.set(
            input.worldId,
            [...jobs, ...(talkTailJobs.get(input.worldId) ?? [])].slice(0, 8),
          );
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }
        console.warn('[society-talk-tail]', err);
        break;
      }
    }
  } finally {
    talkTailBusy.delete(input.worldId);
  }
}

/** Thrown when another society tick/run/whisper still holds the world lock. */
export class SocietyBusyError extends Error {
  readonly code = 'society_busy' as const;
  constructor(message = 'society busy') {
    super(message);
    this.name = 'SocietyBusyError';
  }
}

/** Thrown when the lock holder exceeds its time budget. */
export class SocietyTickTimeoutError extends Error {
  readonly code = 'society_tick_timeout' as const;
  constructor(message = 'society tick timeout') {
    super(message);
    this.name = 'SocietyTickTimeoutError';
  }
}

export function isSocietyBusyError(err: unknown): err is SocietyBusyError {
  return (
    err instanceof SocietyBusyError ||
    (typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: unknown }).code === 'society_busy')
  );
}

export function isSocietyTickTimeoutError(
  err: unknown,
): err is SocietyTickTimeoutError {
  return (
    err instanceof SocietyTickTimeoutError ||
    (typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: unknown }).code === 'society_tick_timeout')
  );
}

/**
 * Cross-process lock backing. Registered at API startup; when absent (unit
 * tests, single-process dev) the in-process chain below is the only guard.
 */
let lockRedis: RedisLikeForLock | undefined;

export function setSocietyLockRedis(redis: RedisLikeForLock | undefined): void {
  lockRedis = redis;
}

/**
 * Serialize a world across processes. The API tick, the worker heartbeat and
 * rewind all advance the same world; with only a per-process map two of them
 * could hydrate the same simTime and both persist, duplicating events.
 */
async function withDistributedWorldLock<T>(
  worldId: string,
  fn: () => Promise<T>,
  holdMs?: number,
  waitMs: number = WORLD_LOCK_WAIT_MS,
): Promise<T> {
  if (!lockRedis) return fn();
  // Lease must outlive the critical section's own deadline, and auto-renew keeps
  // a slow-but-alive holder from being treated as crashed.
  const ttlMs = Math.max(30_000, (holdMs ?? 0) + 15_000);
  const lock = await acquireRedisLock(lockRedis, societyWorldLockKey(worldId), {
    ttlMs,
    waitMs,
    retryDelayMs: 100,
  });
  if (!lock) throw new SocietyBusyError();
  try {
    return await fn();
  } finally {
    await lock.release();
  }
}

/**
 * Mutex per worldId — in-process chain for cheap local queuing, wrapped by a
 * Redis lease for cross-process safety.
 * - Waiters that cannot acquire within wait → {@link SocietyBusyError}
 * - Optional `holdMs` safety race (prefer internal deadlines in live tick to avoid orphan DB writes)
 */
async function withWorldLock<T>(
  worldId: string,
  body: () => Promise<T>,
  options?: { readonly holdMs?: number; readonly waitMs?: number },
): Promise<T> {
  const holdMs = options?.holdMs;
  const waitMs =
    options?.waitMs != null && Number.isFinite(options.waitMs)
      ? Math.max(0, options.waitMs)
      : WORLD_LOCK_WAIT_MS;
  const fn = (): Promise<T> =>
    withDistributedWorldLock(worldId, body, holdMs, waitMs);
  let release!: () => void;
  const held = new Promise<void>((r) => {
    release = r;
  });
  const prev = worldLocks.get(worldId) ?? Promise.resolve();
  const chained = prev.then(() => held);
  worldLocks.set(worldId, chained);

  const outcome = await Promise.race([
    prev.then(() => 'go' as const).catch(() => 'go' as const),
    new Promise<'busy'>((resolve) => {
      setTimeout(() => resolve('busy'), waitMs);
    }),
  ]);

  if (outcome === 'busy') {
    release();
    throw new SocietyBusyError();
  }

  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  const work = fn();
  try {
    if (holdMs == null || !Number.isFinite(holdMs) || holdMs <= 0) {
      return await work;
    }
    return await Promise.race([
      work,
      new Promise<T>((_, reject) => {
        holdTimer = setTimeout(() => {
          reject(new SocietyTickTimeoutError());
        }, holdMs);
      }),
    ]);
  } finally {
    if (holdTimer) clearTimeout(holdTimer);
    // Timeout must not hand the lock to the next waiter while this body is
    // still persisting — that duplicated events and corrupted poses.
    await work.catch(() => undefined);
    release();
    if (worldLocks.get(worldId) === chained) worldLocks.delete(worldId);
  }
}

/**
 * Run a world mutation that is not a normal tick (rewind, checkpoint restore)
 * under the same lock. Without this, a rewind could delete events out from under
 * an in-flight tick and leave the world at an impossible simTime.
 */
export async function withSocietyWorldLock<T>(
  worldId: string,
  fn: () => Promise<T>,
  options?: { readonly holdMs?: number; readonly waitMs?: number },
): Promise<T> {
  return withWorldLock(worldId, fn, options);
}

async function snapshotLiveTown(input: {
  readonly db: DrizzleDb;
  readonly worldId: string;
  readonly specJson: unknown;
  readonly seedText?: string;
  readonly llm?: LlmTextFn;
  readonly muteReason?: LlmSkipReason;
  readonly reason: string;
}): Promise<{
  simTime: number;
  events: ReturnType<typeof eventDto>[];
  agents: ReturnType<typeof agentSnapshot>;
  relations: ReturnType<typeof relationSnapshot>;
  objects: ReturnType<typeof objectSnapshot>;
  report: ReturnType<typeof buildEmergenceReportCard>;
  llm: boolean;
  llmConfigured: boolean;
  llmUsed: boolean;
  dialogueKind: DialogueKind;
  skipReason?: LlmSkipReason;
  seeded: boolean;
  degraded: boolean;
  talksMuted: boolean;
  talksStarted: number;
}> {
  const genBusy = await isGenerateJobRunning(input.db);
  const { state, seedText, invitationText } = await hydrateSocietyState({
    ...input,
    live: true,
    memoryLimit: LIVE_MEMORY_LIMIT,
  });
  console.log(
    `[society-tick] snapshot worldId=${input.worldId} simTime=${state.simTime} (${input.reason})`,
  );
  return {
    simTime: state.simTime,
    events: [],
    agents: agentSnapshot(state),
    relations: relationSnapshot(state),
    objects: objectSnapshot(state),
    report: buildEmergenceReportCard({
      state,
      events: [],
      seedText,
      invitationText,
    }),
    seeded: false,
    talksStarted: 0,
    ...societyClockMeta({
      llmConfigured: Boolean(input.llm),
      useLlm: Boolean(input.llm) && !genBusy && !input.muteReason,
      generateBusy: genBusy,
      muteReason: input.muteReason,
      events: [],
      retrievalDegraded: !societyEmbedder(),
    }),
  };
}

/** Worker stamped this world recently — API must not double-step. */
const HEARTBEAT_FRESH_MS = 20_000;
/** Worker still owns the clock; a slow MiniMax walk must not lose the lease. */
const HEARTBEAT_OWNED_MS = 90_000;

async function heartbeatClockFresh(
  db: DrizzleDb,
  worldId: string,
): Promise<{ fresh: boolean; wanted: boolean; owned: boolean }> {
  try {
    const [row] = await db
      .select({
        enabled: worlds.heartbeatEnabled,
        until: worlds.heartbeatUntil,
        last: worlds.lastHeartbeatAt,
      })
      .from(worlds)
      .where(eq(worlds.id, worldId))
      .limit(1);
    if (!row) return { fresh: false, wanted: false, owned: false };
    const until =
      row.until instanceof Date ? row.until.getTime() : Number(row.until ?? 0);
    const wanted =
      row.enabled === true || (Number.isFinite(until) && until > Date.now());
    const last =
      row.last instanceof Date ? row.last.getTime() : Number(row.last ?? 0);
    const age = last > 0 ? Date.now() - last : Number.POSITIVE_INFINITY;
    const fresh = wanted && age < HEARTBEAT_FRESH_MS;
    const owned = wanted && age < HEARTBEAT_OWNED_MS;
    return { fresh, wanted, owned };
  } catch {
    return { fresh: false, wanted: false, owned: false };
  }
}

export async function tickSocietyOnce(input: {
  readonly db: DrizzleDb;
  readonly worldId: string;
  readonly specJson: unknown;
  readonly llm?: LlmTextFn;
  readonly seedText?: string;
  readonly muteReason?: LlmSkipReason;
  readonly frozen?: boolean;
  /**
   * Runs only after the world lock is held. API tick must reserve talk
   * seats here — never before the lock — so a busy town does not burn a slot.
   */
  readonly prepareInsideLock?: () => Promise<{
    readonly llm?: LlmTextFn;
    readonly muteReason?: LlmSkipReason;
  } | void>;
}): Promise<{
  simTime: number;
  events: ReturnType<typeof eventDto>[];
  agents: ReturnType<typeof agentSnapshot>;
  relations: ReturnType<typeof relationSnapshot>;
  objects: ReturnType<typeof objectSnapshot>;
  report: ReturnType<typeof buildEmergenceReportCard>;
  llm: boolean;
  llmConfigured: boolean;
  llmUsed: boolean;
  dialogueKind: DialogueKind;
  skipReason?: LlmSkipReason;
  seeded: boolean;
  degraded: boolean;
  talksMuted: boolean;
  talksStarted: number;
}> {
  const t0 = Date.now();
  let llm = input.llm;
  let muteReason = input.muteReason;
  console.log(`[society-tick] start worldId=${input.worldId}`);
  try {
    if (input.frozen) {
      return snapshotLiveTown({
        db: input.db,
        worldId: input.worldId,
        specJson: input.specJson,
        seedText: input.seedText,
        muteReason: input.muteReason ?? 'unwatched',
        reason: 'clock paused',
      });
    }
    const hb = await heartbeatClockFresh(input.db, input.worldId);
    if (hb.owned) {
      return snapshotLiveTown({
        ...input,
        reason: hb.fresh ? 'worker clock' : 'worker owned',
      });
    }
    // No holdMs race — orphaned mid-persist was saturating the DB pool and
    // making the next tick hang in hydrate (no hydrate log, only timeout).
    const result = await withWorldLock(input.worldId, async () => {
      if (input.prepareInsideLock) {
        const prepared = await input.prepareInsideLock();
        if (prepared) {
          llm = prepared.llm;
          muteReason = prepared.muteReason;
        }
      }
      const deadline = t0 + 32_000;
      const dt = societyDtHours();
      const hydrateT0 = Date.now();
      const { state, existed, seedText, invitationText } = await hydrateSocietyState({
        ...input,
        live: true,
        memoryLimit: LIVE_MEMORY_LIMIT,
      });
      console.log(
        `[society-tick] hydrate worldId=${input.worldId} existed=${existed} agents=${state.agents.length} simTime=${state.simTime} ms=${Date.now() - hydrateT0}`,
      );
      let events: SocietyEvent[];
      let seeded = false;
      if (!existed) {
        seeded = true;
        // First write for this world: the spec-seeded relationship graph has no
        // events behind it, so it must be written in full.
        await persistSocietyState(input.db, input.worldId, state, [], {
          fullRelations: true,
        });
        console.log(
          `[society-tick] seed-persist agents=${state.agents.length} ms=${Date.now() - t0}`,
        );
      }
      const remain = deadline - Date.now();
      const genBusy = await isGenerateJobRunning(input.db);
      if (genBusy) {
        console.log(
          `[society-tick] 生成中暂停对白，人物继续走动 worldId=${input.worldId}`,
        );
      }
      // Real MiniMax when budget allows; generate jobs own the keys.
      // A live worker already returned above (`hb.owned`). This path is the
      // fallback when the resident clock looks dead — it must still queue talks.
      const useLlm =
        Boolean(llm) &&
        !muteReason &&
        remain > societyLlmReserveMs() &&
        !genBusy;
      const caps = societyTalkCaps(useLlm);
      console.log(
        `[society-tick] step useLlm=${useLlm} remainMs=${remain} talks=${caps.total}/llm=${caps.llm}/plan=${caps.planLlm}`,
      );
      const stepT0 = Date.now();
      let locomotionFlushed = false;
      events = await stepSociety(state, {
        dtHours: dt,
        ...(useLlm ? { llm } : {}),
        maxConversationsPerStep: caps.total,
        maxLlmConversationsPerStep: genBusy ? 0 : caps.llm,
        maxPlanLlmCallsPerStep: genBusy ? 0 : caps.planLlm,
        converseOnlyLlm: caps.planLlm === 0,
        llmImportance: !genBusy && caps.planLlm > 0,
        maxReactLlmCallsPerStep: useLlm && !genBusy ? 1 : 0,
        embed: societyEmbedder(),
        skipConversations: useLlm && !genBusy,
        flushLocomotion: async (_st, soFar) => {
          await persistSocietyState(input.db, input.worldId, state, [...soFar]);
          locomotionFlushed = true;
        },
      });
      const pendingTalks = useLlm ? [...(state.pendingTalks ?? [])] : [];
      if (useLlm) state.pendingTalks = [];
      console.log(
        `[society-tick] step done events=${events.length} simTime=${state.simTime} ms=${Date.now() - stepT0}`,
      );
      const persistT0 = Date.now();
      await persistSocietyState(
        input.db,
        input.worldId,
        state,
        locomotionFlushed
          ? events.filter(
              (e) =>
                e.kind === 'dialogue' ||
                e.kind === 'reflection' ||
                e.kind === 'use-object',
            )
          : events,
      );
      console.log(
        `[society-tick] persist ms=${Date.now() - persistT0}`,
      );
      // One tick only produces a couple of seconds of world time. Gathering and
      // route-variety metrics are meaningless over that window, so score the
      // last simulated day instead.
      let reportEvents = events as readonly SocietyEvent[];
      try {
        const recent = await loadRecentSocietyEvents(input.db, input.worldId, {
          sinceSimTime: state.simTime - 24,
          limit: 800,
        });
        if (recent.length) reportEvents = recent as readonly SocietyEvent[];
      } catch (err) {
        console.warn('[society-tick] report window load failed', err);
      }
      const report = buildEmergenceReportCard({
        state,
        events: reportEvents,
        seedText,
        invitationText,
      });
      const shouldStampReport =
        seeded ||
        events.some((e) => e.kind === 'dialogue' || e.kind === 'intervene');
      if (shouldStampReport && Date.now() < deadline) {
        await persistEmergenceReport(
          input.db,
          input.worldId,
          state.simTime,
          report as unknown as Record<string, unknown>,
        );
      }
      return {
        simTime: state.simTime,
        events: events.map(eventDto),
        agents: agentSnapshot(state),
        relations: relationSnapshot(state),
        objects: objectSnapshot(state),
        report,
        seeded,
        pendingTalks,
        ...societyClockMeta({
          llmConfigured: Boolean(llm) || Boolean(muteReason),
          useLlm,
          generateBusy: genBusy,
          muteReason,
          events,
          retrievalDegraded: !societyEmbedder(),
        }),
      };
    });
    const talksStarted = result.pendingTalks?.length ?? 0;
    if (talksStarted) {
      scheduleSocietyTalkTail({
        db: input.db,
        worldId: input.worldId,
        specJson: input.specJson,
        llm,
        jobs: result.pendingTalks,
      });
    }
    const { pendingTalks: _pending, ...rest } = result;
    console.log(
      `[society-tick] end worldId=${input.worldId} simTime=${rest.simTime} seeded=${rest.seeded} ms=${Date.now() - t0}`,
    );
    return { ...rest, talksStarted };
  } catch (err) {
    if (isSocietyBusyError(err)) {
      try {
        return await snapshotLiveTown({
          ...input,
          reason: 'busy snapshot',
        });
      } catch (snapErr) {
        console.warn(
          `[society-tick] fail worldId=${input.worldId} code=busy ms=${Date.now() - t0}`,
          err instanceof Error ? err.message : err,
          snapErr instanceof Error ? snapErr.message : snapErr,
        );
        throw err;
      }
    }
    const code = isSocietyTickTimeoutError(err) ? 'timeout' : 'error';
    console.warn(
      `[society-tick] fail worldId=${input.worldId} code=${code} ms=${Date.now() - t0}`,
      err instanceof Error ? err.message : err,
    );
    throw err;
  }
}

/** Insert a whisper or town rumor at the live tip — do not wipe/recompute. */
export async function whisperSocietyLive(input: {
  readonly db: DrizzleDb;
  readonly worldId: string;
  readonly specJson: unknown;
  readonly agentKey?: string;
  readonly text: string;
  readonly seedText?: string;
  readonly llm?: LlmTextFn;
  /** Paid 巷议 lands as town rumor and sticks harder in memory. */
  readonly forceTown?: boolean;
  readonly importance?: number;
  readonly pointers?: readonly string[];
  /** Paid 认养 — extra high-importance memory on the same stream. */
  readonly adopt?: boolean;
  /** Write the trace only — used when the town lock cannot afford a talk step. */
  readonly skipTalks?: boolean;
  /** Paid 夜市 SKU: unmutes a course window, never needle-matches. */
  readonly courseNeutral?: boolean;
}): Promise<{
  simTime: number;
  events: ReturnType<typeof eventDto>[];
  agents: ReturnType<typeof agentSnapshot>;
  relations: ReturnType<typeof relationSnapshot>;
  objects: ReturnType<typeof objectSnapshot>;
  rumor: boolean;
  focusAgentId: string | null;
  llm: boolean;
  llmConfigured: boolean;
  llmUsed: boolean;
  dialogueKind: DialogueKind;
  skipReason?: LlmSkipReason;
  degraded: boolean;
  talksMuted: boolean;
  talksStarted: number;
}> {
  const result = await withWorldLock(
    input.worldId,
    async () => {
    const { state } = await hydrateSocietyState(input);
    const text = input.text.trim();
    if (!text) throw new Error('empty whisper');
    const town = Boolean(input.forceTown) || !input.agentKey;
    const targets = town
      ? state.agents
      : state.agents.filter((a) => a.id === input.agentKey);
    if (!targets.length) throw new Error('agent not found');
    const simTime = state.simTime;
    const stamp = paidTraceStamp(text, simTime);
    const memoryText = town
      ? rumorMemory(text, societyCopyAscii(state))
      : whisperMemory(text, societyCopyAscii(state));
    const importance = Math.max(
      1,
      Math.min(16, input.importance ?? (input.adopt ? 13 : 8)),
    );
    const pointers = [...(input.pointers ?? [])];
    const added: ReturnType<typeof createMemoryEntry>[] = [];
    for (const a of targets) {
      if (!pointers.length) {
        const prior = state.stream
          .list(a.id)
          .filter((m) => m.importance >= 6)
          .slice(-2)
          .map((m) => m.id);
        pointers.push(...prior);
      }
      const whisper = createMemoryEntry({
        id: `whisper_${a.id}_${stamp}`,
        agentId: a.id,
        kind: 'observation',
        text: memoryText,
        simTime,
        importance,
        pointers: pointers.slice(0, 4),
      });
      state.stream.add(whisper);
      added.push(whisper);
      if (input.adopt) {
        const adopt = createMemoryEntry({
          id: `adopt_${a.id}_${stamp}`,
          agentId: a.id,
          kind: 'observation',
          text: societyCopyAscii(state)
            ? `【认养】Someone adopted you. Keep the days clearer.`
            : `【认养】有人认养了你，要把日子记得更清楚。`,
          simTime,
          importance: 13,
          pointers: pointers.slice(0, 4),
        });
        state.stream.add(adopt);
        added.push(adopt);
      }
    }
    const ascii = societyCopyAscii(state);
    stampPaidInfluence(state.relations, {
      agentIds: targets.map((a) => a.id),
      adopt: input.adopt,
      rumorText: text,
      ascii,
    });
    if (input.adopt) {
      await reflectAdoptedTargets({
        stream: state.stream,
        targets,
        simTime,
        stamp,
      });
    }
    if (added.length) {
      await persistSocietyMemories(input.db, input.worldId, added);
    }
    const ev: SocietyEvent = {
      id: `intervene_${town ? 'town' : targets[0]!.id}_${stamp}`,
      simTime,
      kind: 'intervene',
      agentId: town ? undefined : targets[0]!.id,
      payload: {
        kind: town ? 'rumor' : 'whisper',
        text,
        summary: memoryText,
        town,
        ...paidInterveneTouch({
          town,
          targetIds: targets.map((a) => a.id),
          adopt: input.adopt,
        }),
        ...(input.courseNeutral ? { courseNeutral: true } : {}),
        turns: [
          {
            speakerId: town ? undefined : targets[0]!.id,
            speakerName: town
              ? townWideSpeaker({
                  ascii,
                  packId: state.packId,
                })
              : targets[0]!.name,
            text,
          },
        ],
      },
    };
    state.events.push(ev);
    clearTalkCooldownAfterWhispers(state);
    const useLlm = Boolean(input.llm) && !input.skipTalks;
    const whisperCaps = societyTalkCaps(useLlm);
    let follow: SocietyEvent[] = [];
    let talksFailed = false;
    try {
      follow = input.skipTalks
        ? []
        : await stepSociety(state, {
            dtHours: societyDtHours(),
            ...(useLlm ? { llm: input.llm } : {}),
            maxConversationsPerStep: Math.max(4, whisperCaps.total),
            maxLlmConversationsPerStep: useLlm ? Math.max(2, whisperCaps.llm) : 0,
            maxPlanLlmCallsPerStep: 0,
            converseOnlyLlm: true,
            skipConversations: useLlm,
            maxPendingTalks: 8,
            embed: societyEmbedder(),
          });
    } catch {
      // Trace already landed in MemoryStream. Do not throw — commerce would
      // stamp a second copy, and the visitor would see a 5xx after paying.
      talksFailed = true;
      follow = [];
    }
    const pendingTalks = useLlm && !talksFailed ? [...(state.pendingTalks ?? [])] : [];
    if (useLlm) state.pendingTalks = [];
    await persistSocietyState(input.db, input.worldId, state, [
      ev,
      ...follow,
    ]);
    const degraded =
      talksFailed ||
      follow.some(
        (e) => e.kind === 'dialogue' && e.payload['degraded'] === true,
      );
    return {
      simTime: state.simTime,
      events: [ev, ...follow].map(eventDto),
      agents: agentSnapshot(state),
      relations: relationSnapshot(state),
      objects: objectSnapshot(state),
      rumor: town,
      focusAgentId: targets[0]?.id ?? null,
      pendingTalks,
      ...societyClockMeta({
        llmConfigured: Boolean(input.llm),
        useLlm: useLlm && !talksFailed,
        events: follow,
        retrievalDegraded: !societyEmbedder(),
      }),
      degraded,
    };
  },
    { holdMs: 25_000, waitMs: WORLD_LOCK_WAIT_INTERVENE_MS },
  );
  const talksStarted = result.pendingTalks.length;
  if (talksStarted) {
    scheduleSocietyTalkTail({
      db: input.db,
      worldId: input.worldId,
      specJson: input.specJson,
      llm: input.llm,
      jobs: result.pendingTalks,
    });
  }
  const { pendingTalks: _pending, ...rest } = result;
  return { ...rest, talksStarted };
}

/** Paid 巷议 / 认养 must land on MemoryStream even when the town cannot talk now. */
export async function stampPaidSocietyTrace(input: {
  readonly db: DrizzleDb;
  readonly worldId: string;
  readonly specJson: unknown;
  readonly text: string;
  readonly agentKey?: string;
  readonly forceTown?: boolean;
  readonly adopt?: boolean;
  readonly importance?: number;
  readonly courseNeutral?: boolean;
}): Promise<Awaited<ReturnType<typeof whisperSocietyLive>>> {
  try {
    return await whisperSocietyLive({
      ...input,
      skipTalks: true,
    });
  } catch (err) {
    if (isSocietyBusyError(err) || isSocietyTickTimeoutError(err)) {
      return persistPaidTraceUnlocked(input);
    }
    throw err;
  }
}

async function persistPaidTraceUnlocked(input: {
  readonly db: DrizzleDb;
  readonly worldId: string;
  readonly specJson: unknown;
  readonly text: string;
  readonly agentKey?: string;
  readonly forceTown?: boolean;
  readonly adopt?: boolean;
  readonly importance?: number;
  readonly courseNeutral?: boolean;
}): Promise<Awaited<ReturnType<typeof whisperSocietyLive>>> {
  const text = input.text.trim();
  if (!text) throw new Error('empty whisper');
  const agents = await loadSocietyAgents(input.db, input.worldId);
  const town = Boolean(input.forceTown) || !input.agentKey;
  const targets = town
    ? agents
    : agents.filter((a) => a.id === input.agentKey);
  if (!targets.length) throw new Error('agent not found');
  const tip = await loadSocietyLiveTip(input.db, input.worldId);
  const simTime = tip.simTime;
  const stamp = paidTraceStamp(text, simTime);
  const ascii = societyCopyAscii({
    agents: agents.map((a) => ({
      name: a.name,
      identitySummary: a.identitySummary,
    })),
  });
  let packId: string | undefined;
  try {
    const spec = parseWorldSpec(input.specJson);
    const profile = spec.presentation?.genreProfile;
    if (profile && typeof profile === 'object' && 'id' in profile) {
      packId = String((profile as { id?: string }).id ?? '') || undefined;
    }
  } catch {
    packId = undefined;
  }
  const memoryText = town ? rumorMemory(text, ascii) : whisperMemory(text, ascii);
  const importance = Math.max(
    1,
    Math.min(16, input.importance ?? (input.adopt ? 13 : 8)),
  );
  const added: ReturnType<typeof createMemoryEntry>[] = [];
  for (const a of targets) {
    added.push(
      createMemoryEntry({
        id: `whisper_${a.id}_${stamp}`,
        agentId: a.id,
        kind: 'observation',
        text: memoryText,
        simTime,
        importance,
      }),
    );
    if (input.adopt) {
      added.push(
        createMemoryEntry({
          id: `adopt_${a.id}_${stamp}`,
          agentId: a.id,
          kind: 'observation',
          text: ascii
            ? `【认养】Someone adopted you. Keep the days clearer.`
            : `【认养】有人认养了你，要把日子记得更清楚。`,
          simTime,
          importance: 13,
        }),
      );
    }
  }
  const stream = new MemoryStream();
  for (const m of added) stream.add(m);
  const relations = new Map<string, SocietyRelation>();
  stampPaidInfluence(relations, {
    agentIds: targets.map((a) => a.id),
    adopt: input.adopt,
    rumorText: text,
    ascii,
  });
  if (input.adopt) {
    await reflectAdoptedTargets({
      stream,
      targets,
      simTime,
      stamp,
    });
  }
  const reflected = stream
    .all()
    .filter((m) => !added.some((x) => x.id === m.id));
  await persistSocietyMemories(input.db, input.worldId, [
    ...added,
    ...reflected,
  ]);
  const ev: SocietyEvent = {
    id: `intervene_${town ? 'town' : targets[0]!.id}_${stamp}`,
    simTime,
    kind: 'intervene',
    agentId: town ? undefined : targets[0]!.id,
    payload: {
      kind: town ? 'rumor' : 'whisper',
      text,
      summary: memoryText,
      town,
      stampedUnlocked: true,
      ...paidInterveneTouch({
        town,
        targetIds: targets.map((a) => a.id),
        adopt: input.adopt,
      }),
      ...(input.courseNeutral ? { courseNeutral: true } : {}),
      turns: [
        {
          speakerId: town ? undefined : targets[0]!.id,
          speakerName: town
            ? townWideSpeaker({ ascii, packId })
            : targets[0]!.name,
          text,
        },
      ],
    },
  };
  await persistSocietyState(
    input.db,
    input.worldId,
    {
      simTime,
      agents: [],
      stream: { toJSON: () => [] },
      plans: new Map(),
      relations,
    },
    [ev],
    { omitPoses: true },
  );
  return {
    simTime,
    events: [eventDto(ev)],
    agents: agents.map((a) => ({
      id: a.id,
      name: a.name,
      regionId: a.regionId,
      regionName: undefined,
      areaId: undefined,
      areaName: undefined,
      x: a.x,
      y: a.y,
      currentAction: a.currentAction,
      padded: undefined,
      stance: undefined,
      goalX: undefined,
      goalY: undefined,
      goalPlace: undefined,
      goalReason: undefined,
      drive: undefined,
      needs: undefined,
    })),
    relations: snapshotPaidRelations(relations, simTime),
    objects: [],
    rumor: town,
    focusAgentId: targets[0]?.id ?? null,
    ...societyClockMeta({
      llmConfigured: false,
      useLlm: false,
      events: [],
      retrievalDegraded: !societyEmbedder(),
    }),
    talksMuted: true,
    talksStarted: 0,
    degraded: true,
  };
}

/** Mutate an object at the live tip — no rewind. Next plans see the new state. */
export async function setObjectSocietyLive(input: {
  readonly db: DrizzleDb;
  readonly worldId: string;
  readonly specJson: unknown;
  readonly objectId: string;
  readonly objectState: string;
}): Promise<{
  simTime: number;
  events: ReturnType<typeof eventDto>[];
  agents: ReturnType<typeof agentSnapshot>;
  relations: ReturnType<typeof relationSnapshot>;
  objects: ReturnType<typeof objectSnapshot>;
  focusAgentId: string | null;
}> {
  return withWorldLock(
    input.worldId,
    async () => {
      const { state } = await hydrateSocietyState({
        ...input,
        live: true,
      });
      const objectId = input.objectId.trim();
      const nextState = input.objectState.trim() || 'changed';
      const obj = state.objects.find((o) => o.id === objectId);
      if (!obj) throw new Error('object not found');
      applyObjectStateEvents(state.objects, [
        {
          kind: 'use-object',
          payload: { objectId, state: nextState },
        },
      ]);
      const ev: SocietyEvent = {
        id: `setobj_${objectId}_${Date.now()}`,
        simTime: state.simTime,
        kind: 'use-object',
        payload: {
          objectId,
          name: obj.name,
          state: nextState,
          intervened: true,
        },
      };
      state.events.push(ev);
      const follow = await stepSociety(state, {
        dtHours: societyDtHours(),
        skipConversations: false,
        maxConversationsPerStep: 2,
        maxLlmConversationsPerStep: 0,
        maxPlanLlmCallsPerStep: 0,
        maxReactLlmCallsPerStep: 0,
      });
      await persistSocietyState(input.db, input.worldId, state, [
        ev,
        ...follow,
      ]);
      const reacted = state.agents.find((a) =>
        /熄了|灭了|改去别处|broken|\bout\b/i.test(
          `${a.goalReason ?? ''} ${a.currentAction ?? ''}`,
        ),
      );
      return {
        simTime: state.simTime,
        events: [ev, ...follow].map(eventDto),
        agents: agentSnapshot(state),
        relations: relationSnapshot(state),
        objects: objectSnapshot(state),
        focusAgentId: reacted?.id ?? null,
      };
    },
    { holdMs: 20_000, waitMs: WORLD_LOCK_WAIT_INTERVENE_MS },
  );
}

export async function continueSocietyHours(input: {
  readonly db: DrizzleDb;
  readonly worldId: string;
  readonly specJson: unknown;
  readonly hours: number;
  readonly seedText?: string;
  readonly invitationText?: string;
  readonly llm?: LlmTextFn;
  /** Default true for API sync FF — only converse hits the model. */
  readonly converseOnlyLlm?: boolean;
}): Promise<{
  events: SocietyEvent[];
  state: SocietyState;
  report: ReturnType<typeof buildEmergenceReportCard>;
  existed: boolean;
}> {
  const hours = Math.min(Math.max(input.hours, 1), 48);
  const useLlm = Boolean(input.llm);
  const ffCaps = societyTalkCaps(useLlm);
  const allEvents: SocietyEvent[] = [];
  let lastState: SocietyState | undefined;
  let existed = false;
  let seedText = '';
  let invitationText = input.invitationText ?? '';
  for (let step = 0; step < hours; step += 1) {
    const chunk = await withWorldLock(
      input.worldId,
      async () => {
        const hyd = await hydrateSocietyState({
          ...input,
          memoryLimit: 800,
        });
        existed = hyd.existed;
        seedText = hyd.seedText;
        invitationText = input.invitationText ?? hyd.invitationText;
        const state = hyd.state;
        const events = await runSocietyHours(state, 1, {
          dtHours: societyDtHours(),
          llm: input.llm,
          converseOnlyLlm: input.converseOnlyLlm ?? true,
          maxConversationsPerStep: Math.max(4, ffCaps.total),
          maxLlmConversationsPerStep: ffCaps.llm,
          embed: societyEmbedder(),
          skipConversations: useLlm,
          maxPendingTalks: 8,
        });
        const pendingTalks = useLlm ? [...(state.pendingTalks ?? [])] : [];
        if (useLlm) state.pendingTalks = [];
        await persistSocietyState(input.db, input.worldId, state, events, {
          fullRelations: true,
        });
        return { events, pendingTalks, state };
      },
      { holdMs: 90_000 },
    );
    allEvents.push(...chunk.events);
    lastState = chunk.state;
    if (chunk.pendingTalks.length) {
      scheduleSocietyTalkTail({
        db: input.db,
        worldId: input.worldId,
        specJson: input.specJson,
        llm: input.llm,
        jobs: chunk.pendingTalks,
      });
    }
  }
  const state = lastState!;
  const report = await maybeLlmJudgeReportCard(
    buildEmergenceReportCard({
      state,
      events: allEvents,
      seedText,
      invitationText: invitationText || gatheringInvitationText(),
    }),
    { state, events: allEvents, llm: input.llm },
  );
  await persistEmergenceReport(
    input.db,
    input.worldId,
    state.simTime,
    report as unknown as Record<string, unknown>,
  );
  return { events: allEvents, state, report, existed };
}

/** Spec objects + persisted tip + later observe/use-object events. */
export function objectSnapshotFromSpec(
  specJson: unknown,
  events: ReadonlyArray<{
    kind: string;
    simTime?: number;
    payload?: Record<string, unknown>;
  }>,
  tip?: {
    simTime: number;
    objects: Array<{ id: string; state: string }>;
  } | null,
): ReturnType<typeof objectSnapshot> {
  const spec = parseWorldSpec(specJson);
  const state = societyStateFromSpec(spec);
  replayPersistedObjectStates(state.objects, { tip, events });
  return objectSnapshot(state);
}

/** Stamp area names onto poses from the Spec tree (events GET has no live tick). */
export function annotateAgentsWithAreas<
  T extends { id: string; regionId: string; x: number; y: number },
>(
  specJson: unknown,
  agents: readonly T[],
  events?: ReadonlyArray<{
    kind: string;
    simTime?: number;
    agentId?: string | null;
    payload?: Record<string, unknown>;
  }>,
): Array<
  T & {
    areaId?: string;
    areaName?: string;
    regionName?: string;
    goalX?: number;
    goalY?: number;
    goalPlace?: string;
    goalReason?: string;
    drive?: string;
  }
> {
  const spec = parseWorldSpec(specJson);
  const state = societyStateFromSpec(spec);
  const next: Array<
    T & {
      areaId?: string;
      areaName?: string;
      regionName?: string;
      goalX?: number;
      goalY?: number;
      goalPlace?: string;
      goalReason?: string;
      drive?: string;
    }
  > = agents.map((a) => {
    const hit = nearestAreaAnchor(state.anchors, state.objects, a);
    const regionName = state.anchors?.get(a.regionId)?.name;
    return {
      ...a,
      areaId: hit?.areaId,
      areaName: hit?.areaName,
      regionName:
        regionName && regionName !== a.regionId ? regionName : undefined,
    };
  });
  if (events?.length) applyGoalFromEvents(next, events);
  return next;
}

/** Copy Spec place names onto stored plan segments for the inspector. */
export function stampSocietyPlansFromSpec(
  specJson: unknown,
  plans: ReadonlyArray<{
    dayIndex: number;
    segments: unknown;
    replan?: boolean;
    reason?: string;
  }>,
): Array<{
  dayIndex: number;
  segments: unknown;
  replan?: boolean;
  reason?: string;
}> {
  const spec = parseWorldSpec(specJson);
  const state = societyStateFromSpec(spec);
  const places: PlanPlace[] = [];
  for (const r of spec.space?.regions ?? []) {
    if (!r.id || !r.name) continue;
    places.push({
      id: r.id,
      name: r.name,
      kind: 'other',
      regionId: r.id,
    });
  }
  for (const [id, a] of state.anchors ?? []) {
    if (!a.name) continue;
    places.push({
      id,
      name: a.name,
      kind: a.kind ?? 'other',
      regionId: a.regionId,
    });
  }
  return plans.map((p) => {
    if (!Array.isArray(p.segments)) return p;
    return {
      ...p,
      segments: stampPlaceNames(p.segments as PlanSegment[], places),
    };
  });
}

/**
 * Observatory interview — first-person MiniMax grounded in the resident's
 * stream. The answer is persisted as an observation so later chats can cite it.
 * Do not hold the world lock while the model thinks.
 */
export async function interviewSocietyAgent(input: {
  readonly db: DrizzleDb;
  readonly worldId: string;
  readonly specJson: unknown;
  readonly agentKey: string;
  readonly question: string;
  readonly llm: LlmTextFn;
}): Promise<InterviewResult> {
  const { state } = await hydrateSocietyState({
    db: input.db,
    worldId: input.worldId,
    specJson: input.specJson,
    live: true,
    memoryLimit: 200,
  });
  const agent = state.agents.find((a) => a.id === input.agentKey);
  if (!agent) {
    throw new Error('agent not found');
  }
  const beforeIds = new Set(state.stream.list(agent.id).map((m) => m.id));
  const result = await interviewAgent({
    stream: state.stream,
    agentId: agent.id,
    agentName: agent.name,
    identity: agent.identitySummary,
    occupation: agent.occupation,
    question: input.question,
    nowSimTime: state.simTime,
    llm: input.llm,
    embed: societyEmbedder(),
  });
  if (result.answer) {
    const added = state.stream
      .list(agent.id)
      .filter((m) => !beforeIds.has(m.id));
    if (added.length) {
      await withWorldLock(
        input.worldId,
        async () => {
          await persistSocietyMemories(input.db, input.worldId, added);
        },
        { waitMs: WORLD_LOCK_WAIT_INTERVENE_MS },
      );
    }
  }
  return result;
}

/** Same interview, but recite memories when the hourly MiniMax cap is spent. */
export async function interviewSocietyAgentFromMemories(input: {
  readonly db: DrizzleDb;
  readonly worldId: string;
  readonly specJson: unknown;
  readonly agentKey: string;
  readonly question: string;
}): Promise<InterviewResult> {
  const { state } = await hydrateSocietyState({
    db: input.db,
    worldId: input.worldId,
    specJson: input.specJson,
    live: true,
    memoryLimit: 200,
  });
  const agent = state.agents.find((a) => a.id === input.agentKey);
  if (!agent) {
    throw new Error('agent not found');
  }
  const beforeIds = new Set(state.stream.list(agent.id).map((m) => m.id));
  const result = interviewFromMemories({
    stream: state.stream,
    agentId: agent.id,
    agentName: agent.name,
    identity: agent.identitySummary,
    occupation: agent.occupation,
    question: input.question,
    nowSimTime: state.simTime,
  });
  if (result.answer) {
    const added = state.stream
      .list(agent.id)
      .filter((m) => !beforeIds.has(m.id));
    if (added.length) {
      await withWorldLock(
        input.worldId,
        async () => {
          await persistSocietyMemories(input.db, input.worldId, added);
        },
        { waitMs: WORLD_LOCK_WAIT_INTERVENE_MS },
      );
    }
  }
  return result;
}
