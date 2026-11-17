/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Offline society fast-forward job (Generative Agents style).
 */

import { eq } from 'drizzle-orm';

import {
  invalidateSocietyEventsFrom,
  deleteSocietyMemoriesFrom,
  loadAgentPosesBefore,
  loadSocietyAgents,
  loadSocietyMemoriesBefore,
  loadSocietyPlans,
  loadSocietyRelations,
  loadSocietyReplayBundle,
  persistEmergenceReport,
  persistSocietyEvents,
  persistSocietyState,
  loadOccupancyModel,
  worlds,
  type DrizzleDb,
} from '@opengame/platform-db';
import {
  acquireRedisLock,
  LockBusyError,
  societyWorldLockKey,
  type RedisLikeForLock,
} from '@opengame/platform-shared';
import {
  evaluateEmergenceGate,
  evaluateSocietySeedGate,
  gatheringInvitationText,
  openingRumorFromSpec,
  parseWorldSpec,
  resolveGenreProfile,
  societySeedSoftEnabled,
} from '@opengame/world-spec';
import {
  buildEmergenceReportCard,
  maybeLlmJudgeReportCard,
  clearTalkCooldownAfterWhispers,
  createMemoryEntry,
  overlayPersistedSociety,
  lastConverseAtFromEvents,
  finishSocietyTalks,
  forceSeedReflections,
  runSocietyHours,
  societyStateFromSpec,
  stepSociety,
  truncateEventsAfter,
  applyOccupancySnapshot,
  rumorMemory,
  whisperMemory,
  societyCopyAscii,
  isRumorMemoryText,
  isAsciiCopy,
  embedderFromEnv,
  type LlmTextFn,
  type SocietyEvent,
  type SocietyState,
} from '@opengame/world-agents';

import {
  createSocietyLlmFn,
  resolveSocietyTalkTimeoutMs,
  SocietyLlmKeysExhaustedError,
} from '@opengame/world-planner';

export class SocietySeedGateError extends Error {
  readonly reason: 'dialogue' | 'spread' | 'judge' | 'keys';
  constructor(message: string, reason: 'dialogue' | 'spread' | 'judge' | 'keys') {
    super(message);
    this.name = 'SocietySeedGateError';
    this.reason = reason;
  }
}

import type { AgentEventStream } from './agentEvents.js';

function societyDtHours(): number {
  const n = Number(process.env['PLATFORM_SOCIETY_DT_HOURS'] ?? 0.25);
  return Number.isFinite(n) && n > 0 ? Math.min(1, n) : 0.25;
}

async function restoreOccupancy(
  db: DrizzleDb,
  worldId: string,
  state: SocietyState,
): Promise<void> {
  applyOccupancySnapshot(
    state,
    await loadOccupancyModel(db, worldId).catch(() => null),
  );
}

/** Shared soft timeout for heartbeat, fast-forward, and whisper follow-ups. */
export function societyTalkTimeoutMs(override?: number): number {
  return resolveSocietyTalkTimeoutMs(override);
}

async function withSocietyLock<T>(
  redis: RedisLikeForLock | null | undefined,
  worldId: string,
  fn: () => Promise<T>,
  options?: { readonly ttlMs?: number; readonly waitMs?: number },
): Promise<T> {
  if (!redis) return fn();
  const ttlMs = options?.ttlMs ?? 60_000;
  const lock = await acquireRedisLock(redis, societyWorldLockKey(worldId), {
    ttlMs,
    waitMs: options?.waitMs ?? 60_000,
    autoRenew: true,
  });
  if (!lock) throw new LockBusyError(societyWorldLockKey(worldId));
  try {
    return await fn();
  } finally {
    await lock.release();
  }
}

/** MiniMax-aware LLM for society plan/converse/reflect. */
export async function createSocietyLlm(
  timeoutMs?: number,
  lane: 'floor' | 'lit' = 'floor',
  opts?: { readonly consumeEmergency?: () => Promise<boolean> },
): Promise<LlmTextFn | undefined> {
  return createSocietyLlmFn({
    timeoutMs: societyTalkTimeoutMs(timeoutMs),
    lane,
    consumeEmergency: opts?.consumeEmergency,
  });
}

