/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared society persistence for API + worker (full agents/memories/plans/relations/events).
 */

import { and, desc, eq, notInArray, sql } from 'drizzle-orm';

import {
  agentMemories,
  agentOpinions,
  agentPlans,
  agentRelations,
  crowdCohorts,
  societyEvents,
  societyForecasts,
  worldAgents,
  worldPolicies,
  worlds,
} from './schema.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = { insert: any; update: any; select: any; delete: any };

/** Minimal structural types — avoid hard dep cycle with world-agents. */
export interface PersistableSocietyState {
  simTime: number;
  agents: Array<{
    id: string;
    name: string;
    identitySummary: string;
    regionId: string;
    x: number;
    y: number;
    currentAction: string;
    needs?: Record<string, number>;
    secret?: string;
    stance?: string;
    withholdFrom?: readonly string[];
  }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stream: { toJSON(): any[] };
  plans: Map<string, { dayIndex: number; segments: unknown }>;
  relations: Map<string, { summary: string; affinity: number }>;
}

export interface PersistableSocietyEvent {
  id: string;
  simTime: number;
  kind: string;
  agentId?: string;
  payload: Record<string, unknown>;
  createdAtMs?: number;
}

function talkSeqOfPayload(
  payload: Record<string, unknown> | null | undefined,
): number {
  const n = Number(payload?.['talkSeq']);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Same simTime: talkSeq, then createdAt, then event id. */
export function comparePersistedSocietyEvents(
  a: Pick<PersistableSocietyEvent, 'id' | 'simTime' | 'payload' | 'createdAtMs'>,
  b: Pick<PersistableSocietyEvent, 'id' | 'simTime' | 'payload' | 'createdAtMs'>,
): number {
  if (a.simTime !== b.simTime) return a.simTime - b.simTime;
  const sa = talkSeqOfPayload(a.payload);
  const sb = talkSeqOfPayload(b.payload);
  if (sa !== sb) return sa - sb;
  const ca = a.createdAtMs ?? 0;
  const cb = b.createdAtMs ?? 0;
  if (ca !== cb) return ca - cb;
  return String(a.id).localeCompare(String(b.id));
}

export interface PersistSocietyOptions {
  /**
   * Rewrite every relation row rather than only those touched this step. Needed
   * after a rewind or fast-forward, where the whole graph was recomputed.
   */
  readonly fullRelations?: boolean;
  /**
   * Skip `world_agents` upsert. Dialogue-only persist after a background LLM
   * must not overwrite poses a later walk already wrote.
   */
  readonly omitPoses?: boolean;
  /**
   * When set, only these residents are upserted. Empty array skips the pose
   * write (same as omitPoses). Omit the field to write every resident.
   */
  readonly onlyAgentKeys?: readonly string[];
}

/** Singleton meta rows stored in `society_events` — never replayed as beats. */
export const SOCIETY_EMERGENCE_EVENT_KEY = 'emergence_report_latest';
export const SOCIETY_OCCUPANCY_EVENT_KEY = 'society_occupancy_ema';
export const SOCIETY_OBJECT_TIP_EVENT_KEY = 'society_object_tip';
/** Policies, opinions, crowd histograms — one meta row, no schema migration. */
export const SOCIETY_MIND_EVENT_KEY = 'society_mind_tip';
export const SOCIETY_POLICY_EVENT_KEY = 'society_policy';
export const SOCIETY_OPINION_EVENT_KEY = 'society_opinion_tip';
export const SOCIETY_CROWD_EVENT_KEY = 'society_crowd_tip';

/**
 * Live ticks rewrite the singleton emergence card. Seed hours / 真对白 /
 * gateFailed must survive that upsert — otherwise the observatory first paint
 * looks like an empty mind after a few walks.
 */
export function mergeEmergenceReport(
  incoming: Record<string, unknown>,
  previous: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!previous) return incoming;
  const prevSeed = previous['seed'];
  const nextSeed = incoming['seed'];
  const seed =
    nextSeed && typeof nextSeed === 'object'
      ? {
          ...(typeof prevSeed === 'object' && prevSeed
            ? (prevSeed as Record<string, unknown>)
            : {}),
          ...(nextSeed as Record<string, unknown>),
        }
      : prevSeed ?? nextSeed;
  return seed != null ? { ...incoming, seed } : incoming;
}

function identityCardJson(a: PersistableSocietyState['agents'][number]): Record<
  string,
  unknown
> {
  const withhold = Array.isArray(a.withholdFrom)
    ? a.withholdFrom.filter((id) => typeof id === 'string' && id.trim())
    : [];
  return {
    summary: a.identitySummary,
    ...(a.secret ? { secret: a.secret } : {}),
    ...(a.stance ? { stance: a.stance } : {}),
    ...(withhold.length ? { withholdFrom: withhold } : {}),
  };
}

export function isSocietyMetaEventKey(key: string): boolean {
  return (
    key === SOCIETY_EMERGENCE_EVENT_KEY ||
    key === SOCIETY_OCCUPANCY_EVENT_KEY ||
    key === SOCIETY_OBJECT_TIP_EVENT_KEY ||
    key === SOCIETY_MIND_EVENT_KEY ||
    key === SOCIETY_POLICY_EVENT_KEY ||
    key === SOCIETY_OPINION_EVENT_KEY ||
    key === SOCIETY_CROWD_EVENT_KEY
  );
}

function notMetaEventKeySql() {
  return sql`${societyEvents.eventKey} NOT IN ('emergence_report_latest', 'society_occupancy_ema', 'society_object_tip', 'society_mind_tip', 'society_policy', 'society_opinion_tip', 'society_crowd_tip')`;
}

export type OccupancyModelSnapshot = {
  ema?: number[];
  prev?: number[];
  surprise?: number;
  history?: number[];
};

export type ObjectTipSnapshot = {
  objects: Array<{ id: string; state: string }>;
};

function objectTipOf(state: PersistableSocietyState): ObjectTipSnapshot | null {
  const objects = (
    state as {
      objects?: Array<{ id?: unknown; state?: unknown }>;
    }
  ).objects;
  if (!Array.isArray(objects) || objects.length === 0) return null;
  const rows = objects
    .filter(
      (o): o is { id: string; state: string } =>
        typeof o.id === 'string' && typeof o.state === 'string',
    )
    .map((o) => ({ id: o.id, state: o.state }));
  return rows.length ? { objects: rows } : null;
}

function occupancySnapshotOf(
  state: PersistableSocietyState,
): OccupancyModelSnapshot | null {
  const wm = (
    state as {
      worldModel?: { snapshot?: () => OccupancyModelSnapshot };
    }
  ).worldModel;
  if (typeof wm?.snapshot !== 'function') return null;
  try {
    const snap = wm.snapshot();
    if (!snap || typeof snap !== 'object') return null;
    if (!Array.isArray(snap.ema) || snap.ema.length === 0) return null;
    return snap;
  } catch {
    return null;
  }
}