export async function runWorldSocietyJob(input: {
  readonly db: DrizzleDb;
  readonly stream: AgentEventStream;
  readonly projectId: string;
  readonly jobId: string;
  readonly hours?: number;
  readonly seedText?: string;
  readonly invitationText?: string;
  readonly redis?: RedisLikeForLock | null;
  /** Generate-time seed: walk first, then keep a handful of real MiniMax lines. */
  readonly useLlm?: boolean;
}): Promise<{
  readonly events: number;
  readonly simTime: number;
  readonly dialogues: number;
  readonly degraded: boolean;
  readonly gateFailed: boolean;
  readonly retrievalDegraded: boolean;
  readonly report: ReturnType<typeof buildEmergenceReportCard>;
}> {
  const hours = Math.min(Math.max(input.hours ?? 16, 1), 72);
  const [worldRow] = await input.db
    .select()
    .from(worlds)
    .where(eq(worlds.projectId, input.projectId))
    .limit(1);
  if (!worldRow) throw new Error('no world for society run');

  const useLlm = input.useLlm !== false;
  return withSocietyLock(
    input.redis,
    worldRow.id,
    () => runWorldSocietyJobUnlocked(input, worldRow, hours),
    {
      ttlMs: Math.max(useLlm ? 480_000 : 90_000, hours * (useLlm ? 80_000 : 12_000)),
      waitMs: 90_000,
    },
  );
}

function townSeedRumorEvent(
  simTime: number,
  seedText: string,
  ascii = isAsciiCopy(seedText),
): SocietyEvent {
  const summary =
    isRumorMemoryText(seedText) || /heard from peer/i.test(seedText)
      ? seedText
      : rumorMemory(seedText, ascii);
  return {
    id: `seed_rumor_${Math.floor(simTime * 100)}`,
    simTime,
    kind: 'intervene',
    payload: {
      kind: 'rumor',
      text: seedText,
      summary,
      town: true,
      seed: true,
    },
  };
}

async function runHoursDrainingTalks(input: {
  readonly state: SocietyState;
  readonly hours: number;
  readonly llm: LlmTextFn | undefined;
  readonly stream: AgentEventStream;
  readonly onTalkEvent?: (event: SocietyEvent) => void | Promise<void>;
}): Promise<SocietyEvent[]> {
  const { state, hours, llm, stream, onTalkEvent } = input;
  const embed = embedderFromEnv();
  const opts = {
    dtHours: societyDtHours(),
    ...(llm ? { llm } : {}),
    ...(embed ? { embed } : {}),
    maxLlmConversationsPerStep: llm ? 2 : 0,
    maxPlanLlmCallsPerStep: 0,
    maxReactLlmCallsPerStep: llm ? 1 : 0,
    converseOnlyLlm: true as const,
    skipConversations: Boolean(llm),
    maxPendingTalks: 4,
    ...(onTalkEvent ? { onTalkEvent } : {}),
  };
  const all: SocietyEvent[] = [];
  const mid = hours >= 4 ? 2 : 0;
  const chunks = mid > 0 ? [mid, hours - mid] : [hours];
  for (const chunk of chunks) {
    if (chunk <= 0) continue;
    all.push(...(await runSocietyHours(state, chunk, opts)));
    if (llm && (state.pendingTalks?.length ?? 0) > 0) {
      await stream.emit('planner', 'WORLD', {
        summary: `种子对白 ${state.pendingTalks!.length} 场（真实模型，不编造）`,
      });
      all.push(
        ...(await finishSocietyTalks(state, {
          llm,
          converseOnlyLlm: true,
          ...(embed ? { embed } : {}),
          ...(onTalkEvent ? { onTalkEvent } : {}),
        })),
      );
    }
  }
  return all;
}

async function runWorldSocietyJobUnlocked(
  input: {
    readonly db: DrizzleDb;
    readonly stream: AgentEventStream;
    readonly projectId: string;
    readonly jobId: string;
    readonly seedText?: string;
    readonly invitationText?: string;
    readonly useLlm?: boolean;
  },
  worldRow: { id: string; specJson: unknown },
  hours: number,
): Promise<{
  readonly events: number;
  readonly simTime: number;
  readonly dialogues: number;
  readonly degraded: boolean;
  readonly gateFailed: boolean;
  readonly retrievalDegraded: boolean;
  readonly report: ReturnType<typeof buildEmergenceReportCard>;
}> {

  const spec = parseWorldSpec(worldRow.specJson);
  const npcs = spec.entities.filter((e) => e.kind === 'npc');
  if (npcs.length < 2) {
    throw new Error('society run needs ≥2 NPCs in World Spec');
  }

  await input.stream.emit('planner', 'WORLD', {
    summary: `Society fast-forward ${hours}h · ${npcs.length} agents`,
    details: { hours, npcCount: npcs.length },
  });

  const seedText =
    input.seedText ?? openingRumorFromSpec(npcs[0]!.name, spec);
  const invitationText =
    input.invitationText ?? gatheringInvitationText(spec);
  const useLlm = input.useLlm !== false;
  const soft = societySeedSoftEnabled();
  const llm = useLlm ? await createSocietyLlm(societyTalkTimeoutMs()) : undefined;
  if (useLlm && !llm) {
    if (!soft) {
      throw new SocietyLlmKeysExhaustedError(
        '社会种子需要推理密钥；未配置则禁止启发式装真对白',
      );
    }
    console.warn(
      '[society-run] 未配置推理密钥，软过门禁：种子快进只用碰面记忆扩散，不冒充模型对白',
    );
  }
  const state = societyStateFromSpec(spec, { seedText });
  const prior = await loadSocietyAgents(input.db, worldRow.id);
  if (prior.length > 0) {
    const bundle = await loadSocietyReplayBundle(input.db, worldRow.id);
    overlayPersistedSociety(state, {
      simTime: bundle.simTime || state.simTime,
      agents: prior,
      memories: await loadSocietyMemoriesBefore(input.db, worldRow.id, 1e12),
      plans: await loadSocietyPlans(input.db, worldRow.id),
      relations: await loadSocietyRelations(input.db, worldRow.id),
      lastConverseAt: lastConverseAtFromEvents(bundle.events),
      events: bundle.events,
    });
    await restoreOccupancy(input.db, worldRow.id, state);
  }

  const seedEvents: SocietyEvent[] =
    prior.length === 0
      ? [townSeedRumorEvent(state.simTime, seedText, societyCopyAscii(state))]
      : [];
  const allEvents = [
    ...seedEvents,
    ...(await runHoursDrainingTalks({
      state,
      hours,
      llm,
      stream: input.stream,
      onTalkEvent: (event) =>
        persistSocietyEvents(input.db, worldRow.id, [event]),
    })),
  ];
  let reflectSeq = 0;
  await forceSeedReflections({
    stream: state.stream,
    agents: state.agents.map((a) => ({ id: a.id, name: a.name })),
    nowSimTime: state.simTime,
    sinceSimTime: Math.max(0, state.simTime - hours),
    llm,
    count: 3,
    idFactory: () => `seed_reflect_${reflectSeq++}`,
  });
  // Multi-hour offline run: every pair may have shifted.
  await persistSocietyState(input.db, worldRow.id, state, allEvents, {
    fullRelations: true,
  });

  const dialogues = allEvents.filter(
    (e) =>
      e.kind === 'dialogue' &&
      e.payload?.['degraded'] !== true &&
      e.payload?.['skipEvent'] !== true &&
      e.payload?.['skipped'] !== true,
  ).length;
  const templateSpoken = allEvents.some(
    (e) =>
      e.kind === 'dialogue' &&
      e.payload?.['degraded'] === true &&
      e.payload?.['skipped'] !== true,
  );
  const degraded = dialogues === 0 && (templateSpoken || !llm);
  const keysDead = allEvents.some(
    (e) => e.payload?.['skipReason'] === 'keys_exhausted',
  );

  const report = await maybeLlmJudgeReportCard(
    buildEmergenceReportCard({
      state,
      events: allEvents,
      seedText,
      invitationText,
    }),
    { state, events: allEvents, llm },
  );
  const profile = resolveGenreProfile(spec);
  const seedGate = evaluateSocietySeedGate({
    hours,
    spreadRate: report.informationSpread.rate,
    dialogues,
    profile,
    citesMemory: report.dialogueQuality?.citesMemory,
    followsLast: report.dialogueQuality?.followsLast,
  });
  const retrievalDegraded = !embedderFromEnv();
  const gateFailed = Boolean(
    (seedGate.gateFailed || keysDead) && !soft,
  );
  await persistEmergenceReport(
    input.db,
    worldRow.id,
    state.simTime,
    {
      ...(report as unknown as Record<string, unknown>),
      seed: {
        hours,
        dialogues,
        degraded,
        spreadOk: seedGate.spreadOk,
        gateFailed,
        reason: keysDead ? 'keys' : seedGate.reason,
        retrievalDegraded,
      },
    },
  );

  const windowGate = evaluateEmergenceGate(
    hours,
    report.informationSpread.rate,
    profile,
  );
  await input.stream.emit('qa', 'WORLD', {
    tool: 'society-emergence',
    summary: `涌现报告 · spread=${(report.informationSpread.rate * 100).toFixed(0)}% · 真对白 ${dialogues} · ${report.summary}`,
    details: {
      report,
      eventCount: allEvents.length,
      simTime: state.simTime,
      hours,
      dialogues,
      degraded,
      spreadOk: seedGate.spreadOk,
      windowHours: windowGate.windowHours,
      minSpread: seedGate.minSpread,
      gateFailed,
      retrievalDegraded,
    },
  });

  if (keysDead && !soft) {
    throw new SocietyLlmKeysExhaustedError(
      '社会种子密钥耗尽：禁止启发式装真对白',
    );
  }
  if (seedGate.gateFailed && !soft) {
    throw new SocietySeedGateError(
      seedGate.reason === 'dialogue'
        ? `社会种子门禁失败：0 句真对白（${hours}h）`
        : seedGate.reason === 'judge'
          ? `社会种子门禁失败：对白只在复读，没有引用记忆`
          : `社会种子门禁失败：传播率 ${(report.informationSpread.rate * 100).toFixed(0)}% < ${(seedGate.minSpread * 100).toFixed(0)}% after ${hours}h`,
      seedGate.reason === 'ok' ? 'spread' : seedGate.reason,
    );
  }

  return {
    events: allEvents.length,
    simTime: state.simTime,
    dialogues,
    degraded,
    gateFailed,
    retrievalDegraded,
    report,
  };
}