export async function persistSocietyState(
  db: AnyDb,
  worldId: string,
  state: PersistableSocietyState,
  newEvents: PersistableSocietyEvent[],
  options: PersistSocietyOptions = {},
): Promise<void> {
  const now = new Date();
  const [alive] = (await db
    .select({ id: worlds.id })
    .from(worlds)
    .where(eq(worlds.id, worldId))
    .limit(1)) as Array<{ id: string }>;
  if (!alive) return;

  // Batch agent upserts (one round-trip).
  const poseKeys = options.onlyAgentKeys;
  const poseAgents =
    poseKeys == null
      ? state.agents
      : state.agents.filter((a) => poseKeys.includes(a.id));
  if (!options.omitPoses && poseAgents.length) {
    const agentValues = poseAgents.map((a) => {
      const x = Number.isFinite(a.x) ? a.x : 1;
      const y = Number.isFinite(a.y) ? a.y : 1;
      return {
        worldId,
        agentKey: a.id,
        name: a.name,
        identityJson: identityCardJson(a),
        regionId: a.regionId || 'town',
        x: String(x),
        y: String(y),
        currentAction: a.currentAction,
        needsJson: a.needs ?? {},
        updatedAt: now,
      };
    });
    await db
      .insert(worldAgents)
      .values(agentValues)
      .onConflictDoUpdate({
        target: [worldAgents.worldId, worldAgents.agentKey],
        set: {
          name: sql`excluded.name`,
          identityJson: sql`excluded.identity_json`,
          regionId: sql`excluded.region_id`,
          x: sql`excluded.x`,
          y: sql`excluded.y`,
          currentAction: sql`excluded.current_action`,
          needsJson: sql`excluded.needs_json`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }

  const memoryCutoff = state.simTime - 3;
  const memoryRows: Array<{
    worldId: string;
    agentKey: string;
    memoryKey: string;
    kind: string;
    text: string;
    simTime: string;
    importance: number;
    embedding: number[] | null;
    lastAccessSimTime: string;
    pointersJson: string[];
  }> = [];
  for (const m of state.stream.toJSON()) {
    const memoryKey = String(m['id'] ?? '');
    if (!memoryKey) continue;
    const simTime = Number(m['simTime']);
    const importance = Number(m['importance'] ?? 3);
    if (Number.isFinite(simTime) && simTime < memoryCutoff && importance < 7) {
      continue;
    }
    memoryRows.push({
      worldId,
      agentKey: String(m['agentId']),
      memoryKey,
      kind: String(m['kind']),
      text: String(m['text']),
      simTime: String(m['simTime']),
      importance,
      embedding: Array.isArray(m['embedding'])
        ? [...(m['embedding'] as number[])]
        : null,
      lastAccessSimTime: String(m['lastAccessSimTime'] ?? m['simTime']),
      pointersJson: Array.isArray(m['pointers'])
        ? [...(m['pointers'] as string[])]
        : [],
    });
  }
  const chunkSize = 40;
  for (let i = 0; i < memoryRows.length; i += chunkSize) {
    const chunk = memoryRows.slice(i, i + chunkSize);
    await db
      .insert(agentMemories)
      .values(chunk)
      .onConflictDoUpdate({
        target: [agentMemories.worldId, agentMemories.memoryKey],
        set: {
          kind: sql`excluded.kind`,
          text: sql`excluded.text`,
          simTime: sql`excluded.sim_time`,
          importance: sql`excluded.importance`,
          embedding: sql`COALESCE(excluded.embedding, ${agentMemories.embedding})`,
          lastAccessSimTime: sql`excluded.last_access_sim_time`,
          pointersJson: sql`excluded.pointers_json`,
          agentKey: sql`excluded.agent_key`,
        },
      });
  }

  // Only rewrite plans that were emitted this step (day rollover / first plan).
  const dirtyPlanAgents = new Set(
    newEvents
      .filter((e) => e.kind === 'plan' && e.agentId)
      .map((e) => e.agentId as string),
  );
  const planValues: Array<{
    worldId: string;
    agentKey: string;
    dayIndex: number;
    segmentsJson: object;
  }> = [];
  for (const [agentId, plan] of state.plans) {
    if (dirtyPlanAgents.size > 0 && !dirtyPlanAgents.has(agentId)) continue;
    // When no plan events: skip all plan writes (live ticks with persisted day plans).
    if (dirtyPlanAgents.size === 0) continue;
    planValues.push({
      worldId,
      agentKey: agentId,
      dayIndex: plan.dayIndex,
      segmentsJson: plan.segments as object,
    });
  }
  if (planValues.length) {
    await db
      .insert(agentPlans)
      .values(planValues)
      .onConflictDoUpdate({
        target: [agentPlans.worldId, agentPlans.agentKey, agentPlans.dayIndex],
        set: { segmentsJson: sql`excluded.segments_json` },
      });
  }

  if (newEvents.length) {
    await persistSocietyEvents(db, worldId, newEvents);
  }

  // Only relations touched this step. Rewriting the whole graph every tick meant
  // ~N²/2 upserts every few seconds — all of them no-ops that still bumped
  // `updated_at` and generated WAL.
  const dirtyRelationKeys = options.fullRelations
    ? null
    : relationKeysTouchedBy(newEvents);
  const relationValues: Array<{
    worldId: string;
    fromAgentKey: string;
    toAgentKey: string;
    summary: string;
    affinity: string;
    lastInteractSimTime: string;
    updatedAt: Date;
  }> = [];
  for (const [key, rel] of state.relations) {
    if (dirtyRelationKeys && !dirtyRelationKeys.has(key)) continue;
    const [from, to] = key.split('|');
    if (!from || !to) continue;
    relationValues.push({
      worldId,
      fromAgentKey: from,
      toAgentKey: to,
      summary: rel.summary,
      affinity: String(rel.affinity),
      lastInteractSimTime: String(state.simTime),
      updatedAt: now,
    });
  }
  if (relationValues.length) {
    await db
      .insert(agentRelations)
      .values(relationValues)
      .onConflictDoUpdate({
        target: [
          agentRelations.worldId,
          agentRelations.fromAgentKey,
          agentRelations.toAgentKey,
        ],
        set: {
          summary: sql`excluded.summary`,
          affinity: sql`excluded.affinity`,
          lastInteractSimTime: sql`excluded.last_interact_sim_time`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }

  if (!options.omitPoses) {
    const occupancy = occupancySnapshotOf(state);
    if (occupancy) {
      await persistOccupancyModel(db, worldId, state.simTime, occupancy);
    }
    const objectTip = objectTipOf(state);
    if (objectTip) {
      await persistObjectTip(db, worldId, state.simTime, objectTip);
    }
  }
}

/** Insert replay events without rewriting poses / the rest of the stream. */
export async function persistSocietyEvents(
  db: AnyDb,
  worldId: string,
  events: readonly PersistableSocietyEvent[],
): Promise<void> {
  if (!events.length) return;
  const [alive] = (await db
    .select({ id: worlds.id })
    .from(worlds)
    .where(eq(worlds.id, worldId))
    .limit(1)) as Array<{ id: string }>;
  if (!alive) return;
  const eventValues = events
    .filter((e) => e.id)
    .map((e) => ({
      worldId,
      eventKey: e.id,
      simTime: String(e.simTime),
      kind: e.kind,
      agentKey: e.agentId ?? null,
      payloadJson: e.payload,
      invalidated: 0,
    }));
  if (!eventValues.length) return;
  await db.insert(societyEvents).values(eventValues).onConflictDoNothing();
}

/** Insert one or more memory rows without rewriting the rest of the stream. */
export async function persistSocietyMemories(
  db: AnyDb,
  worldId: string,
  memories: ReadonlyArray<{
    readonly id: string;
    readonly agentId: string;
    readonly kind: string;
    readonly text: string;
    readonly simTime: number;
    readonly importance?: number;
    readonly embedding?: readonly number[] | null;
    readonly lastAccessSimTime?: number;
    readonly pointers?: readonly string[];
  }>,
): Promise<void> {
  if (!memories.length) return;
  const [alive] = (await db
    .select({ id: worlds.id })
    .from(worlds)
    .where(eq(worlds.id, worldId))
    .limit(1)) as Array<{ id: string }>;
  if (!alive) return;
  const rows = memories
    .filter((m) => m.id)
    .map((m) => ({
      worldId,
      agentKey: m.agentId,
      memoryKey: m.id,
      kind: m.kind,
      text: m.text,
      simTime: String(m.simTime),
      importance: m.importance ?? 3,
      embedding: Array.isArray(m.embedding) ? [...m.embedding] : null,
      lastAccessSimTime: String(m.lastAccessSimTime ?? m.simTime),
      pointersJson: Array.isArray(m.pointers) ? [...m.pointers] : [],
    }));
  if (!rows.length) return;
  await db
    .insert(agentMemories)
    .values(rows)
    .onConflictDoUpdate({
      target: [agentMemories.worldId, agentMemories.memoryKey],
      set: {
        kind: sql`excluded.kind`,
        text: sql`excluded.text`,
        simTime: sql`excluded.sim_time`,
        importance: sql`excluded.importance`,
        embedding: sql`COALESCE(excluded.embedding, ${agentMemories.embedding})`,
        lastAccessSimTime: sql`excluded.last_access_sim_time`,
        pointersJson: sql`excluded.pointers_json`,
        agentKey: sql`excluded.agent_key`,
      },
    });
}

export interface SocietyPruneResult {
  readonly events: number;
  readonly memories: number;
}

/**
 * Trim simulation history for one world.
 *
 * With a resident heartbeat a world produces events forever, and low-value rows
 * (move/action beats, trivial observations) dominate the tables while nothing
 * reads them again. Dialogue, interventions and reflections are the record of
 * what happened, so they survive; positional churn does not.
 */
export async function pruneSocietyHistory(
  db: AnyDb,
  worldId: string,
  options?: {
    /** Keep detailed beats within this many sim-hours of the tip. */
    readonly keepDetailHours?: number;
    /** Drop memories older than this many sim-hours unless important. */
    readonly keepMemoryHours?: number;
    /** Importance at or above which a memory is never pruned. */
    readonly keepImportanceAtLeast?: number;
  },
): Promise<SocietyPruneResult> {
  const keepDetailHours = Math.max(1, options?.keepDetailHours ?? 48);
  const keepMemoryHours = Math.max(1, options?.keepMemoryHours ?? 72);
  const keepImportance = options?.keepImportanceAtLeast ?? 7;

  const [tipRow] = (await db
    .select({
      simTime: sql<string>`max(${societyEvents.simTime}::float)`.as('sim_time'),
    })
    .from(societyEvents)
    .where(eq(societyEvents.worldId, worldId))) as Array<{
    simTime: string | number | null;
  }>;
  const tip = tipRow?.simTime != null ? Number(tipRow.simTime) : 0;
  if (!Number.isFinite(tip) || tip <= 0) return { events: 0, memories: 0 };

  const eventCutoff = tip - keepDetailHours;
  const memoryCutoff = tip - keepMemoryHours;

  // Positional beats are replaced every step and never re-read once the replay
  // window has passed; the narrative rows stay. Do not `.returning()` — that
  // loaded every deleted key into the API/worker heap.
  await db
    .delete(societyEvents)
    .where(
      and(
        eq(societyEvents.worldId, worldId),
        sql`${societyEvents.simTime}::float < ${eventCutoff}`,
        sql`${societyEvents.kind} IN ('move', 'action', 'plan', 'observe')`,
        notMetaEventKeySql(),
      ),
    );

  await db
    .delete(agentMemories)
    .where(
      and(
        eq(agentMemories.worldId, worldId),
        sql`${agentMemories.simTime}::float < ${memoryCutoff}`,
        sql`${agentMemories.importance} < ${keepImportance}`,
      ),
    );

  return {
    events: 0,
    memories: 0,
  };
}

/**
 * Relation keys (`a|b`, sorted) that this step's events could have changed.
 * Everyone in a conversation circle forms a pair with everyone else, which is
 * exactly how group conversations grow the graph.
 */
export function relationKeysTouchedBy(
  events: readonly PersistableSocietyEvent[],
): Set<string> {
  const keys = new Set<string>();
  const addPair = (a: string, b: string): void => {
    if (!a || !b || a === b) return;
    keys.add([a, b].sort().join('|'));
  };
  for (const e of events) {
    if (e.kind !== 'dialogue' && e.kind !== 'intervene') continue;
    const ids = new Set<string>();
    if (e.agentId) ids.add(e.agentId);
    const participants = e.payload['participants'];
    if (Array.isArray(participants)) {
      for (const p of participants) if (typeof p === 'string') ids.add(p);
    }
    const withId = e.payload['with'];
    if (typeof withId === 'string') ids.add(withId);
    // Paid 认养 / 巷议: pair each resident with the visitor only.
    // Do not all-to-all the whole town — that would dirty N² NPC pairs.
    const influenceOf = e.payload['influenceOf'];
    const influenceTargets = e.payload['influenceTargets'];
    if (typeof influenceOf === 'string' && Array.isArray(influenceTargets)) {
      for (const t of influenceTargets) {
        if (typeof t === 'string') addPair(t, influenceOf);
      }
    }
    const list = [...ids];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        addPair(list[i]!, list[j]!);
      }
    }
  }
  return keys;
}

export async function invalidateSocietyEventsFrom(
  db: AnyDb,
  worldId: string,
  fromSimTime: number,
): Promise<void> {
  await db
    .update(societyEvents)
    .set({ invalidated: 1 })
    .where(
      and(
        eq(societyEvents.worldId, worldId),
        sql`${societyEvents.simTime}::float >= ${fromSimTime}`,
      ),
    );
}

/** Drop memories at/after intervene cursor so recompute does not duplicate. */
export async function deleteSocietyMemoriesFrom(
  db: AnyDb,
  worldId: string,
  fromSimTime: number,
): Promise<void> {
  await db
    .delete(agentMemories)
    .where(
      and(
        eq(agentMemories.worldId, worldId),
        sql`${agentMemories.simTime}::float >= ${fromSimTime}`,
      ),
    );
}

/**
 * After world_edit, drop day plans so the next tick replans against the new
 * geography. Keep gossip for residents who still exist.
 */
export async function clearSocietyDayPlans(
  db: AnyDb,
  worldId: string,
): Promise<void> {
  await db.delete(agentPlans).where(eq(agentPlans.worldId, worldId));
}

/**
 * Restart living state from the new Spec: gossip, ties, poses, and the event
 * log go away so the clock does not keep acting out the old town.
 */
export async function restartSocietyLivingState(
  db: AnyDb,
  worldId: string,
): Promise<void> {
  await db.delete(agentPlans).where(eq(agentPlans.worldId, worldId));
  await db.delete(agentMemories).where(eq(agentMemories.worldId, worldId));
  await db.delete(agentRelations).where(eq(agentRelations.worldId, worldId));
  await db.delete(worldAgents).where(eq(worldAgents.worldId, worldId));
  await db.delete(societyEvents).where(eq(societyEvents.worldId, worldId));
}

/** Patch keeps gossip; restart wipes life and reseeds from Spec. */
export function societyEditSyncMode(prompt: string): 'patch' | 'restart' {
  return /重开社会|清空传闻|忘掉旧日|从头生活|restart (the )?society|wipe gossip|start life over|forget the old (town|crew|gossip)/i.test(
    prompt,
  )
    ? 'restart'
    : 'patch';
}

/** Remove persisted poses whose Spec NPC was deleted by an edit. */
export async function pruneSocietyAgentsNotIn(
  db: AnyDb,
  worldId: string,
  keepKeys: readonly string[],
): Promise<void> {
  if (!keepKeys.length) return;
  await db
    .delete(worldAgents)
    .where(
      and(
        eq(worldAgents.worldId, worldId),
        notInArray(worldAgents.agentKey, [...keepKeys]),
      ),
    );
}

/** Reconstruct agent poses from last move/action events before fromSimTime. */
export async function loadAgentPosesBefore(
  db: AnyDb,
  worldId: string,
  fromSimTime: number,
): Promise<
  Map<
    string,
    { x: number; y: number; regionId: string; currentAction: string }
  >
> {
  const rows = await db
    .select()
    .from(societyEvents)
    .where(
      and(
        eq(societyEvents.worldId, worldId),
        eq(societyEvents.invalidated, 0),
        sql`${societyEvents.simTime}::float < ${fromSimTime}`,
        sql`${societyEvents.kind} IN ('move', 'action')`,
      ),
    )
    .orderBy(sql`${societyEvents.simTime}::float ASC`)
    .limit(8000);
  const out = new Map<
    string,
    { x: number; y: number; regionId: string; currentAction: string }
  >();
  for (const r of rows as Array<{
    agentKey: string | null;
    kind: string;
    payloadJson: Record<string, unknown> | null;
  }>) {
    if (!r.agentKey) continue;
    const p = r.payloadJson ?? {};
    const prev = out.get(r.agentKey);
    out.set(r.agentKey, {
      x: typeof p['x'] === 'number' ? p['x'] : (prev?.x ?? 0),
      y: typeof p['y'] === 'number' ? p['y'] : (prev?.y ?? 0),
      regionId:
        typeof p['regionId'] === 'string'
          ? p['regionId']
          : (prev?.regionId ?? ''),
      currentAction:
        typeof p['activity'] === 'string'
          ? p['activity']
          : typeof p['action'] === 'string'
            ? p['action']
            : (prev?.currentAction ?? 'idle'),
    });
  }
  return out;
}

/**
 * Recent events for the emergence report card. A live tick only holds the
 * events it just produced, so metrics like "did the town assemble tonight"
 * need a window of history to be meaningful.
 */
export async function loadRecentSocietyEvents(
  db: AnyDb,
  worldId: string,
  options?: { readonly sinceSimTime?: number; readonly limit?: number },
): Promise<
  Array<{
    id: string;
    simTime: number;
    kind: string;
    agentId?: string;
    payload: Record<string, unknown>;
  }>
> {
  const since = options?.sinceSimTime;
  const rows = await db
    .select({
      eventKey: societyEvents.eventKey,
      simTime: societyEvents.simTime,
      kind: societyEvents.kind,
      agentKey: societyEvents.agentKey,
      payloadJson: societyEvents.payloadJson,
      createdAt: societyEvents.createdAt,
    })
    .from(societyEvents)
    .where(
      and(
        eq(societyEvents.worldId, worldId),
        eq(societyEvents.invalidated, 0),
        notMetaEventKeySql(),
        ...(since === undefined
          ? []
          : [sql`${societyEvents.simTime}::float >= ${since}`]),
      ),
    )
    .orderBy(desc(societyEvents.simTime))
    .limit(Math.max(1, Math.min(2_000, options?.limit ?? 800)));
  return (
    rows as Array<{
      eventKey: string;
      simTime: string | number;
      kind: string;
      agentKey: string | null;
      payloadJson: Record<string, unknown> | null;
      createdAt?: Date | string | null;
    }>
  )
    .map((r) => ({
      id: r.eventKey,
      simTime: Number(r.simTime),
      kind: r.kind,
      ...(r.agentKey ? { agentId: r.agentKey } : {}),
      payload: r.payloadJson ?? {},
      createdAtMs:
        r.createdAt instanceof Date
          ? r.createdAt.getTime()
          : r.createdAt
            ? Date.parse(String(r.createdAt))
            : 0,
    }))
    .sort(comparePersistedSocietyEvents);
}

/** Load memories with simTime < fromSimTime for checkpoint restore. */
export async function loadSocietyMemoriesBefore(
  db: AnyDb,
  worldId: string,
  fromSimTime: number,
  options?: { readonly limit?: number },
): Promise<
  Array<{
    id: string;
    agentId: string;
    kind: string;
    text: string;
    simTime: number;
    importance: number;
    embedding: number[] | null;
    lastAccessSimTime: number;
    pointers: string[];
  }>
> {
  const limit = Math.max(
    1,
    Math.min(5000, options?.limit ?? 5000),
  );
  const rows = await db
    .select()
    .from(agentMemories)
    .where(
      and(
        eq(agentMemories.worldId, worldId),
        sql`${agentMemories.simTime}::float < ${fromSimTime}`,
      ),
    )
    .orderBy(desc(agentMemories.importance), desc(agentMemories.simTime))
    .limit(limit);
  return rows.map((r: {
    id: string;
    memoryKey?: string | null;
    agentKey: string;
    kind: string;
    text: string;
    simTime: string | number;
    importance: number;
    embedding: unknown;
    lastAccessSimTime: string | number;
    pointersJson: unknown;
  }) => ({
    id: r.memoryKey || r.id,
    agentId: r.agentKey,
    kind: r.kind,
    text: r.text,
    simTime: Number(r.simTime),
    importance: r.importance,
    embedding: Array.isArray(r.embedding) ? (r.embedding as number[]) : null,
    lastAccessSimTime: Number(r.lastAccessSimTime),
    pointers: Array.isArray(r.pointersJson) ? (r.pointersJson as string[]) : [],
  }));
}

/** Per-agent memory window for live ticks and converse retrieval. */
/**
 * Hydrates each agent's memory working set.
 *
 * A single `importance DESC` window loses the last hour of ordinary life, which
 * is exactly the context a resident needs to say something new — the longer a
 * world ran, the more its residents talked as if nothing had happened. So the
 * window is layered: a recency slice plus an importance slice, deduped.
 */
export async function loadSocietyMemoriesForAgents(
  db: AnyDb,
  worldId: string,
  agentIds: readonly string[],
  options?: {
    readonly perAgent?: number;
    /** Recency slice size; defaults to half of `perAgent`. */
    readonly recentPerAgent?: number;
  },
): Promise<
  Array<{
    id: string;
    agentId: string;
    kind: string;
    text: string;
    simTime: number;
    importance: number;
    embedding: number[] | null;
    lastAccessSimTime: number;
    pointers: string[];
  }>
> {
  const ids = [...new Set(agentIds.filter(Boolean))];
  if (!ids.length) return [];
  const perAgent = Math.max(8, Math.min(200, options?.perAgent ?? 64));
  const recentPerAgent = Math.max(
    0,
    Math.min(200, options?.recentPerAgent ?? Math.ceil(perAgent / 2)),
  );
  const forAgent = (agentId: string) =>
    and(
      eq(agentMemories.worldId, worldId),
      eq(agentMemories.agentKey, agentId),
    );
  const batches = await Promise.all(
    ids.flatMap((agentId) => {
      const byImportance = db
        .select()
        .from(agentMemories)
        .where(forAgent(agentId))
        .orderBy(desc(agentMemories.importance), desc(agentMemories.simTime))
        .limit(perAgent);
      if (recentPerAgent === 0) return [byImportance];
      const byRecency = db
        .select()
        .from(agentMemories)
        .where(forAgent(agentId))
        .orderBy(desc(agentMemories.simTime), desc(agentMemories.importance))
        .limit(recentPerAgent);
      return [byImportance, byRecency];
    }),
  );
  const seen = new Set<string>();
  const out: Array<{
    id: string;
    agentId: string;
    kind: string;
    text: string;
    simTime: number;
    importance: number;
    embedding: number[] | null;
    lastAccessSimTime: number;
    pointers: string[];
  }> = [];
  for (const row of batches.flat() as Array<{
    id: string;
    memoryKey?: string | null;
    agentKey: string;
    kind: string;
    text: string;
    simTime: string | number;
    importance: number;
    embedding: unknown;
    lastAccessSimTime: string | number;
    pointersJson: unknown;
  }>) {
    const id = row.memoryKey || row.id;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      agentId: row.agentKey,
      kind: row.kind,
      text: row.text,
      simTime: Number(row.simTime),
      importance: row.importance,
      embedding: Array.isArray(row.embedding)
        ? (row.embedding as number[])
        : null,
      lastAccessSimTime: Number(row.lastAccessSimTime),
      pointers: Array.isArray(row.pointersJson)
        ? (row.pointersJson as string[])
        : [],
    });
  }
  return out;
}

export async function loadSocietyRelations(
  db: AnyDb,
  worldId: string,
): Promise<
  Array<{ from: string; to: string; summary: string; affinity: number }>
> {
  const rows = await db
    .select()
    .from(agentRelations)
    .where(eq(agentRelations.worldId, worldId));
  return rows.map((r: {
    fromAgentKey: string;
    toAgentKey: string;
    summary: string;
    affinity: string | number;
  }) => ({
    from: r.fromAgentKey,
    to: r.toAgentKey,
    summary: r.summary,
    affinity: Number(r.affinity),
  }));
}

export async function loadSocietyAgents(
  db: AnyDb,
  worldId: string,
): Promise<
  Array<{
    id: string;
    name: string;
    identitySummary: string;
    regionId: string;
    x: number;
    y: number;
    currentAction: string;
    needs?: Record<string, number>;
  }>
> {
  const rows = await db
    .select()
    .from(worldAgents)
    .where(eq(worldAgents.worldId, worldId));
  return rows.map(
    (r: {
      agentKey: string;
      name: string;
      identityJson: unknown;
      regionId: string;
      x: string | number;
      y: string | number;
      currentAction: string;
      needsJson?: unknown;
    }) => {
      const identity =
        r.identityJson && typeof r.identityJson === 'object'
          ? (r.identityJson as { summary?: string })
          : {};
      const needs =
        r.needsJson && typeof r.needsJson === 'object'
          ? (r.needsJson as Record<string, number>)
          : undefined;
      return {
        id: r.agentKey,
        name: r.name,
        identitySummary: identity.summary ?? r.name,
        regionId: r.regionId,
        x: Number.isFinite(Number(r.x)) ? Number(r.x) : 1,
        y: Number.isFinite(Number(r.y)) ? Number(r.y) : 1,
        currentAction: r.currentAction,
        needs: needs && Object.keys(needs).length ? needs : undefined,
      };
    },
  );
}

export async function loadSocietyPlans(
  db: AnyDb,
  worldId: string,
): Promise<
  Array<{ agentKey: string; dayIndex: number; segments: unknown }>
> {
  const rows = await db
    .select()
    .from(agentPlans)
    .where(eq(agentPlans.worldId, worldId));
  return rows.map(
    (r: {
      agentKey: string;
      dayIndex: number;
      segmentsJson: unknown;
    }) => ({
      agentKey: r.agentKey,
      dayIndex: r.dayIndex,
      segments: r.segmentsJson,
    }),
  );
}

/** Lightweight tip for live ticks — never load 8000 events just to read simTime. */
export async function loadSocietyLiveTip(
  db: AnyDb,
  worldId: string,
): Promise<{
  simTime: number;
  recentEvents: Array<{
    id: string;
    simTime: number;
    kind: string;
    agentId: string | null;
    payload: Record<string, unknown>;
    createdAtMs?: number;
  }>;
}> {
  const rows = await db
    .select()
    .from(societyEvents)
    .where(
      and(eq(societyEvents.worldId, worldId), eq(societyEvents.invalidated, 0)),
    )
    .orderBy(desc(societyEvents.simTime))
    .limit(80);

  let simTime = 0;
  const recentEvents: Array<{
    id: string;
    simTime: number;
    kind: string;
    agentId: string | null;
    payload: Record<string, unknown>;
    createdAtMs?: number;
  }> = [];

  for (const r of rows as Array<{
    eventKey: string;
    simTime: string | number;
    kind: string;
    agentKey: string | null;
    payloadJson: unknown;
    createdAt?: Date | string | null;
  }>) {
    const t = Number(r.simTime);
    if (t > simTime) simTime = t;
    if (isSocietyMetaEventKey(r.eventKey)) continue;
    recentEvents.push({
      id: r.eventKey,
      simTime: t,
      kind: r.kind,
      agentId: r.agentKey,
      payload:
        r.payloadJson && typeof r.payloadJson === 'object'
          ? (r.payloadJson as Record<string, unknown>)
          : {},
      createdAtMs:
        r.createdAt instanceof Date
          ? r.createdAt.getTime()
          : r.createdAt
            ? Date.parse(String(r.createdAt))
            : 0,
    });
  }
  recentEvents.sort(comparePersistedSocietyEvents);

  return { simTime, recentEvents };
}

/**
 * Live-tick tip: MAX(simTime) + recent dialogue/intervene only (no fat plan/action rows).
 * Enough for lastConverseAt + whisper cooldown without loading 80 full payloads.
 */
export async function loadSocietyConverseCooldown(
  db: AnyDb,
  worldId: string,
): Promise<{
  simTime: number;
  recentEvents: Array<{
    id: string;
    simTime: number;
    kind: string;
    agentId: string | null;
    payload: Record<string, unknown>;
  }>;
}> {
  const [tipRow] = (await db
    .select({
      simTime: sql<string>`max(${societyEvents.simTime}::float)`.as('sim_time'),
    })
    .from(societyEvents)
    .where(
      and(
        eq(societyEvents.worldId, worldId),
        eq(societyEvents.invalidated, 0),
        notMetaEventKeySql(),
      ),
    )) as Array<{ simTime: string | number | null }>;

  const simTime = tipRow?.simTime != null ? Number(tipRow.simTime) : 0;

  const rows = await db
    .select({
      eventKey: societyEvents.eventKey,
      simTime: societyEvents.simTime,
      kind: societyEvents.kind,
      agentKey: societyEvents.agentKey,
      payloadJson: societyEvents.payloadJson,
    })
    .from(societyEvents)
    .where(
      and(
        eq(societyEvents.worldId, worldId),
        eq(societyEvents.invalidated, 0),
        sql`${societyEvents.kind} IN ('dialogue', 'intervene')`,
      ),
    )
    .orderBy(desc(societyEvents.simTime))
    .limit(24);

  const recentEvents = (
    rows as Array<{
      eventKey: string;
      simTime: string | number;
      kind: string;
      agentKey: string | null;
      payloadJson: unknown;
    }>
  ).map((r) => {
    const raw =
      r.payloadJson && typeof r.payloadJson === 'object'
        ? (r.payloadJson as Record<string, unknown>)
        : {};
    // Keep only fields needed for cooldown / whisper detection.
    const payload: Record<string, unknown> = {};
    if (typeof raw['with'] === 'string') payload['with'] = raw['with'];
    if (typeof raw['text'] === 'string') {
      payload['text'] = String(raw['text']).slice(0, 200);
    }
    if (typeof raw['summary'] === 'string') {
      payload['summary'] = String(raw['summary']).slice(0, 200);
    }
    if (typeof raw['kind'] === 'string') payload['kind'] = raw['kind'];
    if (raw['town'] != null) payload['town'] = raw['town'];
    if (raw['talkSeq'] != null) payload['talkSeq'] = raw['talkSeq'];
    if (raw['circleIndex'] != null) payload['circleIndex'] = raw['circleIndex'];
    return {
      id: r.eventKey,
      simTime: Number(r.simTime),
      kind: r.kind,
      agentId: r.agentKey,
      payload,
    };
  });
  recentEvents.sort(comparePersistedSocietyEvents);

  return { simTime: Number.isFinite(simTime) ? simTime : 0, recentEvents };
}

/**
 * Small high-importance memory window for live converse prompts (no embeddings).
 */
export async function loadSocietyMemoryTip(
  db: AnyDb,
  worldId: string,
  options?: {
    readonly limit?: number;
    /**
     * Vectors were dropped here to keep the live tick light, which silently
     * reset every memory to the hash space on each hydrate. Folded embeddings
     * are small enough to carry.
     */
    readonly withEmbeddings?: boolean;
  },
): Promise<
  Array<{
    id: string;
    agentId: string;
    kind: string;
    text: string;
    simTime: number;
    importance: number;
    embedding: number[] | null;
    lastAccessSimTime: number;
    pointers: string[];
  }>
> {
  const limit = Math.max(1, Math.min(80, options?.limit ?? 40));
  const withEmbeddings = options?.withEmbeddings ?? true;
  const rows = await db
    .select({
      id: agentMemories.id,
      memoryKey: agentMemories.memoryKey,
      agentKey: agentMemories.agentKey,
      kind: agentMemories.kind,
      text: agentMemories.text,
      simTime: agentMemories.simTime,
      importance: agentMemories.importance,
      lastAccessSimTime: agentMemories.lastAccessSimTime,
      pointersJson: agentMemories.pointersJson,
      ...(withEmbeddings ? { embedding: agentMemories.embedding } : {}),
    })
    .from(agentMemories)
    .where(eq(agentMemories.worldId, worldId))
    .orderBy(desc(agentMemories.importance), desc(agentMemories.simTime))
    .limit(limit);

  return (
    rows as Array<{
      id: string;
      memoryKey: string | null;
      agentKey: string;
      kind: string;
      text: string;
      simTime: string | number;
      importance: number;
      lastAccessSimTime: string | number;
      pointersJson: unknown;
      embedding?: unknown;
    }>
  ).map((r) => ({
    id: r.memoryKey || r.id,
    agentId: r.agentKey,
    kind: r.kind,
    text: r.text.length > 400 ? `${r.text.slice(0, 400)}…` : r.text,
    simTime: Number(r.simTime),
    importance: r.importance,
    embedding: Array.isArray(r.embedding) ? (r.embedding as number[]) : null,
    lastAccessSimTime: Number(r.lastAccessSimTime),
    pointers: Array.isArray(r.pointersJson) ? (r.pointersJson as string[]) : [],
  }));
}

/** Load events+agents for presenter society_replay.json / iframe hot reload. */
export async function loadSocietyReplayBundle(
  db: AnyDb,
  worldId: string,
): Promise<{
  simTime: number;
  agents: Array<{
    id: string;
    name: string;
    regionId: string;
    x: number;
    y: number;
    currentAction: string;
  }>;
  events: Array<{
    id: string;
    simTime: number;
    kind: string;
    agentId: string | null;
    payload: Record<string, unknown>;
    createdAtMs?: number;
  }>;
  report: Record<string, unknown> | null;
}> {
  const agents = await loadSocietyAgents(db, worldId);
  const rowsDesc = await db
    .select()
    .from(societyEvents)
    .where(
      and(eq(societyEvents.worldId, worldId), eq(societyEvents.invalidated, 0)),
    )
    .orderBy(sql`${societyEvents.simTime}::float DESC`)
    .limit(400);
  const rows = [...(rowsDesc as unknown[])].reverse();

  let simTime = 0;
  const events: Array<{
    id: string;
    simTime: number;
    kind: string;
    agentId: string | null;
    payload: Record<string, unknown>;
    createdAtMs?: number;
  }> = [];
  let report: Record<string, unknown> | null = null;

  for (const r of rows as Array<{
    eventKey: string;
    simTime: string | number;
    kind: string;
    agentKey: string | null;
    payloadJson: unknown;
    createdAt?: Date | string | null;
  }>) {
    const t = Number(r.simTime);
    if (t > simTime) simTime = t;
    if (r.eventKey === 'emergence_report_latest') {
      report =
        r.payloadJson && typeof r.payloadJson === 'object'
          ? (r.payloadJson as Record<string, unknown>)
          : null;
      continue;
    }
    if (isSocietyMetaEventKey(r.eventKey)) continue;
    events.push({
      id: r.eventKey,
      simTime: t,
      kind: r.kind,
      agentId: r.agentKey,
      payload:
        r.payloadJson && typeof r.payloadJson === 'object'
          ? (r.payloadJson as Record<string, unknown>)
          : {},
      createdAtMs:
        r.createdAt instanceof Date
          ? r.createdAt.getTime()
          : r.createdAt
            ? Date.parse(String(r.createdAt))
            : 0,
    });
  }
  events.sort(comparePersistedSocietyEvents);

  return {
    simTime,
    agents: agents.map((a) => ({
      id: a.id,
      name: a.name,
      regionId: a.regionId,
      x: a.x,
      y: a.y,
      currentAction: a.currentAction,
    })),
    events,
    report,
  };
}

export async function persistEmergenceReport(
  db: AnyDb,
  worldId: string,
  simTime: number,
  report: Record<string, unknown>,
): Promise<void> {
  const previous = await loadEmergenceReport(db, worldId);
  const payload = mergeEmergenceReport(report, previous);
  await db
    .insert(societyEvents)
    .values({
      worldId,
      eventKey: SOCIETY_EMERGENCE_EVENT_KEY,
      simTime: String(simTime),
      kind: 'emergence_report',
      agentKey: null,
      payloadJson: payload,
      invalidated: 0,
    })
    .onConflictDoUpdate({
      target: [societyEvents.worldId, societyEvents.eventKey],
      set: {
        simTime: String(simTime),
        payloadJson: payload,
        invalidated: 0,
      },
    });
}

export async function persistOccupancyModel(
  db: AnyDb,
  worldId: string,
  simTime: number,
  snapshot: OccupancyModelSnapshot,
): Promise<void> {
  await db
    .insert(societyEvents)
    .values({
      worldId,
      eventKey: SOCIETY_OCCUPANCY_EVENT_KEY,
      simTime: String(simTime),
      kind: 'occupancy_ema',
      agentKey: null,
      payloadJson: snapshot,
      invalidated: 0,
    })
    .onConflictDoUpdate({
      target: [societyEvents.worldId, societyEvents.eventKey],
      set: {
        simTime: String(simTime),
        payloadJson: snapshot,
        invalidated: 0,
      },
    });
}

export async function loadOccupancyModel(
  db: AnyDb,
  worldId: string,
): Promise<OccupancyModelSnapshot | null> {
  const rows = await db
    .select()
    .from(societyEvents)
    .where(
      and(
        eq(societyEvents.worldId, worldId),
        eq(societyEvents.eventKey, SOCIETY_OCCUPANCY_EVENT_KEY),
        eq(societyEvents.invalidated, 0),
      ),
    )
    .limit(1);
  const row = rows[0] as { payloadJson?: unknown } | undefined;
  if (!row?.payloadJson || typeof row.payloadJson !== 'object') return null;
  return row.payloadJson as OccupancyModelSnapshot;
}

export async function persistObjectTip(
  db: AnyDb,
  worldId: string,
  simTime: number,
  snapshot: ObjectTipSnapshot,
): Promise<void> {
  await db
    .insert(societyEvents)
    .values({
      worldId,
      eventKey: SOCIETY_OBJECT_TIP_EVENT_KEY,
      simTime: String(simTime),
      kind: 'object_tip',
      agentKey: null,
      payloadJson: snapshot,
      invalidated: 0,
    })
    .onConflictDoUpdate({
      target: [societyEvents.worldId, societyEvents.eventKey],
      set: {
        simTime: String(simTime),
        payloadJson: snapshot,
        invalidated: 0,
      },
    });
}

export async function loadObjectTip(
  db: AnyDb,
  worldId: string,
): Promise<{ simTime: number; objects: Array<{ id: string; state: string }> } | null> {
  const rows = await db
    .select()
    .from(societyEvents)
    .where(
      and(
        eq(societyEvents.worldId, worldId),
        eq(societyEvents.eventKey, SOCIETY_OBJECT_TIP_EVENT_KEY),
        eq(societyEvents.invalidated, 0),
      ),
    )
    .limit(1);
  const row = rows[0] as
    | { simTime?: string | number; payloadJson?: unknown }
    | undefined;
  const payload = row?.payloadJson;
  if (!payload || typeof payload !== 'object') return null;
  const raw = (payload as { objects?: unknown }).objects;
  if (!Array.isArray(raw)) return null;
  const objects = raw
    .map((o) => {
      if (!o || typeof o !== 'object') return null;
      const rec = o as { id?: unknown; state?: unknown };
      if (typeof rec.id !== 'string' || typeof rec.state !== 'string') return null;
      return { id: rec.id, state: rec.state };
    })
    .filter((o): o is { id: string; state: string } => Boolean(o));
  if (!objects.length) return null;
  return {
    simTime: Number(row?.simTime ?? 0),
    objects,
  };
}

/** Latest observe/use-object rows only — mixed last-N windows drop oven-off. */
export async function loadLatestObjectStateEvents(
  db: AnyDb,
  worldId: string,
  options?: { readonly limit?: number },
): Promise<
  Array<{
    id: string;
    simTime: number;
    kind: string;
    agentId?: string;
    payload: Record<string, unknown>;
  }>
> {
  const rows = await db
    .select({
      eventKey: societyEvents.eventKey,
      simTime: societyEvents.simTime,
      kind: societyEvents.kind,
      agentKey: societyEvents.agentKey,
      payloadJson: societyEvents.payloadJson,
    })
    .from(societyEvents)
    .where(
      and(
        eq(societyEvents.worldId, worldId),
        eq(societyEvents.invalidated, 0),
        sql`${societyEvents.kind} IN ('observe', 'use-object')`,
      ),
    )
    .orderBy(desc(societyEvents.simTime))
    .limit(Math.max(1, Math.min(400, options?.limit ?? 200)));
  return (
    rows as Array<{
      eventKey: string;
      simTime: string | number;
      kind: string;
      agentKey: string | null;
      payloadJson: Record<string, unknown> | null;
    }>
  )
    .map((r) => ({
      id: r.eventKey,
      simTime: Number(r.simTime),
      kind: r.kind,
      ...(r.agentKey ? { agentId: r.agentKey } : {}),
      payload: r.payloadJson ?? {},
    }))
    .reverse();
}

export async function loadEmergenceReport(
  db: AnyDb,
  worldId: string,
): Promise<Record<string, unknown> | null> {
  const rows = await db
    .select()
    .from(societyEvents)
    .where(
      and(
        eq(societyEvents.worldId, worldId),
        eq(societyEvents.eventKey, SOCIETY_EMERGENCE_EVENT_KEY),
        eq(societyEvents.invalidated, 0),
      ),
    )
    .limit(1);
  const row = rows[0] as { payloadJson?: unknown } | undefined;
  if (!row?.payloadJson || typeof row.payloadJson !== 'object') return null;
  return row.payloadJson as Record<string, unknown>;
}

async function upsertMindRow(
  db: AnyDb,
  worldId: string,
  simTime: number,
  eventKey: string,
  kind: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await db
    .insert(societyEvents)
    .values({
      worldId,
      eventKey,
      simTime: String(simTime),
      kind,
      agentKey: null,
      payloadJson: payload,
      invalidated: 0,
    })
    .onConflictDoUpdate({
      target: [societyEvents.worldId, societyEvents.eventKey],
      set: {
        simTime: String(simTime),
        payloadJson: payload,
        invalidated: 0,
      },
    });
}

export async function persistSocietyMind(
  db: AnyDb,
  worldId: string,
  simTime: number,
  snapshot: Record<string, unknown>,
): Promise<void> {
  const policies = Array.isArray(snapshot['policies']) ? snapshot['policies'] : [];
  const opinions = Array.isArray(snapshot['opinions']) ? snapshot['opinions'] : [];
  const crowd = Array.isArray(snapshot['crowd']) ? snapshot['crowd'] : [];
  await upsertMindRow(db, worldId, simTime, SOCIETY_MIND_EVENT_KEY, 'mind_tip', snapshot);
  await upsertMindRow(db, worldId, simTime, SOCIETY_POLICY_EVENT_KEY, 'policy', {
    policies,
  });
  await upsertMindRow(db, worldId, simTime, SOCIETY_OPINION_EVENT_KEY, 'opinion_tip', {
    opinions,
    history: snapshot['history'] ?? [],
    beliefCards: snapshot['beliefCards'] ?? {},
    fingerprints: snapshot['fingerprints'] ?? {},
    recentTopics: snapshot['recentTopics'] ?? [],
    topicSummaries: snapshot['topicSummaries'] ?? {},
    commitments: snapshot['commitments'] ?? [],
  });
  await upsertMindRow(db, worldId, simTime, SOCIETY_CROWD_EVENT_KEY, 'crowd_tip', {
    crowd,
    collective: snapshot['collective'] ?? null,
  });
}

export async function loadSocietyMind(
  db: AnyDb,
  worldId: string,
): Promise<Record<string, unknown> | null> {
  const rows = await db
    .select()
    .from(societyEvents)
    .where(
      and(
        eq(societyEvents.worldId, worldId),
        eq(societyEvents.eventKey, SOCIETY_MIND_EVENT_KEY),
        eq(societyEvents.invalidated, 0),
      ),
    )
    .limit(1);
  const row = rows[0] as { payloadJson?: unknown } | undefined;
  if (!row?.payloadJson || typeof row.payloadJson !== 'object') return null;
  return row.payloadJson as Record<string, unknown>;
}

type MindPolicyRow = {
  id?: string;
  title?: string;
  body?: string;
  channel?: string;
  tags?: unknown;
  at?: number;
  pending?: boolean;
  effects?: unknown;
};

type MindOpinionRow = {
  agentId?: string;
  topicId?: string;
  stance?: number;
  confidence?: number;
  reason?: string;
  emotion?: string;
  action?: string;
  updatedAt?: number;
};

type MindCohortRow = {
  id?: string;
  label?: string;
  regionId?: string;
  occupation?: string;
  size?: number;
  hist?: unknown;
};

/** Durable copy. A missing migration must not fail the live tick. */
export async function upsertSocietyMindTables(
  db: AnyDb,
  worldId: string,
  simTime: number,
  snapshot: Record<string, unknown>,
): Promise<void> {
  const policies = Array.isArray(snapshot['policies'])
    ? (snapshot['policies'] as MindPolicyRow[])
    : [];
  const opinions = Array.isArray(snapshot['opinions'])
    ? (snapshot['opinions'] as MindOpinionRow[])
    : [];
  const crowd = Array.isArray(snapshot['crowd'])
    ? (snapshot['crowd'] as MindCohortRow[])
    : [];
  const now = new Date();
  for (const policy of policies) {
    if (!policy?.id || !policy.title) continue;
    await db
      .insert(worldPolicies)
      .values({
        worldId,
        policyKey: policy.id,
        title: policy.title,
        body: policy.body ?? '',
        channel: policy.channel ?? 'notice',
        tagsJson: policy.tags ?? [],
        effectsJson: policy.effects ?? {},
        pending: policy.pending !== false,
        simTime: String(policy.at ?? simTime),
      })
      .onConflictDoUpdate({
        target: [worldPolicies.worldId, worldPolicies.policyKey],
        set: {
          title: policy.title,
          body: policy.body ?? '',
          channel: policy.channel ?? 'notice',
          tagsJson: policy.tags ?? [],
          effectsJson: policy.effects ?? {},
          pending: policy.pending !== false,
          simTime: String(policy.at ?? simTime),
        },
      });
  }
  const opinionRows = opinions.filter((row) => row.agentId && row.topicId);
  if (opinionRows.length) {
    await db
      .insert(agentOpinions)
      .values(
        opinionRows.map((row) => ({
          worldId,
          agentKey: row.agentId!,
          topicKey: row.topicId!,
          stance: String(row.stance ?? 0),
          confidence: String(row.confidence ?? 0),
          reason: (row.reason ?? '').slice(0, 240),
          emotion: row.emotion ?? null,
          action: row.action ?? null,
          simTime: String(row.updatedAt ?? simTime),
          updatedAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: [agentOpinions.worldId, agentOpinions.agentKey, agentOpinions.topicKey],
        set: {
          stance: sql`excluded.stance`,
          confidence: sql`excluded.confidence`,
          reason: sql`excluded.reason`,
          emotion: sql`excluded.emotion`,
          action: sql`excluded.action`,
          simTime: sql`excluded.sim_time`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }
  await db.delete(crowdCohorts).where(eq(crowdCohorts.worldId, worldId));
  const cohortRows = crowd.filter((row) => row.id && row.regionId);
  if (cohortRows.length) {
    await db.insert(crowdCohorts).values(
      cohortRows.map((row) => ({
        worldId,
        cohortKey: row.id!,
        label: row.label ?? row.id!,
        regionId: row.regionId!,
        occupation: row.occupation ?? '',
        size: Math.max(0, Math.round(row.size ?? 0)),
        histJson: Array.isArray(row.hist) ? row.hist : [],
        updatedAt: now,
      })),
    );
  }
}

export async function loadSocietyMindTables(
  db: AnyDb,
  worldId: string,
): Promise<Record<string, unknown> | null> {
  const [policies, opinions, crowd] = await Promise.all([
    db.select().from(worldPolicies).where(eq(worldPolicies.worldId, worldId)),
    db.select().from(agentOpinions).where(eq(agentOpinions.worldId, worldId)),
    db.select().from(crowdCohorts).where(eq(crowdCohorts.worldId, worldId)),
  ]);
  if (!policies.length && !opinions.length && !crowd.length) return null;
  return {
    policies: (policies as Array<Record<string, unknown>>).map((row) => ({
      id: row['policyKey'],
      title: row['title'],
      body: row['body'],
      channel: row['channel'],
      tags: row['tagsJson'] ?? [],
      at: Number(row['simTime'] ?? 0),
      pending: row['pending'] !== false,
      appraisedIds: [],
      effectsApplied: true,
      effects: row['effectsJson'] ?? {},
    })),
    opinions: (opinions as Array<Record<string, unknown>>).map((row) => ({
      agentId: row['agentKey'],
      topicId: row['topicKey'],
      stance: Number(row['stance'] ?? 0),
      confidence: Number(row['confidence'] ?? 0),
      reason: row['reason'] ?? '',
      emotion: row['emotion'] ?? undefined,
      action: row['action'] ?? undefined,
      updatedAt: Number(row['simTime'] ?? 0),
    })),
    crowd: (crowd as Array<Record<string, unknown>>).map((row) => ({
      id: row['cohortKey'],
      label: row['label'],
      regionId: row['regionId'],
      occupation: row['occupation'],
      size: Number(row['size'] ?? 0),
      hist: row['histJson'],
    })),
  };
}

/** Meta tip plus durable rows. Tables win for policies, opinions, and crowd. */
export async function loadDurableSocietyMind(
  db: AnyDb,
  worldId: string,
): Promise<Record<string, unknown> | null> {
  const meta = await loadSocietyMind(db, worldId);
  let tables: Record<string, unknown> | null = null;
  try {
    tables = await loadSocietyMindTables(db, worldId);
  } catch {
    tables = null;
  }
  if (!meta && !tables) return null;
  return { ...(meta ?? {}), ...(tables ?? {}) };
}

export async function loadLatestSocietyForecast(
  db: AnyDb,
  worldId: string,
): Promise<{ label: string; hours: number; bands: unknown } | null> {
  const rows = await db
    .select()
    .from(societyForecasts)
    .where(eq(societyForecasts.worldId, worldId))
    .orderBy(desc(societyForecasts.createdAt))
    .limit(1);
  const row = rows[0] as
    | { label?: string; hours?: number; bandsJson?: unknown }
    | undefined;
  if (!row) return null;
  return {
    label: row.label ?? 'baseline',
    hours: Number(row.hours ?? 0),
    bands: row.bandsJson ?? [],
  };
}

export async function saveSocietyForecast(
  db: AnyDb,
  worldId: string,
  label: string,
  hours: number,
  bands: unknown,
): Promise<void> {
  await db.insert(societyForecasts).values({
    worldId,
    label: label.slice(0, 80),
    hours,
    bandsJson: bands ?? [],
  });
}