export async function interveneSociety(input: {
  readonly db: DrizzleDb;
  readonly projectId: string;
  readonly fromSimTime: number;
  readonly kind: 'whisper' | 'set_object' | 'inject_event' | 'policy';
  readonly agentKey?: string;
  readonly text?: string;
  readonly objectId?: string;
  readonly objectState?: string;
  readonly recomputeHours?: number;
  readonly redis?: RedisLikeForLock | null;
}): Promise<{ events: number; simTime: number }> {
  const [worldRow] = await input.db
    .select()
    .from(worlds)
    .where(eq(worlds.projectId, input.projectId))
    .limit(1);
  if (!worldRow) throw new Error('no world');
  const hours = Math.min(Math.max(input.recomputeHours ?? 6, 1), 48);
  return withSocietyLock(
    input.redis,
    worldRow.id,
    () => interveneSocietyUnlocked(input, worldRow),
    { ttlMs: Math.max(60_000, hours * 12_000), waitMs: 60_000 },
  );
}

async function interveneSocietyUnlocked(
  input: {
    readonly db: DrizzleDb;
    readonly fromSimTime: number;
    readonly kind: 'whisper' | 'set_object' | 'inject_event' | 'policy';
    readonly agentKey?: string;
    readonly text?: string;
    readonly objectId?: string;
    readonly objectState?: string;
    readonly recomputeHours?: number;
  },
  worldRow: { id: string; specJson: unknown },
): Promise<{ events: number; simTime: number }> {

  const liveWhisper =
    (input.kind === 'whisper' || input.kind === 'inject_event') &&
    Boolean(input.text?.trim()) &&
    !(typeof input.recomputeHours === 'number' && input.recomputeHours > 0);
  if (liveWhisper) {
    const spec = parseWorldSpec(worldRow.specJson);
    const state = societyStateFromSpec(spec);
    const bundle = await loadSocietyReplayBundle(input.db, worldRow.id);
    const prior = await loadSocietyAgents(input.db, worldRow.id);
    overlayPersistedSociety(state, {
      simTime: bundle.simTime || state.simTime,
      agents: prior,
      memories: await loadSocietyMemoriesBefore(input.db, worldRow.id, 1e12),
      plans: await loadSocietyPlans(input.db, worldRow.id),
      relations: await loadSocietyRelations(input.db, worldRow.id),
      lastConverseAt: lastConverseAtFromEvents(bundle.events),
      events: bundle.events,
    });
    await restoreOccupancy(input.db, worldRow.id, state);
    const text = input.text!.trim();
    const town = !input.agentKey;
    const targets = town
      ? state.agents
      : state.agents.filter((a) => a.id === input.agentKey);
    if (!targets.length) throw new Error('agent not found');
    const simTime = state.simTime;
    const stamp = `${simTime}_${Date.now()}`;
    const memoryText = town
      ? rumorMemory(text, societyCopyAscii(state))
      : whisperMemory(text, societyCopyAscii(state));
    for (const a of targets) {
      state.stream.add(
        createMemoryEntry({
          id: `whisper_${a.id}_${stamp}`,
          agentId: a.id,
          kind: 'observation',
          text: memoryText,
          simTime,
          importance: 8,
        }),
      );
    }
    const ev: SocietyEvent = {
      id: `intervene_${town ? 'town' : targets[0]!.id}_${stamp}`,
      simTime,
      kind: 'intervene',
      agentId: town ? undefined : targets[0]!.id,
      payload: {
        kind: input.kind === 'inject_event' ? 'inject_event' : town ? 'rumor' : 'whisper',
        text,
        summary: memoryText,
        town,
      },
    };
    state.events.push(ev);
    clearTalkCooldownAfterWhispers(state);
    const llm = await createSocietyLlm(societyTalkTimeoutMs());
    const follow = await stepSociety(state, {
      dtHours: societyDtHours(),
      llm,
      converseOnlyLlm: true,
    });
    await persistSocietyState(input.db, worldRow.id, state, [ev, ...follow]);
    return { events: 1 + follow.length, simTime: state.simTime };
  }

  await invalidateSocietyEventsFrom(
    input.db,
    worldRow.id,
    input.fromSimTime,
  );
  await deleteSocietyMemoriesFrom(input.db, worldRow.id, input.fromSimTime);

  const spec = parseWorldSpec(worldRow.specJson);
  const state = societyStateFromSpec(spec);
  truncateEventsAfter(state, input.fromSimTime);

  const poses = await loadAgentPosesBefore(
    input.db,
    worldRow.id,
    input.fromSimTime,
  );
  const priorAgents = await loadSocietyAgents(input.db, worldRow.id);
  const remaining = await loadSocietyReplayBundle(input.db, worldRow.id);
  overlayPersistedSociety(state, {
    simTime: input.fromSimTime,
    agents: priorAgents,
    memories: await loadSocietyMemoriesBefore(
      input.db,
      worldRow.id,
      input.fromSimTime,
    ),
    plans: await loadSocietyPlans(input.db, worldRow.id),
    relations: await loadSocietyRelations(input.db, worldRow.id),
    lastConverseAt: lastConverseAtFromEvents(
      remaining.events.filter((e) => e.simTime < input.fromSimTime),
    ),
    events: remaining.events.filter((e) => e.simTime < input.fromSimTime),
  });
  for (const a of priorAgents) {
    const cur = state.agents.find((x) => x.id === a.id);
    if (!cur) continue;
    const pose = poses.get(a.id);
    if (pose) {
      cur.x = pose.x;
      cur.y = pose.y;
      cur.regionId = pose.regionId;
      cur.currentAction = pose.currentAction;
    }
  }

  if (
    (input.kind === 'whisper' || input.kind === 'inject_event') &&
    input.text &&
    (input.agentKey || input.kind === 'inject_event')
  ) {
    const memoryText = whisperMemory(
      input.text,
      societyCopyAscii(state),
    );
    const targetIds =
      input.kind === 'inject_event' && !input.agentKey
        ? state.agents.map((a) => a.id)
        : [input.agentKey!];
    const stamp = Date.now();
    for (const agentId of targetIds) {
      state.stream.add(
        createMemoryEntry({
          id: `whisper_${agentId}_${stamp}`,
          agentId,
          kind: 'observation',
          text: memoryText,
          simTime: input.fromSimTime,
          importance: 8,
        }),
      );
    }
    state.events.push({
      id: `intervene_${stamp}`,
      simTime: input.fromSimTime,
      kind: 'intervene',
      agentId: input.agentKey,
      payload: {
        kind: input.kind === 'inject_event' ? 'inject_event' : 'whisper',
        text: input.text,
        summary: memoryText,
      },
    });
  }
  if (input.kind === 'set_object' && input.objectId) {
    const existing = state.objects.find((o) => o.id === input.objectId);
    if (existing) {
      const idx = state.objects.indexOf(existing);
      state.objects[idx] = {
        ...existing,
        state: input.objectState ?? 'changed',
      };
    } else {
      state.objects.push({
        id: input.objectId,
        areaId: 'intervened',
        name: input.objectId,
        state: input.objectState ?? 'changed',
      });
    }
  }

  const hours = Math.min(Math.max(input.recomputeHours ?? 6, 1), 48);
  const llm = await createSocietyLlm(societyTalkTimeoutMs());
  const embed = embedderFromEnv();
  const events = await runSocietyHours(state, hours, {
    dtHours: societyDtHours(),
    llm,
    ...(embed ? { embed } : {}),
  });
  // Rewind recomputed the graph from scratch; write all of it.
  await persistSocietyState(input.db, worldRow.id, state, events, {
    fullRelations: true,
  });
  return { events: events.length, simTime: state.simTime };
}

/** Sync helper used by API (same persist path as worker). */
export async function runSocietySync(input: {
  readonly db: DrizzleDb;
  readonly worldId: string;
  readonly specJson: unknown;
  readonly hours: number;
  readonly seedText?: string;
  readonly invitationText?: string;
  readonly llm?: LlmTextFn;
}): Promise<{
  events: SocietyEvent[];
  state: SocietyState;
  report: ReturnType<typeof buildEmergenceReportCard>;
}> {
  const spec = parseWorldSpec(input.specJson);
  const npcs = spec.entities.filter((e) => e.kind === 'npc');
  if (npcs.length < 2) throw new Error('need ≥2 NPCs for society run');
  const seedText =
    input.seedText ?? openingRumorFromSpec(npcs[0]!.name, spec);
  const invitationText =
    input.invitationText ?? gatheringInvitationText(spec);
  const state = societyStateFromSpec(spec, { seedText });
  const prior = await loadSocietyAgents(input.db, input.worldId);
  if (prior.length > 0) {
    const bundle = await loadSocietyReplayBundle(input.db, input.worldId);
    overlayPersistedSociety(state, {
      simTime: bundle.simTime || state.simTime,
      agents: prior,
      memories: await loadSocietyMemoriesBefore(input.db, input.worldId, 1e12),
      plans: await loadSocietyPlans(input.db, input.worldId),
      relations: await loadSocietyRelations(input.db, input.worldId),
      lastConverseAt: lastConverseAtFromEvents(bundle.events),
      events: bundle.events,
    });
    await restoreOccupancy(input.db, input.worldId, state);
  }
  const embed = embedderFromEnv();
  const events = await runSocietyHours(state, input.hours, {
    dtHours: societyDtHours(),
    llm: input.llm,
    ...(embed ? { embed } : {}),
  });
  await persistSocietyState(input.db, input.worldId, state, events, {
    fullRelations: true,
  });
  const report = await maybeLlmJudgeReportCard(
    buildEmergenceReportCard({
      state,
      events,
      seedText,
      invitationText,
    }),
    { state, events, llm: input.llm },
  );
  return { events, state, report };
}
