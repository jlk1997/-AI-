/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Deterministic society step orchestrator.
 */

import type { CourseSteeringHint } from '@opengame/platform-shared';

import { converseGroup } from './converse.js';
import {
  assignTalkTopics,
  MAX_REGION_LLM_TALKS,
  rumorAwareness,
  talkTopicKey,
  type TalkTopicCircle,
} from './talkTopics.js';
import { topicIsStale } from './societyMind.js';
import { beliefNoteFor } from './opinion.js';
import { createMemoryEntry, MemoryStream } from './memory.js';
import {
  generateDayPlan,
  segmentAt,
  replanFromNow,
  decomposeSegmentActions,
  type DayPlan,
  type PlanPlace,
  type PlanRelation,
} from './plan.js';

import { maybeReflect } from './reflect.js';
import {
  decideReaction,
  maybeLlmReaction,
  objectInAgentRegion,
  objectRegionId,
  perceive,
  pickTalkPartner,
  isSocialHour,
  wantsToChat,
  type AgentPose,
  type WorldObjectState,
} from './react.js';
import type { LlmTextFn } from './reflect.js';
import { findPath } from './pathfind.js';
import {
  isBlocked,
  nearestWalkable,
  type RegionGrid,
} from './grid.js';
import { scoreImportanceBatch, heuristicImportance } from './importance.js';
import {
  FRESH_TRACE_H,
  freshTraceText,
  isRumorOrWhisperText,
  isSocietyRegionId,
} from './hydrate.js';
import {
  activityAnchorKind,
  hashStr,
  nearestAreaAnchor,
  resolveActivityGoal,
  type AnchorMap,
  type CrowdPose,
} from './anchors.js';
import {
  advanceNeeds,
  createNeeds,
  urgentNeed,
  type Needs,
  type UrgentNeed,
} from './needs.js';
import {
  upgradeMemoryEmbeddings,
  type EmbedTextsFn,
} from './embedProvider.js';
import { evolveRelation, type SocietyRelation } from './relations.js';
import { shouldTell, type StanceCard } from './beliefs.js';
import {
  objectKindFromName,
  objectMatchesNeed,
  objectIsUsable,
  useWorldObject,
  wearWorldObject,
} from './objects.js';
import {
  applyTownSurprise,
  SocietyTransitionModel,
} from './societyWorldModel.js';
import {
  brokenObjectReason,
  checkingNewsAction,
  investigateAction,
  lookedAtMemory,
  objectUsedMemory,
  rumorClaim,
  seekTalkAction,
  societyCopyAscii,
  talkingAction,
  isTalkingAction,
  witnessObservation,
  placeFromWitnessText,
  portalCrossingAction,
  portalHeadingAction,
  headingToPlaceAction,
} from './copyLocale.js';
import { stampNextTalk } from './talkOrder.js';

export type SocietyEventKind =
  | 'move'
  | 'action'
  | 'dialogue'
  | 'reflection'
  | 'plan'
  | 'intervene'
  | 'observe'
  | 'use-object'
  | 'story_arc'
  | 'policy';

export interface SocietyEvent {
  readonly id: string;
  readonly simTime: number;
  readonly kind: SocietyEventKind;
  readonly agentId?: string;
  readonly payload: Record<string, unknown>;
}

export interface SocietyAgent {
  readonly id: string;
  readonly name: string;
  readonly identitySummary: string;
  regionId: string;
  x: number;
  y: number;
  currentAction: string;
  lastReflectSimTime: number;
  /** Drives that can interrupt the schedule. */
  needs: Needs;
  /** Rate-limits drive-triggered replanning so plans do not thrash each step. */
  lastDriveReplanSimTime?: number;
  /** From `identity.occupation` — drives per-resident schedule shape. */
  readonly occupation?: string;
  /** Spec-authored fixed appointments (`entity.schedule`). */
  readonly schedule?: ReadonlyArray<{
    readonly hour: number;
    readonly regionId?: string;
    readonly activity: string;
  }>;
  /** Current area in the region→area→object tree (recomputed from pose). */
  areaId?: string;
  areaName?: string;
  /** Where this step's walk is heading (map marker + inspector). */
  goalX?: number;
  goalY?: number;
  goalPlace?: string;
  /** Why this destination — plan / drive / crowd (inspector Why bar). */
  goalReason?: string;
  drive?: string;
  /** Spec home / workplace so plans do not all share `home_row`. */
  homeAreaId?: string;
  workAreaId?: string;
  secret?: string;
  stance?: string;
  goalsNote?: string;
  emotionNote?: string;
  voiceNote?: string;
  withholdFrom?: readonly string[];
  padded?: boolean;
  /** Cached A* remainder; cleared when the goal changes or the agent is adjacent. */
  walkPath?: {
    gx: number;
    gy: number;
    cells: Array<{ x: number; y: number }>;
  };
}

/** Spec portal — walk to `fromPos` before changing `regionId`. */
export interface SocietyPortal {
  readonly id: string;
  readonly fromRegionId: string;
  readonly toRegionId: string;
  readonly fromPos: { readonly x: number; readonly y: number };
  readonly toPos: { readonly x: number; readonly y: number };
  readonly label?: string;
}

export interface PendingSocietyTalk {
  readonly initiatorId: string;
  readonly targetId: string;
  readonly people: SocietyAgent[];
  readonly pairs: string[];
  readonly topicHint: string;
  readonly forceRumor?: boolean;
  readonly talkLlm: LlmTextFn | undefined;
}

/** Residents frozen in place while MiniMax writes their exchange. */
export interface HeldTalk {
  readonly participantIds: readonly string[];
  readonly names: Readonly<Record<string, string>>;
  /** Sim-time the hold started — walkers peel off if the model never returns. */
  readonly sinceSimTime?: number;
}

export interface SocietyState {
  simTime: number;
  seed: number;
  agents: SocietyAgent[];
  objects: WorldObjectState[];
  plans: Map<string, DayPlan>;
  stream: MemoryStream;
  events: SocietyEvent[];
  /** Relations: `${a}|${b}` → summary */
  relations: Map<string, SocietyRelation>;
  /** Optional region grid sizes for pathfinding */
  regionBounds?: Map<string, { width: number; height: number }>;
  /** Walkability from `layoutAscii`; `stepToward` will not path through walls. */
  regionGrids?: Map<string, RegionGrid>;
  /** Named anchors (area/object id → grid pose) for real destinations */
  anchors?: AnchorMap;
  /**
   * Region the whole town treats as its gathering place. Planners route the
   * evening social block here so residents actually run into each other.
   */
  hubRegionId?: string;
  /** Genre pack — town diurnal vs crew watch. */
  packId?: string;
  clockKind?: 'diurnal' | 'watch' | 'event';
  /** True when Spec region names are ASCII — NPCs speak English. */
  copyAscii?: boolean;
  /** Bidirectional region links; missing portals fall back to an instant snap. */
  portals?: SocietyPortal[];
  /**
   * `observer>subject` → the last activity we already wrote down about them.
   * Without this an agent re-records the same sight every step.
   */
  witnessed?: Map<string, string>;
  /** Pair key `a|b` → last conversation simTime (cooldown so they walk between chats). */
  lastConverseAt: Map<string, number>;
  /** Sim-time of the newest whisper/rumor that already cleared talk cooldown. */
  lastWhisperClearedAt: number;
  /** Occupancy predictor — surprise drives curiosity. */
  worldModel?: SocietyTransitionModel;
  /** Filled when `skipConversations` is set; consumed by finishSocietyTalks. */
  pendingTalks?: PendingSocietyTalk[];
  /** Heartbeat stamps this so walkers stay put while a talk HTTP is in flight. */
  heldTalks?: HeldTalk[];
  /** Pair key `a|b` → consecutive failed talk attempts (retry budget). */
  talkRetries?: Map<string, number>;
  /** Overrides {@link MAX_STATE_EVENTS} for this world. */
  maxEvents?: number;
  /** Monotone talk order. Same-hour circles sort by this, not the clock. */
  talkSeq?: number;
}

/**
 * Hard cap on the in-memory event log.
 *
 * Durable history lives in Postgres; `state.events` only needs a tail long
 * enough for metrics, object reconstruction and the next publish. Without a cap
 * a world that runs for hours grows this array until the worker heap does.
 */
export const MAX_STATE_EVENTS = 2_000;

/** Trim in blocks so the O(n) shift is amortised across many appends. */
const EVENT_TRIM_SLACK = 256;

export function appendSocietyEvent(
  state: SocietyState,
  event: SocietyEvent,
): void {
  state.events.push(event);
  const cap = Math.max(64, state.maxEvents ?? MAX_STATE_EVENTS);
  if (state.events.length > cap + EVENT_TRIM_SLACK) {
    state.events.splice(0, state.events.length - cap);
  }
}

export interface StepSocietyOptions {
  readonly dtHours?: number;
  readonly llm?: LlmTextFn;
  /**
   * Model used for spoken dialogue. Plans and reflection stay on {@link llm}.
   * Omit it and dialogue uses the same client as planning.
   */
  readonly talkLlm?: LlmTextFn;
  readonly idFactory?: () => string;
  /**
   * @deprecated Prefer `maxPlanLlmCallsPerStep: 0`. Kept so existing callers
   * keep their "spend the model on converse only" behaviour.
   */
  readonly converseOnlyLlm?: boolean;
  /**
   * Total conversations per step, model-backed **or** template-degraded.
   * A cap of 0 makes the town mute, so live callers should never pass 0 —
   * cap the model spend with {@link maxLlmConversationsPerStep} instead.
   */
  readonly maxConversationsPerStep?: number;
  /**
   * Of the allowed conversations, how many may call the model. Jobs that never
   * got a model slot still happen as template beats. Overflow of jobs that
   * already had a slot is skipped when {@link converseOnlyLlm} is set — seed
   * must not paint those extras as "degraded talk".
   */
  readonly maxLlmConversationsPerStep?: number;
  /**
   * Amortized cognition budget: how many plan/replan/reflect calls may hit the
   * model this step. Plans are per-agent-per-sim-day, so a small per-step
   * budget still gives every resident a model-authored schedule.
   */
  readonly maxPlanLlmCallsPerStep?: number;
  /** Importance scoring is the lowest-value model spend; default heuristic. */
  readonly llmImportance?: boolean;
  /**
   * Sampled "should I interrupt my day?" model call. Default 0; live heartbeat
   * sets 1 so twelve heads never hit the model on the same beat.
   */
  readonly maxReactLlmCallsPerStep?: number;
  /** Residents per conversation circle; 2 restores the old pair-only behaviour. */
  readonly maxGroupSize?: number;
  /** Real embedding provider; omit to keep the deterministic hash fallback. */
  readonly embed?: EmbedTextsFn;
  /** Memories re-embedded per step (bounded so a tick stays predictable). */
  readonly maxEmbedTextsPerStep?: number;
  /**
   * Called after every resident has walked this beat, before any conversation
   * LLM. Heartbeat uses this to persist/publish poses so the town never freezes
   * while MiniMax is thinking.
   */
  readonly flushLocomotion?: (
    state: SocietyState,
    events: readonly SocietyEvent[],
  ) => void | Promise<void>;
  /**
   * Queue conversations on `state.pendingTalks` instead of awaiting the model.
   * Heartbeat walks/persists, releases the world lock, then finishes talks.
   */
  readonly skipConversations?: boolean;
  /**
   * Skip embedding upgrade this step. Live callers with `skipConversations`
   * default this on so the walk lock never waits on MiniMax embeddings;
   * {@link finishSocietyTalks} flushes after unlock.
   */
  readonly skipMemoryFlush?: boolean;
  /** Cap when `skipConversations` accumulates jobs across fast-forward steps. */
  readonly maxPendingTalks?: number;
  /**
   * Per-use chance that a stove / workbench wears out, which is the town's own
   * source of unplanned events. Defaults to {@link OBJECT_WEAR_CHANCE}; 0 turns
   * incidents off for deterministic evals.
   */
  readonly objectWearChance?: number;
  /** Seed persist: write each circle as it lands so createdAt can break ties. */
  readonly onTalkEvent?: (event: SocietyEvent) => void | Promise<void>;
  /** Soft course steering during the evidence window only. */
  readonly courseSteering?: CourseSteeringHint;
  /** Topic keys already in circulation. Circles prefer a beat that is new. */
  readonly recentTopicKeys?: readonly string[];
  /** When set, a circle whose topic was just said walks instead of talking. */
  readonly recentTopics?: readonly string[];
  /** Said once by the first circle that is not carrying the seed rumor. */
  readonly spotlightTopic?: string;
  /** Ask the model for stance shifts and commitments on this beat. */
  readonly askOutcomes?: boolean;
  readonly onTalkOutcomes?: (
    outcomes: import('./societyMind.js').TalkOutcomes,
    people: ReadonlyArray<{ readonly id: string; readonly name: string; readonly regionId?: string }>,
    topic: string,
  ) => void;
  /** Short belief cards keyed by agent id. Folded into the talk prompt. */
  readonly beliefCards?: Readonly<Record<string, string>>;
  /**
   * When set, only these residents may call the model. Others still walk
   * and can speak from the template. Omit it and every circle may use the model.
   */
  readonly llmEligibleIds?: ReadonlySet<string>;
}

/** Batch converse jobs whose participant sets do not overlap. */
export function partitionDisjointTalkJobs<
  T extends { readonly people: ReadonlyArray<{ readonly id: string }> },
>(jobs: readonly T[]): T[][] {
  const batches: T[][] = [];
  const remaining = [...jobs];
  while (remaining.length) {
    const batch: T[] = [];
    const used = new Set<string>();
    const leftover: T[] = [];
    for (const job of remaining) {
      const ids = job.people.map((p) => p.id);
      if (ids.some((id) => used.has(id))) {
        leftover.push(job);
        continue;
      }
      for (const id of ids) used.add(id);
      batch.push(job);
    }
    if (!batch.length) {
      const first = remaining.shift();
      if (first) batches.push([first]);
      continue;
    }
    batches.push(batch);
    remaining.splice(0, remaining.length, ...leftover);
  }
  return batches;
}

function mergePendingTalks(
  prev: readonly PendingSocietyTalk[],
  next: readonly PendingSocietyTalk[],
  cap: number,
): PendingSocietyTalk[] {
  const merged: PendingSocietyTalk[] = [...prev];
  const used = new Set(merged.flatMap((j) => j.people.map((p) => p.id)));
  for (const job of next) {
    if (merged.length >= cap) break;
    const ids = job.people.map((p) => p.id);
    if (ids.some((id) => used.has(id))) continue;
    for (const id of ids) used.add(id);
    merged.push(job);
  }
  return merged.slice(0, cap);
}

let _idSeq = 0;
function defaultId(): string {
  _idSeq += 1;
  return `evt_${_idSeq}_${Date.now().toString(36)}`;
}

export function createSocietyState(input: {
  readonly seed?: number;
  readonly simTime?: number;
  readonly agents: Array<
    Omit<SocietyAgent, 'currentAction' | 'lastReflectSimTime' | 'needs'> & {
      readonly needs?: Needs;
    }
  >;
  readonly objects?: WorldObjectState[];
  readonly regionBounds?: Map<string, { width: number; height: number }>;
  readonly regionGrids?: Map<string, RegionGrid>;
  readonly anchors?: AnchorMap;
  readonly hubRegionId?: string;
  readonly packId?: string;
  readonly clockKind?: 'diurnal' | 'watch' | 'event';
  readonly copyAscii?: boolean;
  readonly portals?: readonly SocietyPortal[];
}): SocietyState {
  return {
    simTime: input.simTime ?? 8,
    seed: input.seed ?? 1,
    agents: input.agents.map((a) => ({
      ...a,
      currentAction: 'idle',
      lastReflectSimTime: input.simTime ?? 8,
      needs: a.needs ?? createNeeds(a.id),
    })),
    objects: [...(input.objects ?? [])],
    plans: new Map(),
    stream: new MemoryStream(),
    events: [],
    relations: new Map(),
    regionBounds: input.regionBounds,
    regionGrids: input.regionGrids,
    anchors: input.anchors,
    hubRegionId: input.hubRegionId,
    packId: input.packId,
    clockKind: input.clockKind,
    copyAscii: input.copyAscii,
    portals: input.portals ? [...input.portals] : undefined,
    lastConverseAt: new Map(),
    lastWhisperClearedAt: -Infinity,
    talkSeq: 0,
  };
}

/**
 * Strip the planner's step bookkeeping ("干活 · 第3步") and the agent's own name
 * so the result reads like something you could say about a person.
 */
function plainActivity(action: string): string {
  const text = action
    .replace(/\s*·\s*第\d+\s*步\s*$/u, '')
    .replace(/\s*·\s*step\s*\d+\s*$/iu, '')
    .replace(/^查看[：:]\s*/u, '看着')
    .replace(/^checking:\s*/i, '')
    .replace(/^[^，]{0,6}了，/u, '')
    .trim();
  if (!text || text === 'idle' || text.startsWith('【')) return '';
  return text.slice(0, 40);
}

/** Tiles within which bystanders are considered part of the same circle. */
const GROUP_RADIUS = 6;
/** Drop a MiniMax hold if the model never comes back (sim hours). */
const HOLD_MAX_H = 2.5;
/** After a chat, leave the cluster instead of camping the hub. */
const LEAVE_HUB_AFTER_TALK_H = 0.8;
/** Upper bound on one conversation circle (prompt quality falls off past this). */
const MAX_GROUP_SIZE = 4;

export function pairKey(a: string, b: string): string {
  return [a, b].sort().join('|');
}

function agentHasOpenPromise(state: SocietyState, agentId: string): boolean {
  for (const [key, rel] of state.relations) {
    if (rel.kind !== 'promise') continue;
    const [a, b] = key.split('|');
    if (a === agentId || b === agentId) return true;
  }
  return false;
}

function allPairs(ids: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      out.push(pairKey(ids[i]!, ids[j]!));
    }
  }
  return out;
}

/**
 * Retries per circle before the pair falls back to the normal cooldown. Two
 * extra shots ride out a single MiniMax timeout without turning a dead key pool
 * into a per-step retry storm.
 */
export const MAX_TALK_RETRIES = 3;

/** Visible-failure markers emitted per step, so the log stays readable. */
export const MAX_TALK_DEGRADE_MARKERS_PER_STEP = 2;

function bumpTalkRetry(state: SocietyState, pairs: readonly string[]): number {
  state.talkRetries ??= new Map();
  let worst = 0;
  for (const key of pairs) {
    const next = (state.talkRetries.get(key) ?? 0) + 1;
    state.talkRetries.set(key, next);
    if (next > worst) worst = next;
  }
  return worst || 1;
}

function clearTalkRetry(state: SocietyState, pairs: readonly string[]): void {
  if (!state.talkRetries?.size) return;
  for (const key of pairs) state.talkRetries.delete(key);
}

function dropHeldTalk(state: SocietyState, ids: readonly string[]): void {
  if (!state.heldTalks?.length) return;
  const set = new Set(ids);
  state.heldTalks = state.heldTalks.filter(
    (h) => !h.participantIds.some((id) => set.has(id)),
  );
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function clampCoord(n: number, maxExclusive: number): number {
  const cap = Math.max(1, maxExclusive);
  if (!Number.isFinite(n)) return Math.min(1, cap - 1);
  return Math.max(0, Math.min(cap - 1, n));
}

function clampAgentPose(
  agent: SocietyAgent,
  bounds: { width: number; height: number },
): void {
  agent.x = clampCoord(agent.x, bounds.width);
  agent.y = clampCoord(agent.y, bounds.height);
}

function regionBoundsOf(
  state: SocietyState,
  regionId: string,
): { width: number; height: number } {
  return state.regionBounds?.get(regionId) ?? { width: 32, height: 24 };
}

/** Map a plan locationId to a real region, never a place id like `forge`. */
function regionForLocation(
  state: SocietyState,
  locationId: string,
  fallback: string,
): string {
  const anchor = state.anchors?.get(locationId);
  if (anchor?.regionId && isSocietyRegionId(state, anchor.regionId)) {
    return anchor.regionId;
  }
  if (isSocietyRegionId(state, locationId)) return locationId;
  return fallback;
}

/** First hop on the portal graph; undefined if there is no path. */
export function firstPortalHop(
  portals: readonly SocietyPortal[],
  fromRegionId: string,
  toRegionId: string,
): SocietyPortal | undefined {
  if (fromRegionId === toRegionId) return undefined;
  const byFrom = new Map<string, SocietyPortal[]>();
  for (const p of portals) {
    const list = byFrom.get(p.fromRegionId) ?? [];
    list.push(p);
    byFrom.set(p.fromRegionId, list);
  }
  const seen = new Set<string>([fromRegionId]);
  const q: Array<{ region: string; first: SocietyPortal }> = [];
  for (const p of byFrom.get(fromRegionId) ?? []) {
    if (p.toRegionId === toRegionId) return p;
    if (seen.has(p.toRegionId)) continue;
    seen.add(p.toRegionId);
    q.push({ region: p.toRegionId, first: p });
  }
  while (q.length) {
    const cur = q.shift()!;
    if (cur.region === toRegionId) return cur.first;
    for (const p of byFrom.get(cur.region) ?? []) {
      if (seen.has(p.toRegionId)) continue;
      seen.add(p.toRegionId);
      q.push({ region: p.toRegionId, first: cur.first });
    }
  }
  return undefined;
}

type CrossRegionResult = 'local' | 'walking' | 'crossed' | 'snapped';

function approachRegion(input: {
  readonly state: SocietyState;
  readonly agent: SocietyAgent;
  readonly destRegionId: string;
  readonly tiles: number;
  readonly rng: () => number;
  readonly emit: (e: SocietyEvent) => void;
  readonly idFactory: () => string;
  readonly reason: string;
}): CrossRegionResult {
  const { state, agent, destRegionId } = input;
  if (!destRegionId || destRegionId === agent.regionId) return 'local';
  if (!isSocietyRegionId(state, destRegionId)) return 'local';
  const hop = firstPortalHop(state.portals ?? [], agent.regionId, destRegionId);
  if (!hop) {
    agent.regionId = destRegionId;
    snapAgentOffWalls(
      agent,
      regionBoundsOf(state, destRegionId),
      state.regionGrids?.get(destRegionId),
    );
    agent.walkPath = undefined;
    input.emit({
      id: input.idFactory(),
      simTime: state.simTime,
      kind: 'move',
      agentId: agent.id,
      payload: {
        regionId: agent.regionId,
        x: agent.x,
        y: agent.y,
        reason: input.reason,
      },
    });
    return 'snapped';
  }
  const bounds = regionBoundsOf(state, agent.regionId);
  const grid = state.regionGrids?.get(agent.regionId);
  const exit = grid
    ? nearestWalkable(grid, hop.fromPos.x, hop.fromPos.y)
    : { x: hop.fromPos.x, y: hop.fromPos.y };
  const dist =
    Math.abs(Math.round(agent.x) - exit.x) +
    Math.abs(Math.round(agent.y) - exit.y);
  if (dist <= 1) {
    const fromRegionId = agent.regionId;
    agent.regionId = hop.toRegionId;
    const enterGrid = state.regionGrids?.get(hop.toRegionId);
    const at = enterGrid
      ? nearestWalkable(enterGrid, hop.toPos.x, hop.toPos.y)
      : { x: hop.toPos.x, y: hop.toPos.y };
    agent.x = at.x;
    agent.y = at.y;
    agent.walkPath = undefined;
    snapAgentOffWalls(
      agent,
      regionBoundsOf(state, hop.toRegionId),
      enterGrid,
    );
    agent.currentAction = portalCrossingAction(
      hop.label,
      societyCopyAscii(input.state),
    );
    agent.goalPlace = hop.label ?? hop.toRegionId;
    agent.goalReason = 'portal';
    input.emit({
      id: input.idFactory(),
      simTime: state.simTime,
      kind: 'move',
      agentId: agent.id,
      payload: {
        regionId: agent.regionId,
        x: agent.x,
        y: agent.y,
        reason: 'portal',
        fromRegionId,
        toRegionId: hop.toRegionId,
        portalId: hop.id,
      },
    });
    return 'crossed';
  }
  for (let i = 0; i < input.tiles; i++) {
    const left =
      Math.abs(Math.round(agent.x) - exit.x) +
      Math.abs(Math.round(agent.y) - exit.y);
    if (left <= 1) break;
    stepToward(
      agent,
      exit,
      bounds,
      input.rng,
      grid,
      occupiedCells(state, agent.id, agent.regionId),
    );
  }
  agent.goalX = exit.x;
  agent.goalY = exit.y;
  agent.goalPlace = hop.label ?? destRegionId;
  agent.goalReason = 'portal';
  agent.currentAction = portalHeadingAction(
    hop.label,
    societyCopyAscii(input.state),
  );
  input.emit({
    id: input.idFactory(),
    simTime: state.simTime,
    kind: 'move',
    agentId: agent.id,
    payload: {
      regionId: agent.regionId,
      x: agent.x,
      y: agent.y,
      reason: 'approach-portal',
      portalId: hop.id,
      goalX: exit.x,
      goalY: exit.y,
    },
  });
  return 'walking';
}

function occupiedCells(
  state: SocietyState,
  exceptId: string,
  regionId: string,
): Set<string> {
  const cells = new Set<string>();
  for (const a of state.agents) {
    if (a.id === exceptId || a.regionId !== regionId) continue;
    cells.add(`${Math.round(a.x)},${Math.round(a.y)}`);
  }
  return cells;
}

function stepToward(
  agent: SocietyAgent,
  goal: { x: number; y: number },
  bounds: { width: number; height: number },
  rng: () => number,
  grid?: RegionGrid,
  occupied?: Set<string>,
): void {
  const start = {
    x: Math.round(clampCoord(agent.x, bounds.width)),
    y: Math.round(clampCoord(agent.y, bounds.height)),
  };
  const rawGoal = {
    x: Math.round(goal.x),
    y: Math.round(goal.y),
  };
  const snappedGoal = grid
    ? nearestWalkable(grid, rawGoal.x, rawGoal.y)
    : rawGoal;
  const hardBlocked = (x: number, y: number): boolean =>
    grid ? isBlocked(grid, x, y) : false;
  const dist =
    Math.abs(start.x - snappedGoal.x) + Math.abs(start.y - snappedGoal.y);
  if (dist <= 1) {
    agent.x = snappedGoal.x;
    agent.y = snappedGoal.y;
    agent.walkPath = undefined;
    snapAgentOffWalls(agent, bounds, grid);
    return;
  }
  if (dist === 2) {
    const dx = Math.sign(snappedGoal.x - start.x);
    const dy = Math.sign(snappedGoal.y - start.y);
    const candidates =
      dx !== 0 && dy !== 0
        ? [
            { x: start.x + dx, y: start.y },
            { x: start.x, y: start.y + dy },
          ]
        : [{ x: start.x + dx, y: start.y + dy }];
    for (const hop of candidates) {
      if (
        hop.x < 0 ||
        hop.y < 0 ||
        hop.x >= bounds.width ||
        hop.y >= bounds.height
      ) {
        continue;
      }
      if (hardBlocked(hop.x, hop.y)) continue;
      if (occupied?.has(`${hop.x},${hop.y}`)) continue;
      agent.x = hop.x;
      agent.y = hop.y;
      agent.walkPath = undefined;
      snapAgentOffWalls(agent, bounds, grid);
      return;
    }
  }
  const cached = agent.walkPath;
  if (
    cached &&
    cached.gx === snappedGoal.x &&
    cached.gy === snappedGoal.y &&
    cached.cells.length > 1 &&
    cached.cells[0]!.x === start.x &&
    cached.cells[0]!.y === start.y
  ) {
    const hop = cached.cells[1]!;
    if (!hardBlocked(hop.x, hop.y) && !occupied?.has(`${hop.x},${hop.y}`)) {
      agent.x = hop.x;
      agent.y = hop.y;
      agent.walkPath = { ...cached, cells: cached.cells.slice(1) };
      snapAgentOffWalls(agent, bounds, grid);
      return;
    }
    agent.walkPath = undefined;
  }
  const softBlocked = (x: number, y: number): boolean => {
    if (hardBlocked(x, y)) return true;
    if (!occupied || (x === start.x && y === start.y)) return false;
    return occupied.has(`${x},${y}`);
  };
  let path = findPath(
    bounds.width,
    bounds.height,
    softBlocked,
    start,
    snappedGoal,
  );
  if (!path || path.length <= 1) {
    path = findPath(
      bounds.width,
      bounds.height,
      hardBlocked,
      start,
      snappedGoal,
    );
  }
  if (path && path.length > 1) {
    const next = path[1]!;
    agent.x = next.x;
    agent.y = next.y;
    agent.walkPath = {
      gx: snappedGoal.x,
      gy: snappedGoal.y,
      cells: path,
    };
  } else {
    agent.walkPath = undefined;
    const nx = start.x + Math.floor(rng() * 3) - 1;
    const ny = start.y + Math.floor(rng() * 3) - 1;
    if (
      nx >= 0 &&
      ny >= 0 &&
      nx < bounds.width &&
      ny < bounds.height &&
      !hardBlocked(nx, ny) &&
      !occupied?.has(`${nx},${ny}`)
    ) {
      agent.x = nx;
      agent.y = ny;
    }
  }
  snapAgentOffWalls(agent, bounds, grid);
}

/**
 * Where a resident stands once they have arrived.
 *
 * Arrival used to re-roll a random ±1 tile offset on every tick, so anybody
 * "at" a place twitched a tile back and forth for as long as they stayed —
 * which read as residents walking off and snapping back for no reason. The spot
 * is now stable per resident and per place, which also fans a group out around
 * the anchor instead of stacking everyone on it.
 */
function standingSpot(
  agentId: string,
  goal: { x: number; y: number; anchorId?: string | undefined },
  bounds: { width: number; height: number },
  grid?: RegionGrid,
): { x: number; y: number } {
  const seed = `stand:${agentId}:${goal.anchorId ?? `${goal.x},${goal.y}`}`;
  const h = Math.abs(hashStr(seed));
  const x = Math.max(
    1,
    Math.min(bounds.width - 2, goal.x + ((h % 3) - 1)),
  );
  const y = Math.max(
    1,
    Math.min(bounds.height - 2, goal.y + (((h >> 4) % 3) - 1)),
  );
  if (grid && isBlocked(grid, x, y)) {
    return nearestWalkable(grid, goal.x, goal.y);
  }
  return { x, y };
}

function snapAgentOffWalls(
  agent: SocietyAgent,
  bounds: { width: number; height: number },
  grid?: RegionGrid,
): void {
  clampAgentPose(agent, bounds);
  if (!grid) return;
  const x = Math.round(agent.x);
  const y = Math.round(agent.y);
  if (!isBlocked(grid, x, y)) {
    agent.x = x;
    agent.y = y;
    return;
  }
  const walk = nearestWalkable(grid, agent.x, agent.y);
  agent.x = walk.x;
  agent.y = walk.y;
}

function assignAgentArea(state: SocietyState, agent: SocietyAgent): void {
  const hit = nearestAreaAnchor(state.anchors, state.objects, agent);
  agent.areaId = hit?.areaId;
  agent.areaName = hit?.areaName;
}

function assignAllAgentAreas(state: SocietyState): void {
  for (const agent of state.agents) assignAgentArea(state, agent);
}

function workplaceLikeObject(obj: WorldObjectState): boolean {
  const kind = obj.kind ?? objectKindFromName(obj.name);
  return (
    kind === 'oven' ||
    kind === 'stove' ||
    kind === 'bed' ||
    kind === 'food' ||
    kind === 'work'
  );
}

function workplaceAreaIds(
  state: SocietyState,
  agent: SocietyAgent,
): Set<string> {
  const ids = new Set<string>();
  if (!agent.workAreaId) return ids;
  ids.add(agent.workAreaId);
  const nook = state.anchors?.get(agent.workAreaId);
  if (nook?.parentAreaId) ids.add(nook.parentAreaId);
  return ids;
}

/** Extinguished / broken workplace or nearby stove — observer set_object demo. */
function brokenObjectForAgent(
  state: SocietyState,
  agent: SocietyAgent,
): WorldObjectState | undefined {
  const workIds = workplaceAreaIds(state, agent);
  for (const obj of state.objects) {
    if (objectIsUsable(obj)) continue;
    if (workIds.has(obj.areaId) || workIds.has(obj.id)) {
      return obj;
    }
    if (
      agent.homeAreaId &&
      obj.areaId === agent.homeAreaId &&
      (obj.kind ?? objectKindFromName(obj.name)) === 'bed'
    ) {
      return obj;
    }
    if (!workplaceLikeObject(obj)) continue;
    const anchor = state.anchors?.get(obj.id);
    if (
      !anchor ||
      !objectInAgentRegion(obj, agent.regionId) ||
      Math.hypot(agent.x - anchor.x, agent.y - anchor.y) > 3
    ) {
      continue;
    }
    return obj;
  }
  return undefined;
}

function fallbackPlaceAwayFromBroken(
  places: readonly PlanPlace[],
  broken: WorldObjectState,
  hubRegionId?: string,
): string | undefined {
  const avoid = new Set(
    [broken.areaId, broken.id].filter((x): x is string => Boolean(x)),
  );
  const ok = (p: PlanPlace) => !avoid.has(p.id);
  const hub = places.find(
    (p) =>
      ok(p) &&
      (p.id === hubRegionId ||
        p.regionId === hubRegionId ||
        p.kind === 'social'),
  );
  if (hub) return hub.id;
  const named = places.find(
    (p) =>
      ok(p) && /广场|码头|街|市|舰桥|甲板|礼拜堂|舱|dock|bridge|chapel/i.test(p.name),
  );
  if (named) return named.id;
  return places.find(ok)?.id;
}

function pickNeedObject(
  state: SocietyState,
  agent: SocietyAgent,
  needKind: string,
): string | undefined {
  if (
    needKind !== 'hunger' &&
    needKind !== 'energy' &&
    needKind !== 'curiosity' &&
    needKind !== 'social'
  ) {
    return undefined;
  }
  const local = state.objects.filter(
    (o) => objectInAgentRegion(o, agent.regionId) && objectMatchesNeed(o, needKind),
  );
  const pool = local.length
    ? local
    : state.objects.filter((o) => objectMatchesNeed(o, needKind));
  const withAnchor = pool.find((o) => state.anchors?.has(o.id));
  return withAnchor?.id ?? pool[0]?.id;
}

function tryUseNearbyObject(input: {
  readonly state: SocietyState;
  readonly agent: SocietyAgent;
  readonly activity: string;
  readonly driveKind?: string;
  readonly idFactory: () => string;
  readonly emit: (e: SocietyEvent) => void;
  readonly wearChance?: number;
}): string | undefined {
  const { state, agent } = input;
  let best: { obj: WorldObjectState; dist: number } | undefined;
  for (const obj of state.objects) {
    if (!objectInAgentRegion(obj, agent.regionId)) continue;
    const anchor = state.anchors?.get(obj.id);
    if (!anchor) continue;
    const dist = Math.hypot(agent.x - anchor.x, agent.y - anchor.y);
    if (dist > 2.4) continue;
    if (!objectIsUsable(obj)) continue;
    const driveMatch =
      input.driveKind &&
      (input.driveKind === 'hunger' ||
        input.driveKind === 'energy' ||
        input.driveKind === 'curiosity') &&
      objectMatchesNeed(obj, input.driveKind);
    const activityMatch =
      /睡|歇|吃|烘|烤|告示|布告|炉|床|值班|交班|晚课|铺位|舱|watch|mess|galley|sleep|rest|eat|cook|bake|notice|bunk|shift|vespers/i.test(
        input.activity,
      ) &&
      (objectKindFromName(obj.name) !== 'other' ||
        input.activity.includes(obj.name));
    if (!driveMatch && !activityMatch) continue;
    if (!best || dist < best.dist) best = { obj, dist };
  }
  if (!best) return undefined;
  const ascii = societyCopyAscii(state);
  const used = useWorldObject(best.obj, input.activity);
  const wear = wearWorldObject({
    obj: best.obj,
    simTime: state.simTime,
    ascii,
    ...(input.wearChance == null ? {} : { chance: input.wearChance }),
  });
  const action = wear
    ? brokenObjectReason(best.obj.name, ascii)
    : used.action;
  const nextState = wear ? wear.brokeState : used.nextState;
  const idx = state.objects.findIndex((o) => o.id === best.obj.id);
  if (idx >= 0) {
    state.objects[idx] = { ...best.obj, state: nextState };
  }
  state.stream.add(
    createMemoryEntry({
      id: input.idFactory(),
      agentId: agent.id,
      kind: 'observation',
      text: objectUsedMemory(best.obj.name, nextState, ascii),
      simTime: state.simTime,
      // A breakdown is news: it has to outrank routine use in retrieval or
      // nobody will bring it up and the incident dies unmentioned.
      importance: wear ? 8 : 6,
    }),
  );
  input.emit({
    id: input.idFactory(),
    simTime: state.simTime,
    kind: 'use-object',
    agentId: agent.id,
    payload: {
      objectId: best.obj.id,
      name: best.obj.name,
      state: nextState,
      action,
      ...(wear ? { broke: true } : {}),
    },
  });
  return action;
}

/** Pack-agnostic: write today's day plans if missing. */
export async function stepMemory(input: {
  readonly state: SocietyState;
  readonly dayIndex: number;
  readonly places: readonly PlanPlace[];
  readonly idFactory: () => string;
  readonly takePlanLlm: (agentId?: string) => LlmTextFn | undefined;
  readonly emit: (e: SocietyEvent) => void;
}): Promise<void> {
  const { state, dayIndex, places, idFactory, takePlanLlm, emit } = input;
  const jobs: Array<Promise<void>> = [];
  for (const agent of state.agents) {
    const existing = state.plans.get(agent.id);
    if (existing && existing.dayIndex === dayIndex) continue;
    const llm = takePlanLlm(agent.id);
    jobs.push(
      (async () => {
        const plan = await generateDayPlan({
          stream: state.stream,
          agentId: agent.id,
          agentName: agent.name,
          identitySummary: agent.identitySummary,
          dayIndex,
          nowSimTime: state.simTime,
          idFactory,
          llm,
          homeRegionId: agent.regionId,
          homeAreaId: agent.homeAreaId,
          workAreaId: agent.workAreaId,
          occupation: agent.occupation,
          schedule: agent.schedule,
          places,
          hubRegionId: state.hubRegionId,
          clockKind: state.clockKind,
          relations: relationsFor(state, agent.id),
        });
        state.plans.set(agent.id, plan);
        emit({
          id: idFactory(),
          simTime: state.simTime,
          kind: 'plan',
          agentId: agent.id,
          payload: { dayIndex, segments: plan.segments },
        });
      })(),
    );
  }
  await Promise.all(jobs);
}

/** Pack-agnostic: walk toward a region via portals. */
export function stepLocomotion(
  input: Parameters<typeof approachRegion>[0],
): ReturnType<typeof approachRegion> {
  return approachRegion(input);
}

/** Pack-agnostic: use a nearby usable object if the activity matches. */
export function stepObjects(
  input: Parameters<typeof tryUseNearbyObject>[0],
): ReturnType<typeof tryUseNearbyObject> {
  return tryUseNearbyObject(input);
}

/** Pack-agnostic: run or queue conversations after locomotion. */
export async function stepTalk(input: {
  readonly state: SocietyState;
  readonly jobs: readonly PendingSocietyTalk[];
  readonly options: StepSocietyOptions;
  readonly emit: (e: SocietyEvent) => void;
  readonly idFactory: () => string;
}): Promise<void> {
  const { state, jobs, options, emit, idFactory } = input;
  if (options.skipConversations) {
    const cap = Math.max(1, options.maxPendingTalks ?? 8);
    state.pendingTalks = mergePendingTalks(state.pendingTalks ?? [], jobs, cap);
    for (const job of jobs) {
      for (const key of job.pairs) {
        state.lastConverseAt.set(key, state.simTime);
      }
    }
    return;
  }
  state.pendingTalks = [];
  await runPendingSocietyTalks({
    state,
    jobs,
    options,
    emit,
    idFactory,
    cooldownAlreadySet: false,
  });
}

/** Pack-agnostic: embeddings + world-model surprise after the step. */
export async function stepMemoryFlush(
  state: SocietyState,
  options: StepSocietyOptions,
): Promise<void> {
  await upgradeMemoryEmbeddings({
    stream: state.stream,
    agentIds: state.agents.map((a) => a.id),
    embed: options.embed,
    maxTexts: options.maxEmbedTextsPerStep ?? 24,
  });
  state.worldModel ??= new SocietyTransitionModel();
  const surprise = state.worldModel.observe(state);
  applyTownSurprise(state.agents, surprise);
}

export async function stepSociety(
  state: SocietyState,
  options: StepSocietyOptions = {},
): Promise<SocietyEvent[]> {
  const dt = options.dtHours ?? 1;
  const idFactory = options.idFactory ?? defaultId;
  const rng = mulberry32(state.seed + Math.floor(state.simTime * 1000));
  const produced: SocietyEvent[] = [];
  const emit = (e: SocietyEvent) => {
    produced.push(e);
    appendSocietyEvent(state, e);
  };
  if (!state.lastConverseAt) state.lastConverseAt = new Map();
  if (state.lastWhisperClearedAt == null) state.lastWhisperClearedAt = -Infinity;
  const talkedThisStep = new Set<string>();
  /** ~1 heartbeat step. Same pair still walks a beat between chats. */
  const TALK_COOLDOWN_H = 0.05;
  const DRIVE_REPLAN_COOLDOWN_H = 1;
  const maxConversations = Math.max(
    0,
    options.maxConversationsPerStep ?? Number.POSITIVE_INFINITY,
  );
  const maxLlmConversations = Math.max(
    0,
    Math.min(
      maxConversations,
      options.maxLlmConversationsPerStep ?? maxConversations,
    ),
  );
  const planLlmBudget = Math.max(
    0,
    options.maxPlanLlmCallsPerStep ??
      (options.converseOnlyLlm ? 0 : Number.POSITIVE_INFINITY),
  );
  let planLlmSpent = 0;
  const mayThink = (agentId?: string): boolean =>
    !agentId || !options.llmEligibleIds || options.llmEligibleIds.has(agentId);
  /** Hand the model to plan/replan/reflect/importance until this step's budget is gone. */
  const takePlanLlm = (agentId?: string): LlmTextFn | undefined => {
    if (!mayThink(agentId)) return undefined;
    if (!options.llm || planLlmSpent >= planLlmBudget) return undefined;
    planLlmSpent += 1;
    return options.llm;
  };
  const reactLlmBudget = Math.max(0, options.maxReactLlmCallsPerStep ?? 0);
  let reactLlmSpent = 0;
  const takeReactLlm = (agentId?: string): LlmTextFn | undefined => {
    if (!mayThink(agentId)) return undefined;
    if (!options.llm || reactLlmSpent >= reactLlmBudget) return undefined;
    reactLlmSpent += 1;
    return options.llm;
  };
  const dialogueLlm = options.talkLlm ?? options.llm;
  const maxGroupSize = Math.max(
    2,
    Math.min(5, options.maxGroupSize ?? MAX_GROUP_SIZE),
  );
  let conversationsThisStep = 0;
  let llmConversationsThisStep = 0;
  let objectTalkQueued = false;
  const pendingTalks: PendingSocietyTalk[] = [];
  const townRumor = pickTownRumorFromState(state);
  const rumorTown = townRumor
    ? rumorAwareness({
        stream: state.stream,
        agentIds: state.agents.map((a) => a.id),
        rumorText: townRumor,
      })
    : { awareCount: 0, total: state.agents.length, saturated: false };
  const lateReplans: Promise<void>[] = [];
  const heldById = new Map<string, string>();
  const neighborFallback = societyCopyAscii(state) ? 'neighbor' : '邻居';
  for (const held of state.heldTalks ?? []) {
    for (const id of held.participantIds) {
      const other = held.participantIds.find((x) => x !== id);
      const otherName = other
        ? (held.names[other] ?? neighborFallback)
        : neighborFallback;
      heldById.set(id, otherName);
    }
  }

  state.simTime += dt;
  const dayIndex = Math.floor(state.simTime / 24);
  const hourOfDay = state.simTime % 24;
  state.worldModel ??= new SocietyTransitionModel();
  if (state.heldTalks?.length) {
    state.heldTalks = state.heldTalks
      .map((h) =>
        h.sinceSimTime == null ? { ...h, sinceSimTime: state.simTime } : h,
      )
      .filter(
        (h) => state.simTime - (h.sinceSimTime ?? state.simTime) < HOLD_MAX_H,
      );
  }
  heldById.clear();
  for (const held of state.heldTalks ?? []) {
    for (const id of held.participantIds) {
      const other = held.participantIds.find((x) => x !== id);
      const otherName = other
        ? (held.names[other] ?? neighborFallback)
        : neighborFallback;
      heldById.set(id, otherName);
    }
  }

  const places = planPlaces(state);
  await stepMemory({
    state,
    dayIndex,
    places,
    idFactory,
    takePlanLlm,
    emit,
  });

  // Act / react per agent (rotate initiator so the same NPC does not always talk first)
  const start =
    state.agents.length > 0
      ? Math.floor(state.simTime * 4) % state.agents.length
      : 0;
  const agentsThisStep = [
    ...state.agents.slice(start),
    ...state.agents.slice(0, start),
  ];
  const objectBreakById = new Map<string, { reason: string; objectId: string }>();
  const objectReplans: Promise<void>[] = [];
  const regionBuckets = new Map<string, typeof state.agents>();
  const regionCounts = new Map<string, number>();
  for (const resident of state.agents) {
    const list = regionBuckets.get(resident.regionId) ?? [];
    list.push(resident);
    regionBuckets.set(resident.regionId, list);
    regionCounts.set(resident.regionId, (regionCounts.get(resident.regionId) ?? 0) + 1);
  }
  const townNames: AgentPose[] = state.agents.map((a) => ({
    agentId: a.id,
    name: a.name,
    regionId: a.regionId,
    x: a.x,
    y: a.y,
    currentAction: a.currentAction,
    areaId: a.areaId,
  }));
  const crowdSnapshot =
    state.agents.length > 24 ? crowdPoses(state) : undefined;
  for (const agent of agentsThisStep) {
    agent.needs ??= createNeeds(agent.id);
    const existing = state.plans.get(agent.id) ?? null;
    const holding = heldById.get(agent.id);
    const mayReplan =
      state.simTime - (agent.lastDriveReplanSimTime ?? -Infinity) >=
      DRIVE_REPLAN_COOLDOWN_H;
    const broken = brokenObjectForAgent(state, agent);
    if (broken && existing && mayReplan && !holding) {
      agent.lastDriveReplanSimTime = state.simTime;
      const reason = brokenObjectReason(broken.name, societyCopyAscii(state));
      objectBreakById.set(agent.id, { reason, objectId: broken.id });
      const elsewhere = fallbackPlaceAwayFromBroken(
        places,
        broken,
        state.hubRegionId,
      );
      const llm = takePlanLlm(agent.id);
      objectReplans.push(
        (async () => {
          const next = await replanFromNow({
            stream: state.stream,
            agentId: agent.id,
            agentName: agent.name,
            identitySummary: agent.identitySummary,
            dayIndex,
            nowSimTime: state.simTime,
            idFactory,
            llm,
            homeRegionId: agent.regionId,
            homeAreaId: agent.homeAreaId,
            workAreaId: agent.workAreaId,
            occupation: agent.occupation,
            schedule: agent.schedule,
            places,
            hubRegionId: state.hubRegionId,
            clockKind: state.clockKind,
            relations: relationsFor(state, agent.id),
            reason,
            hourOfDay,
            urgentActivity: reason,
            urgentLocationId: elsewhere,
          });
          state.plans.set(agent.id, next);
          agent.goalReason = reason;
          agent.goalPlace = broken.name;
          agent.currentAction = reason;
          emit({
            id: idFactory(),
            simTime: state.simTime,
            kind: 'plan',
            agentId: agent.id,
            payload: {
              dayIndex,
              replan: true,
              reason,
              objectId: broken.id,
              segments: next.segments,
            },
          });
        })(),
      );
    }
  }
  await Promise.all(objectReplans);
  for (const agent of agentsThisStep) {
    const tiles = Math.max(2, Math.round(dt * 8));
    let plan = state.plans.get(agent.id) ?? null;
    let seg = plan ? segmentAt(plan, hourOfDay) : null;
    agent.needs ??= createNeeds(agent.id);
    const drive: UrgentNeed | undefined = urgentNeed(agent.needs, {
      currentActivity: seg?.activity,
      ascii: societyCopyAscii(state),
      packId: state.packId,
    });
    // One interruption per sim hour: without this a drive that takes a while to
    // satisfy rewrites the schedule on every single step.
    let mayReplanForDrive =
      state.simTime - (agent.lastDriveReplanSimTime ?? -Infinity) >=
      DRIVE_REPLAN_COOLDOWN_H;
    let reflectedThisStep = false;
    const holdingWith = heldById.get(agent.id);
    const rumorHintEarly = freshTraceText(
      state.stream.list(agent.id),
      state.simTime,
      FRESH_TRACE_H,
    )?.text;
    const daytime = isSocialHour(hourOfDay, state.clockKind);
    const peersNearby = state.agents.some(
      (o) =>
        o.id !== agent.id &&
        o.regionId === agent.regionId &&
        Math.hypot(o.x - agent.x, o.y - agent.y) <= 8,
    );
    const rumorText = rumorHintEarly;
    const localRumorUnknown = rumorText
      ? state.agents.some(
          (o) =>
            o.id !== agent.id &&
            o.regionId === agent.regionId &&
            shouldTell(
              state.stream,
              agent.id,
              o.id,
              rumorText,
              tellCard(agent, knownPeerIds(state, agent.id)),
            ),
        )
      : false;
    const rumorNeedsTravel =
      Boolean(rumorHintEarly) &&
      !localRumorUnknown &&
      !rumorTown.saturated;
    const justTalked = [...state.lastConverseAt.entries()].some(
      ([key, at]) =>
        key.split('|').includes(agent.id) &&
        state.simTime - at < LEAVE_HUB_AFTER_TALK_H,
    );
    const stayAndTalk =
      Boolean(holdingWith) ||
      (peersNearby &&
        daytime &&
        (drive?.kind === 'social' || Boolean(rumorHintEarly)) &&
        !rumorNeedsTravel &&
        !justTalked);

    let objectBreakReason = objectBreakById.get(agent.id)?.reason;
    if (objectBreakReason) {
      mayReplanForDrive = false;
      plan = state.plans.get(agent.id) ?? plan;
      seg = plan ? segmentAt(plan, hourOfDay) : null;
    }

    if (holdingWith) {
      agent.currentAction = talkingAction(
        holdingWith,
        societyCopyAscii(state),
      );
      emit({
        id: idFactory(),
        simTime: state.simTime,
        kind: 'action',
        agentId: agent.id,
        payload: {
          activity: agent.currentAction,
          x: agent.x,
          y: agent.y,
          regionId: agent.regionId,
          talkingWith: holdingWith,
        },
      });
      const partner = state.agents.find(
        (o) =>
          o.id !== agent.id &&
          o.regionId === agent.regionId &&
          heldById.has(o.id),
      );
      if (partner) {
        const dist = Math.hypot(partner.x - agent.x, partner.y - agent.y);
        if (dist > 2.4) {
          const x0 = agent.x;
          const y0 = agent.y;
          stepToward(
            agent,
            { x: partner.x, y: partner.y },
            regionBoundsOf(state, agent.regionId),
            rng,
            state.regionGrids?.get(agent.regionId),
            occupiedCells(state, agent.id, agent.regionId),
          );
          if (agent.x !== x0 || agent.y !== y0) {
            emit({
              id: idFactory(),
              simTime: state.simTime,
              kind: 'move',
              agentId: agent.id,
              payload: {
                regionId: agent.regionId,
                x: agent.x,
                y: agent.y,
                reason: 'stay-talk',
              },
            });
          }
        }
      }
    } else if (seg) {
      const beats = decomposeSegmentActions(seg);
      const beatIdx = Math.floor((state.simTime % 1) * beats.length);
      const newsClaim = rumorHintEarly ? rumorClaim(rumorHintEarly) : '';
      const chasingNews = Boolean(newsClaim) && !objectBreakReason;
      // Nearby company beats a hunger trek — don't empty the square with the
      // same "饿了，去找点吃的" line on every head.
      agent.currentAction = objectBreakReason
        ? objectBreakReason
        : chasingNews
          ? checkingNewsAction(newsClaim, societyCopyAscii(state))
          : drive && !stayAndTalk
            ? societyCopyAscii(state)
              ? `${drive.label}, ${drive.activity}`
              : `${drive.label}，${drive.activity}`
            : beats[Math.min(beats.length - 1, Math.max(0, beatIdx))] ??
              seg.activity;
      let commuting = false;
      const needObjectId =
        drive && !stayAndTalk && !chasingNews
          ? pickNeedObject(state, agent, drive.kind)
          : undefined;
      if (needObjectId) {
        const obj = state.objects.find((o) => o.id === needObjectId);
        const destRegion = obj ? objectRegionId(obj) : agent.regionId;
        if (destRegion !== agent.regionId) {
          commuting =
            stepLocomotion({
              state,
              agent,
              destRegionId: destRegion,
              tiles,
              rng,
              emit,
              idFactory,
              reason: 'drive',
            }) === 'walking';
        }
      } else if (chasingNews) {
        const here = regionCounts.get(agent.regionId) ?? 1;
        const crowded = [...regionCounts.entries()].sort(
          (a, b) => b[1] - a[1],
        )[0]?.[0];
        if (crowded && crowded !== agent.regionId && here < 3) {
          commuting =
            stepLocomotion({
              state,
              agent,
              destRegionId: crowded,
              tiles,
              rng,
              emit,
              idFactory,
              reason: 'seek-talk',
            }) === 'walking';
        }
      } else if (!drive && seg.locationId && seg.locationId !== agent.regionId) {
        const nextRegion = regionForLocation(
          state,
          seg.locationId,
          agent.regionId,
        );
        commuting =
          stepLocomotion({
            state,
            agent,
            destRegionId: nextRegion,
            tiles,
            rng,
            emit,
            idFactory,
            reason: 'plan',
          }) === 'walking';
      }
      const boundsNow = regionBoundsOf(state, agent.regionId);
      const gridNow = state.regionGrids?.get(agent.regionId);
      const goal = commuting
        ? {
            x: agent.goalX ?? agent.x,
            y: agent.goalY ?? agent.y,
            reason: 'portal' as const,
            anchorId: undefined,
          }
        : resolveActivityGoal({
        anchors: state.anchors,
        agentId: agent.id,
        regionId: agent.regionId,
        locationId:
          drive && !stayAndTalk
            ? needObjectId
            : seg.locationId,
        activity: drive && !stayAndTalk ? drive.activity : seg.activity,
        hourOfDay,
        bounds: boundsNow,
        crowd: crowdSnapshot ?? crowdPoses(state),
        stickyGoal:
          agent.goalX != null && agent.goalY != null
            ? { x: agent.goalX, y: agent.goalY }
            : undefined,
      });
      const newsPeer =
        chasingNews && !commuting
          ? (regionBuckets.get(agent.regionId) ?? [])
              .filter((other) => other.id !== agent.id)
              .sort(
                (a, b) =>
                  Math.hypot(a.x - agent.x, a.y - agent.y) -
                  Math.hypot(b.x - agent.x, b.y - agent.y),
              )[0]
          : undefined;
      const walkGoal = newsPeer
        ? {
            x: newsPeer.x,
            y: newsPeer.y,
            reason: 'seek-talk' as const,
            anchorId: undefined,
          }
        : goal;
      if (!commuting) {
      const destName =
        (walkGoal.anchorId
          ? state.anchors?.get(walkGoal.anchorId)?.name
          : undefined) ?? walkGoal.anchorId;
      const workAction = agent.currentAction;
      const dist0 = Math.abs(agent.x - walkGoal.x) + Math.abs(agent.y - walkGoal.y);
      const heading =
        dist0 > 2 &&
        Boolean(destName) &&
        !objectBreakReason &&
        !isTalkingAction(agent.currentAction);
      if (heading) {
        agent.currentAction = headingToPlaceAction(
          destName,
          societyCopyAscii(state),
        );
      }
      for (let i = 0; i < tiles; i++) {
        const dist =
          Math.abs(agent.x - walkGoal.x) + Math.abs(agent.y - walkGoal.y);
        if (dist <= 1) {
          const spot = standingSpot(agent.id, walkGoal, boundsNow, gridNow);
          agent.x = spot.x;
          agent.y = spot.y;
          break;
        }
        stepToward(
          agent,
          walkGoal,
          boundsNow,
          rng,
          gridNow,
          occupiedCells(state, agent.id, agent.regionId),
        );
      }
      snapAgentOffWalls(agent, boundsNow, gridNow);
      const dist1 =
        Math.abs(agent.x - walkGoal.x) + Math.abs(agent.y - walkGoal.y);
      if (heading && dist1 <= 1) {
        agent.currentAction = workAction;
      }
      const used = stepObjects({
        state,
        agent,
        activity: agent.currentAction,
        driveKind: drive?.kind,
        idFactory,
        emit,
        ...(options.objectWearChance == null
          ? {}
          : { wearChance: options.objectWearChance }),
      });
      if (used) agent.currentAction = used;
      if (
        used &&
        !objectTalkQueued &&
        !holdingWith &&
        conversationsThisStep < maxConversations
      ) {
        const peer = state.agents.find(
          (o) =>
            o.id !== agent.id &&
            o.regionId === agent.regionId &&
            !heldById.has(o.id),
        );
        if (peer) {
          const key = pairKey(agent.id, peer.id);
          const last = state.lastConverseAt.get(key) ?? -999;
          if (state.simTime - last >= TALK_COOLDOWN_H) {
            objectTalkQueued = true;
            conversationsThisStep += 1;
            talkedThisStep.add(key);
            const talkLlm =
              llmConversationsThisStep < maxLlmConversations
                ? dialogueLlm
                : undefined;
            if (talkLlm) llmConversationsThisStep += 1;
            pendingTalks.push({
              initiatorId: agent.id,
              targetId: peer.id,
              people: [agent, peer],
              pairs: [key],
              topicHint: used,
              talkLlm,
            });
          }
        }
      }
      agent.goalX = walkGoal.x;
      agent.goalY = walkGoal.y;
      agent.goalPlace = newsPeer
        ? newsPeer.name
        : ((walkGoal.anchorId
            ? state.anchors?.get(walkGoal.anchorId)?.name
            : undefined) ?? walkGoal.anchorId);
      agent.goalReason = chasingNews
        ? `核对：${newsClaim.slice(0, 20)}`
        : (objectBreakReason ?? walkGoal.reason);
      agent.drive = drive?.kind;
      }
      assignAgentArea(state, agent);
      emit({
        id: idFactory(),
        simTime: state.simTime,
        kind: 'action',
        agentId: agent.id,
        payload: {
          activity: agent.currentAction,
          x: agent.x,
          y: agent.y,
          regionId: agent.regionId,
          areaId: agent.areaId,
          areaName: agent.areaName,
          goalX: walkGoal.x,
          goalY: walkGoal.y,
          goalPlace: agent.goalPlace,
          goalReason: chasingNews
            ? `核对：${newsClaim.slice(0, 20)}`
            : (objectBreakReason ?? walkGoal.reason),
          drive: drive?.kind,
        },
      });
      const texts = [agent.currentAction];
      const scores = await scoreImportanceBatch(
        texts,
        options.llmImportance ? takePlanLlm(agent.id) : undefined,
      );
      state.stream.add(
        createMemoryEntry({
          id: idFactory(),
          agentId: agent.id,
          kind: 'observation',
          text: agent.currentAction,
          simTime: state.simTime,
          importance: scores[0] ?? heuristicImportance(agent.currentAction),
        }),
      );
    }

    assignAgentArea(state, agent);
    let pose: AgentPose = {
      agentId: agent.id,
      name: agent.name,
      regionId: agent.regionId,
      x: agent.x,
      y: agent.y,
      currentAction: agent.currentAction,
      areaId: agent.areaId,
    };
    const regionMates = regionBuckets.get(agent.regionId) ?? [];
    const gridNear =
      regionMates.length > 24
        ? regionMates.filter(
            (a) =>
              Math.abs(Math.floor(a.x / 6) - Math.floor(agent.x / 6)) <= 1 &&
              Math.abs(Math.floor(a.y / 6) - Math.floor(agent.y / 6)) <= 1,
          )
        : regionMates;
    const sensed = gridNear.length > 1 ? gridNear : regionMates;
    const others: AgentPose[] = sensed.map((a) => ({
      agentId: a.id,
      name: a.name,
      regionId: a.regionId,
      x: a.x,
      y: a.y,
      currentAction: a.currentAction,
      areaId: a.areaId,
    }));
    const rumorHint = rumorHintEarly;
    const keepPromise = agentHasOpenPromise(state, agent.id) && daytime;
    const segKind = seg ? activityAnchorKind(seg.activity, hourOfDay) : undefined;
    const greetingHours = hourOfDay >= 7 && hourOfDay < 10;
    const eveningHours = hourOfDay >= 16 && hourOfDay < 20;
    const sociable =
      !holdingWith &&
      (Boolean(rumorHint) ||
        keepPromise ||
        drive?.kind === 'social' ||
        (drive?.kind === 'curiosity' && daytime) ||
        (daytime && agent.needs.social >= 0.4) ||
        (daytime && agent.needs.curiosity >= 0.55) ||
        (daytime && (state.worldModel?.surprise ?? 0) >= 0.12) ||
        (daytime && segKind === 'social') ||
        (daytime && segKind === 'food') ||
        (segKind === 'work' && daytime) ||
        greetingHours ||
        eveningHours);
    const othersInRegion = others.filter(
      (o) => o.agentId !== agent.id && o.regionId === agent.regionId,
    );
    const mentionedIds = mentionedNearby(state, agent.id, townNames, state.simTime);
    const affinityOf = (id: string): number =>
      state.relations.get(pairKey(agent.id, id))?.affinity ?? 0;
    if (sociable) {
      const crowdPull =
        !holdingWith &&
        daytime &&
        ((state.worldModel?.surprise ?? 0) >= 0.12 ||
          drive?.kind === 'curiosity' ||
          agent.needs.curiosity >= 0.55);
      const seenRegion = lastSeenRegionFromMemories(
        state,
        agent,
        mentionedIds,
      );
      if (
        !othersInRegion.length ||
        rumorNeedsTravel ||
        crowdPull ||
        seenRegion ||
        keepPromise
      ) {
        const crowded = [...regionCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
        const unknownRegion = rumorNeedsTravel
          ? state.agents.find(
              (o) =>
                o.id !== agent.id &&
                shouldTell(
                  state.stream,
                  agent.id,
                  o.id,
                  rumorHintEarly ?? rumorHint ?? '',
                  tellCard(agent, knownPeerIds(state, agent.id)),
                ),
            )?.regionId
          : undefined;
        const hub =
          state.hubRegionId && isSocietyRegionId(state, state.hubRegionId)
            ? state.hubRegionId
            : undefined;
        const gatherRegion =
          (keepPromise && hub && hub !== agent.regionId ? hub : undefined) ??
          unknownRegion ??
          seenRegion ??
          (crowdPull && !rumorHint && !rumorNeedsTravel
            ? crowded ?? hub
            : undefined) ??
          (rumorNeedsTravel ? hub ?? crowded : undefined);
        if (
          gatherRegion &&
          gatherRegion !== agent.regionId &&
          isSocietyRegionId(state, gatherRegion) &&
          (Boolean(rumorHint) ||
            rumorNeedsTravel ||
            Boolean(seenRegion) ||
            keepPromise ||
            (daytime &&
              (drive?.kind === 'social' ||
                drive?.kind === 'curiosity' ||
                agent.needs.social >= 0.5 ||
                agent.needs.curiosity >= 0.55 ||
                (state.worldModel?.surprise ?? 0) >= 0.12)))
        ) {
          const gatherWhy =
            keepPromise && !rumorHint && !rumorNeedsTravel
              ? 'keep-promise'
              : crowdPull && !rumorHint && !rumorNeedsTravel
                ? 'see-crowd'
                : seenRegion
                  ? 'seek-last-seen'
                  : 'seek-talk';
          const crossing = stepLocomotion({
            state,
            agent,
            destRegionId: gatherRegion,
            tiles,
            rng,
            emit,
            idFactory,
            reason: gatherWhy,
          });
          pose = {
            ...pose,
            regionId: agent.regionId,
            x: agent.x,
            y: agent.y,
          };
          if (crossing !== 'walking') {
            agent.currentAction = seekTalkAction(
              gatherWhy,
              societyCopyAscii(state),
            );
          }
        }
      }
      const peersNow = others.filter(
        (o) => o.agentId !== agent.id && o.regionId === agent.regionId,
      );
      const choice = pickTalkPartner({
        self: pose,
        candidates: peersNow,
        hourOfDay,
        activity: agent.currentAction,
        rumorHint,
        rumorUnknownTo: peersNow
          .filter((o) =>
            rumorHint
              ? shouldTell(
                  state.stream,
                  agent.id,
                  o.agentId,
                  rumorHint,
                  tellCard(agent, knownPeerIds(state, agent.id)),
                )
              : false,
          )
          .map((o) => o.agentId),
        drive: drive ? { kind: drive.kind, label: drive.label } : undefined,
        lastConverseAt: state.lastConverseAt,
        affinityOf,
        mentionedIds,
        nowSimTime: state.simTime,
        clockKind: state.clockKind,
      });
      const target = choice?.target;
      if (target) {
        const boundsTalk = regionBoundsOf(state, agent.regionId);
        let dist = Math.hypot(target.x - agent.x, target.y - agent.y);
        let steps = 0;
        const alreadyClose = dist <= 3;
        const chaseBudget = alreadyClose
          ? 0
          : Math.max(1, Math.min(tiles, 4));
        while (dist > 2.2 && steps < chaseBudget) {
          stepToward(
            agent,
            { x: target.x, y: target.y },
            boundsTalk,
            rng,
            state.regionGrids?.get(agent.regionId),
            occupiedCells(state, agent.id, agent.regionId),
          );
          dist = Math.hypot(target.x - agent.x, target.y - agent.y);
          steps += 1;
        }
        if (steps > 0) {
          assignAgentArea(state, agent);
          pose = { ...pose, x: agent.x, y: agent.y };
          emit({
            id: idFactory(),
            simTime: state.simTime,
            kind: 'move',
            agentId: agent.id,
            payload: {
              regionId: agent.regionId,
              x: agent.x,
              y: agent.y,
              reason: 'seek-talk',
            },
          });
        }
      }
    }
    const rumorUnknownTo = rumorHint
      ? others
          .filter(
            (o) =>
              o.agentId !== agent.id &&
              o.regionId === agent.regionId &&
              shouldTell(
                state.stream,
                agent.id,
                o.agentId,
                rumorHint,
                tellCard(agent, knownPeerIds(state, agent.id)),
              ),
          )
          .map((o) => o.agentId)
      : [];
    const boundsHere =
      state.regionBounds?.get(agent.regionId) ?? { width: 32, height: 24 };
    // A flat 3-tile radius made noticing a neighbour a coin flip on any map
    // bigger than a courtyard; scale it with the region instead.
    const noticeRadius = Math.max(
      6,
      Math.round(Math.min(boundsHere.width, boundsHere.height) / 3),
    );
    const perception = perceive(
      pose,
      others,
      state.objects,
      rumorHint ? 32 : noticeRadius,
    );
    // Noticing what the neighbours are up to is where a town's gossip comes from.
    // Without it the only shareable fact in the whole world was the seeded rumor,
    // so every conversation degenerated into repeating it.
    state.witnessed ??= new Map();
    for (const near of perception.nearbyAgents.slice(0, 4)) {
      const subject = state.agents.find((a) => a.id === near.agentId);
      if (!subject) continue;
      const doing = plainActivity(subject.currentAction);
      if (!doing) continue;
      const seenKey = `${agent.id}>${subject.id}`;
      if (state.witnessed.get(seenKey) === doing) continue;
      state.witnessed.set(seenKey, doing);
      const place = subject.areaName || agent.areaName;
      state.stream.add(
        createMemoryEntry({
          id: idFactory(),
          agentId: agent.id,
          kind: 'observation',
          text: witnessObservation({
            name: subject.name,
            place,
            doing,
            ascii: societyCopyAscii(state),
          }),
          simTime: state.simTime,
          importance: 5,
        }),
      );
    }

    let reaction = decideReaction({
      self: pose,
      plan,
      hourOfDay,
      perception,
      rumorHint,
      rumorUnknownTo,
      drive: drive ? { kind: drive.kind, label: drive.label } : undefined,
      lastConverseAt: state.lastConverseAt,
      affinityOf,
      mentionedIds,
      nowSimTime: state.simTime,
      clockKind: state.clockKind,
      socialNeed: agent.needs.social,
    });
    const reactLlm = !holdingWith ? takeReactLlm(agent.id) : undefined;
    if (reactLlm) {
      const sampled = await maybeLlmReaction({
        agentName: agent.name,
        identity: agent.identitySummary,
        activity: agent.currentAction,
        nearby: perception.nearbyAgents.map((n) => ({
          id: n.agentId,
          name: n.name,
        })),
        memories: state.stream
          .list(agent.id)
          .slice(-8)
          .map((m) => m.text),
        rumorHint,
        llm: reactLlm,
      });
      if (sampled) {
        const mentioned = perception.nearbyAgents.some((n) =>
          mentionedIds.has(n.agentId),
        );
        const allowConverse = wantsToChat({
          socialNeed: agent.needs.social,
          rumorHint,
          lonely: drive?.kind === 'social',
          mentioned,
        });
        if (sampled.kind !== 'converse' || allowConverse) {
          reaction = sampled;
        }
      }
    }

    if (reaction.kind === 'investigate') {
      agent.currentAction = investigateAction(
        reaction.reason,
        societyCopyAscii(state),
      );
      const obj = perception.nearbyObjects[0];
      if (obj) {
        state.stream.add(
          createMemoryEntry({
            id: idFactory(),
            agentId: agent.id,
            kind: 'observation',
            text: lookedAtMemory(
              obj.name,
              obj.state,
              societyCopyAscii(state),
            ),
            simTime: state.simTime,
            importance: 6,
          }),
        );
        emit({
          id: idFactory(),
          simTime: state.simTime,
          kind: 'observe',
          agentId: agent.id,
          payload: { objectId: obj.id, state: obj.state, reason: reaction.reason },
        });
      }
    }

    if (reaction.kind === 'replan' && plan && mayReplanForDrive && !holdingWith && !stayAndTalk) {
      if (drive) agent.lastDriveReplanSimTime = state.simTime;
      const llm = takePlanLlm(agent.id);
      const reason = reaction.reason;
      const driveKind = drive?.kind;
      const urgentActivity = drive?.activity;
      const urgentLocationId = drive
        ? anchorIdForKind(state, agent.regionId, drive.anchorKind)
        : undefined;
      lateReplans.push(
        (async () => {
          const next = await replanFromNow({
            stream: state.stream,
            agentId: agent.id,
            agentName: agent.name,
            identitySummary: agent.identitySummary,
            dayIndex,
            nowSimTime: state.simTime,
            idFactory,
            llm,
            homeRegionId: agent.regionId,
            homeAreaId: agent.homeAreaId,
            workAreaId: agent.workAreaId,
            occupation: agent.occupation,
            schedule: agent.schedule,
            places,
            hubRegionId: state.hubRegionId,
            clockKind: state.clockKind,
            relations: relationsFor(state, agent.id),
            reason,
            hourOfDay,
            urgentActivity,
            urgentLocationId,
          });
          state.plans.set(agent.id, next);
          emit({
            id: idFactory(),
            simTime: state.simTime,
            kind: 'plan',
            agentId: agent.id,
            payload: {
              dayIndex,
              replan: true,
              reason,
              drive: driveKind,
              segments: next.segments,
            },
          });
        })(),
      );
    }

    if (reaction.kind === 'converse' && reaction.targetAgentId && !holdingWith) {
      const target = state.agents.find((a) => a.id === reaction.targetAgentId);
      const unknown = new Set(rumorUnknownTo);
      /** Fresh news trumps the "walk it off between chats" cooldown. */
      const cooldownFor = (otherId: string): number =>
        rumorHint && unknown.has(otherId) ? 0.5 : TALK_COOLDOWN_H;
      const free = (otherId: string): boolean => {
        const key = pairKey(agent.id, otherId);
        if (talkedThisStep.has(key)) return false;
        const last = state.lastConverseAt.get(key) ?? -999;
        return state.simTime - last >= cooldownFor(otherId);
      };
      if (target && conversationsThisStep < maxConversations && free(target.id)) {
        // Everyone standing in the same circle joins one exchange instead of
        // splintering into private pairs one step at a time.
        const circle = [target.id];
        for (const near of perception.nearbyAgents) {
          if (circle.length >= maxGroupSize - 1) break;
          if (near.agentId === target.id) continue;
          if (Math.hypot(near.x - pose.x, near.y - pose.y) > GROUP_RADIUS) {
            continue;
          }
          if (!free(near.agentId)) continue;
          circle.push(near.agentId);
        }
        const people = [agent.id, ...circle]
          .map((id) => state.agents.find((a) => a.id === id))
          .filter((a): a is SocietyAgent => Boolean(a));
        const pairs = allPairs(people.map((p) => p.id));
        conversationsThisStep += 1;
        for (const key of pairs) talkedThisStep.add(key);
        const talkLlm =
          llmConversationsThisStep < maxLlmConversations ? dialogueLlm : undefined;
        if (talkLlm) llmConversationsThisStep += 1;
        pendingTalks.push({
          initiatorId: agent.id,
          targetId: target.id,
          people,
          pairs,
          topicHint: reaction.reason,
          talkLlm,
        });
        const names: Record<string, string> = {};
        for (const p of people) names[p.id] = p.name;
        state.heldTalks = [
          ...(state.heldTalks ?? []),
          {
            participantIds: people.map((p) => p.id),
            names,
            sinceSimTime: state.simTime,
          },
        ];
        for (const p of people) {
          const other = people.find((x) => x.id !== p.id);
          const otherName = other?.name ?? (societyCopyAscii(state) ? 'neighbor' : '邻居');
          p.currentAction = talkingAction(otherName, societyCopyAscii(state));
          heldById.set(p.id, otherName);
        }
      }
    }

    // Reflection check periodically
    if (state.simTime - agent.lastReflectSimTime >= 6) {
      const since = agent.lastReflectSimTime;
      const due =
        state.stream.recentImportanceSum(agent.id, since) >= 20;
      const reflected = await maybeReflect({
        stream: state.stream,
        agentId: agent.id,
        agentName: agent.name,
        nowSimTime: state.simTime,
        sinceSimTime: since,
        threshold: 20,
        idFactory,
        llm: due ? takePlanLlm(agent.id) : undefined,
      });
      agent.lastReflectSimTime = state.simTime;
      if (reflected) {
        // Working something out is what actually settles curiosity; without
        // this it climbed to the ceiling and stayed urgent forever.
        reflectedThisStep = true;
        for (const r of reflected.reflections) {
          emit({
            id: idFactory(),
            simTime: state.simTime,
            kind: 'reflection',
            agentId: agent.id,
            payload: {
              text: r.text,
              pointers: r.pointers,
              questions: reflected.questions,
            },
          });
        }
      }
    }

    agent.needs = advanceNeeds({
      needs: agent.needs,
      dtHours: dt,
      hourOfDay,
      activity: agent.currentAction,
      talked: talkedThisStep.has(pairKey(agent.id, reaction.targetAgentId ?? '')),
      reflected: reflectedThisStep,
      clockKind: state.clockKind,
    });
  }

  await Promise.all(lateReplans);

  assignAllAgentAreas(state);
  if (options.flushLocomotion) {
    await options.flushLocomotion(state, produced);
  }

  // Stanford-style: locomotion is local and never waits on a model. Talks run
  // after every resident has already taken this step's walk.
  await stepTalk({
    state,
    jobs: assignTopicsToPendingTalks(state, pendingTalks, {
      rumorText: townRumor,
      rumorSaturated: rumorTown.saturated,
      recentTopics: options.recentTopics,
      spotlightTopic: options.spotlightTopic,
    }),
    options,
    emit,
    idFactory,
  });

  const skipFlush = options.skipMemoryFlush ?? options.skipConversations;
  if (!skipFlush) {
    await stepMemoryFlush(state, options);
  }

  state.seed = (state.seed + 1) >>> 0;
  return produced;
}

const LOCAL_SAY = new Set(['overloaded', 'empty', 'timeout', 'unparsed', 'filtered']);

/** A line the audience can see when the model is busy. Not stored as news. */
function audienceLine(agent: SocietyAgent | undefined): string {
  const action = (agent?.currentAction ?? '').replace(/\s+/g, ' ').trim();
  if (!action || action === 'idle' || action === '闲逛') return '我先在这儿站一会儿';
  return action.length > 36 ? action.slice(0, 36) : action;
}

/**
 * Resolve talks queued by `skipConversations`. Heartbeat calls this after
 * releasing the world lock so walking never waits on MiniMax.
 */
export async function finishSocietyTalks(
  state: SocietyState,
  options: StepSocietyOptions = {},
): Promise<SocietyEvent[]> {
  const jobs = state.pendingTalks ?? [];
  state.pendingTalks = [];
  if (!jobs.length) return [];
  const idFactory = options.idFactory ?? defaultId;
  const produced: SocietyEvent[] = [];
  const emit = (e: SocietyEvent) => {
    produced.push(e);
    appendSocietyEvent(state, e);
  };
  await runPendingSocietyTalks({
    state,
    jobs,
    options,
    emit,
    idFactory,
    cooldownAlreadySet: true,
  });
  await stepMemoryFlush(state, options);
  return produced;
}

async function runPendingSocietyTalks(input: {
  readonly state: SocietyState;
  readonly jobs: readonly PendingSocietyTalk[];
  readonly options: StepSocietyOptions;
  readonly emit: (e: SocietyEvent) => void;
  readonly idFactory: () => string;
  readonly cooldownAlreadySet: boolean;
}): Promise<void> {
  const { state, options, emit, idFactory, cooldownAlreadySet } = input;
  const townRumor = pickTownRumorFromState(state);
  const rumorTown = townRumor
    ? rumorAwareness({
        stream: state.stream,
        agentIds: state.agents.map((a) => a.id),
        rumorText: townRumor,
      })
    : { awareCount: 0, total: state.agents.length, saturated: false };
  const jobs = assignTopicsToPendingTalks(state, input.jobs, {
    rumorText: townRumor,
    rumorSaturated: rumorTown.saturated,
    recentTopics: options.recentTopics,
    spotlightTopic: options.spotlightTopic,
  });
  const avoidLines = recentTownDialogue(state);
  // With a dead key pool every circle fails, and one marker per circle per step
  // would bury the talk log. A couple per step is enough to make it visible.
  let markers = 0;
  let circleIndex = 0;
  const emitTalk = async (
    event: SocietyEvent,
    extra: Record<string, unknown> = {},
  ): Promise<void> => {
    circleIndex += 1;
    const stamp = stampNextTalk(state, circleIndex);
    const stamped: SocietyEvent = {
      ...event,
      payload: { ...event.payload, ...stamp, ...extra },
    };
    emit(stamped);
    await options.onTalkEvent?.(stamped);
  };
  const runJob = async (job: PendingSocietyTalk): Promise<void> => {
    const spotlight = options.spotlightTopic?.trim();
    const sayingSpotlight =
      Boolean(spotlight) &&
      Boolean(job.topicHint) &&
      topicIsStale([spotlight!], job.topicHint!);
    const topicStale =
      Boolean(job.topicHint) &&
      !job.forceRumor &&
      !sayingSpotlight &&
      Boolean(options.recentTopics?.length) &&
      topicIsStale(options.recentTopics ?? [], job.topicHint!);
    const topicHint = topicStale ? undefined : job.topicHint;
    const relSummaries = job.pairs
      .map((k) => state.relations.get(k)?.summary)
      .filter((s): s is string => Boolean(s));
    const relSummary = relSummaries[0];
    const conv = await converseGroup({
      stream: state.stream,
      participants: job.people.map((p) => ({
        id: p.id,
        name: p.name,
        identity: p.identitySummary,
        occupation: p.occupation,
        action: p.currentAction,
        secret: p.secret,
        stance: p.stance,
        goals: p.goalsNote,
        emotion: p.emotionNote,
        voice: p.voiceNote,
        withholdFrom: p.withholdFrom,
        knownIds: knownPeerIds(state, p.id),
      })),
      nowSimTime: state.simTime,
      relationSummary: relSummary,
      relationSummaries: relSummaries,
      topicHint,
      forceRumor: topicStale ? false : job.forceRumor,
      maxTurns: 3,
      avoidLines,
      skipSaturatedGossip: rumorTown.saturated,
      idFactory,
      llm:
        options.llmEligibleIds &&
        !job.people.some((p) => options.llmEligibleIds?.has(p.id))
          ? undefined
          : job.talkLlm,
      embed: options.embed,
      courseSteering: options.courseSteering,
      askOutcomes: Boolean(options.askOutcomes && job.topicHint),
      beliefNote: beliefNoteFor(
        options.beliefCards,
        job.people.map((p) => p.id),
      ),
    });
    if (!conv.skipEvent) {
      for (const turn of conv.turns) avoidLines.push(turn.text);
      if (conv.outcomes) {
        options.onTalkOutcomes?.(
          conv.outcomes,
          job.people.map((p) => ({
            id: p.id,
            name: p.name,
            regionId: p.regionId,
          })),
          job.topicHint,
        );
      }
    }
    if (conv.skipEvent) {
      // Failed beats must not burn the hour-long talk cooldown — retry soon.
      if (cooldownAlreadySet && conv.skipReason !== 'overloaded') {
        for (const key of job.pairs) state.lastConverseAt.delete(key);
      }
      dropHeldTalk(state, job.people.map((p) => p.id));
      const attempt = bumpTalkRetry(state, job.pairs);
      const speaker = job.people.find((person) => person.id === job.initiatorId);
      const showDoing =
        conv.skipReason != null && LOCAL_SAY.has(conv.skipReason);
      if (showDoing) {
        const text = audienceLine(speaker);
        await emitTalk({
          id: idFactory(),
          simTime: state.simTime,
          kind: 'dialogue',
          agentId: job.initiatorId,
          payload: {
            with: job.targetId,
            participants: conv.participantIds,
            turns: [
              {
                speakerId: job.initiatorId,
                speakerName: speaker?.name ?? job.initiatorId,
                text,
              },
            ],
            summary: text,
            spreadCount: 0,
            degraded: false,
            source: 'local',
            audienceOnly: true,
          },
        });
      } else if (conv.skipReason && markers < MAX_TALK_DEGRADE_MARKERS_PER_STEP) {
        markers += 1;
        await emitTalk({
          id: idFactory(),
          simTime: state.simTime,
          kind: 'dialogue',
          agentId: job.initiatorId,
          payload: {
            with: job.targetId,
            participants: conv.participantIds,
            turns: [],
            summary: '',
            spreadCount: 0,
            degraded: true,
            skipped: true,
            skipReason: conv.skipReason,
            attempt,
            retryQueued: attempt < MAX_TALK_RETRIES,
          },
        });
      }
      if (attempt >= MAX_TALK_RETRIES) {
        // Stop hammering a dead model with the same circle every step.
        for (const key of job.pairs) state.lastConverseAt.set(key, state.simTime);
        clearTalkRetry(state, job.pairs);
      }
      return;
    }
    clearTalkRetry(state, job.pairs);
    dropHeldTalk(state, job.people.map((p) => p.id));
    for (const key of job.pairs) {
      state.lastConverseAt.set(key, state.simTime);
      const rel = state.relations.get(key);
      state.relations.set(
        key,
        evolveRelation(rel, {
          summary: conv.summary.slice(0, 160),
          spreadCount: conv.spreadCount,
        }),
      );
    }
    await emitTalk({
      id: idFactory(),
      simTime: state.simTime,
      kind: 'dialogue',
      agentId: job.initiatorId,
      payload: {
        with: job.targetId,
        participants: conv.participantIds,
        turns: conv.turns,
        summary: conv.summary,
        spreadCount: conv.spreadCount,
        degraded: conv.degraded,
        ...(conv.outcomes ? { outcomes: conv.outcomes } : {}),
      },
    });
  };
  const llmByRegion = new Map<string, number>();
  const llmJobs: PendingSocietyTalk[] = [];
  const templateJobs: PendingSocietyTalk[] = [];
  const overflowJobs: PendingSocietyTalk[] = [];
  for (const job of jobs) {
    const region = job.people[0]?.regionId ?? '_';
    const used = llmByRegion.get(region) ?? 0;
    if (job.talkLlm && used < MAX_REGION_LLM_TALKS) {
      llmByRegion.set(region, used + 1);
      llmJobs.push(job);
    } else if (job.talkLlm && options.converseOnlyLlm) {
      // Seed / live converse-only: do not fake a line just because the
      // region already has two MiniMax circles this beat.
      overflowJobs.push(job);
    } else {
      templateJobs.push(job.talkLlm ? { ...job, talkLlm: undefined } : job);
    }
  }
  for (const job of llmJobs) {
    await runJob(job);
  }
  for (const job of overflowJobs) {
    if (cooldownAlreadySet) {
      for (const key of job.pairs) state.lastConverseAt.delete(key);
    }
    dropHeldTalk(state, job.people.map((p) => p.id));
  }
  for (const batch of partitionDisjointTalkJobs(templateJobs)) {
    await Promise.all(batch.map((job) => runJob(job)));
  }
}

function pickTownRumorFromState(state: SocietyState): string | undefined {
  let best: { text: string; sim: number } | undefined;
  for (const agent of state.agents) {
    const hit = freshTraceText(
      state.stream.list(agent.id),
      state.simTime,
      FRESH_TRACE_H,
    );
    if (!hit) continue;
    if (!best || hit.simTime > best.sim) best = { text: hit.text, sim: hit.simTime };
  }
  return best?.text;
}

function townRumorIsFresh(state: SocietyState, text: string | undefined): boolean {
  if (!text) return false;
  let newest = Number.NEGATIVE_INFINITY;
  for (const agent of state.agents) {
    for (const memory of state.stream.list(agent.id)) {
      if (memory.text !== text) continue;
      if (memory.simTime > newest) newest = memory.simTime;
    }
  }
  if (!Number.isFinite(newest)) return false;
  return state.simTime - newest <= FRESH_TRACE_H;
}

function latestEverydayObservation(
  state: SocietyState,
  people: readonly SocietyAgent[],
): string | undefined {
  const hits = people.flatMap((p) =>
    state.stream.list(p.id).filter(
      (m) =>
        m.kind === 'observation' &&
        m.importance < 7 &&
        !m.text.startsWith('【') &&
        !isRumorOrWhisperText(m.text),
    ),
  );
  hits.sort((a, b) => b.simTime - a.simTime);
  return hits[0]?.text;
}

function nearbyObjectCue(
  state: SocietyState,
  agent: SocietyAgent | undefined,
): string | undefined {
  if (!agent) return undefined;
  const obj = state.objects.find(
    (o) => objectInAgentRegion(o, agent.regionId) && o.state?.trim(),
  );
  if (!obj) return undefined;
  return `${obj.name}：${obj.state}`;
}

function recentTownDialogue(state: SocietyState, withinHours = 3): string[] {
  const lines: string[] = [];
  for (const agent of state.agents) {
    for (const m of state.stream.list(agent.id)) {
      if (m.kind !== 'dialogue') continue;
      if (state.simTime - m.simTime > withinHours) continue;
      lines.push(m.text);
    }
  }
  return lines.slice(-40);
}

function assignTopicsToPendingTalks(
  state: SocietyState,
  jobs: readonly PendingSocietyTalk[],
  opts: {
    readonly rumorText?: string;
    readonly rumorSaturated: boolean;
    readonly recentTopics?: readonly string[];
    readonly spotlightTopic?: string;
  },
): PendingSocietyTalk[] {
  if (!jobs.length) return [];
  const ascii = societyCopyAscii(state);
  const circles: TalkTopicCircle[] = jobs.map((job) => {
    const people = job.people;
    const rumor = opts.rumorText;
    const rumorHasUnknownListener = rumor
      ? people.some((p) =>
          people.some(
            (o) =>
              o.id !== p.id &&
              shouldTell(
                state.stream,
                p.id,
                o.id,
                rumor,
                tellCard(p, knownPeerIds(state, p.id)),
              ),
          ),
        )
      : false;
    const stances = [
      ...new Set(people.map((p) => p.stance).filter((s): s is string => Boolean(s))),
    ];
    return {
      regionId: people[0]?.regionId ?? '',
      participantIds: people.map((p) => p.id),
      rumorText: rumor,
      rumorHasUnknownListener,
      rumorFresh: Boolean(rumor) && townRumorIsFresh(state, rumor),
      witness: latestEverydayObservation(state, people),
      objectState: nearbyObjectCue(state, people[0]),
      stanceSplit: stances.length > 1 ? stances.join(' / ') : undefined,
      activity: people[0]?.currentAction,
      existingHint: job.topicHint,
      ascii,
    };
  });
  const recentKeys = new Set(
    (opts.recentTopics ?? []).map((t) => talkTopicKey(t)),
  );
  const assigned = assignTalkTopics(circles, {
    rumorSaturated: opts.rumorSaturated,
    ...(recentKeys.size ? { recentKeys } : {}),
  });
  return jobs.map((job, i) => ({
    ...job,
    topicHint: assigned[i]?.topicHint ?? job.topicHint,
    forceRumor: assigned[i]?.forceRumor === true,
  }));
}

/** Anchors as planner destinations, so schedules can cross the whole town. */
function planPlaces(state: SocietyState): PlanPlace[] {
  const out: PlanPlace[] = [];
  for (const [id, anchor] of state.anchors ?? []) {
    out.push({
      id,
      name: anchor.name ?? id,
      kind: anchor.kind ?? 'other',
      regionId: anchor.regionId,
    });
  }
  return out;
}

function knownPeerIds(state: SocietyState, agentId: string): string[] {
  const ids: string[] = [];
  for (const [key, rel] of state.relations) {
    const [a, b] = key.split('|');
    if (a !== agentId && b !== agentId) continue;
    if ((rel.affinity ?? 0) <= 0) continue;
    const otherId = a === agentId ? b : a;
    if (otherId) ids.push(otherId);
  }
  return ids;
}

function tellCard(
  agent: Pick<SocietyAgent, 'secret' | 'stance' | 'withholdFrom'>,
  knownIds: readonly string[],
): StanceCard {
  return {
    secret: agent.secret,
    stance: agent.stance,
    withholdFrom: agent.withholdFrom,
    knownIds,
  };
}

function relationsFor(state: SocietyState, agentId: string): PlanRelation[] {
  const out: PlanRelation[] = [];
  for (const [key, rel] of state.relations) {
    const [a, b] = key.split('|');
    if (a !== agentId && b !== agentId) continue;
    const otherId = a === agentId ? b : a;
    const other = state.agents.find((x) => x.id === otherId);
    if (!other) continue;
    out.push({ name: other.name, summary: rel.summary, affinity: rel.affinity });
  }
  return out.sort((x, y) => y.affinity - x.affinity);
}

/** Nearest place of a given kind, preferring the agent's own region. */
function anchorIdForKind(
  state: SocietyState,
  regionId: string,
  kind: string,
): string | undefined {
  let fallback: string | undefined;
  for (const [id, anchor] of state.anchors ?? []) {
    if (anchor.kind !== kind) continue;
    if (anchor.regionId === regionId) return id;
    fallback ??= id;
  }
  return fallback;
}

/** Everyone's current pose — the input to social gravity. */
function crowdPoses(state: SocietyState): CrowdPose[] {
  return state.agents.map((a) => ({
    regionId: a.regionId,
    x: a.x,
    y: a.y,
  }));
}

/** Latest witness place this observer wrote about `otherName`. */
function lastSeenPlaceOf(
  state: SocietyState,
  observerId: string,
  otherName: string,
): string | undefined {
  const rows = state.stream.list(observerId);
  for (let i = rows.length - 1; i >= 0; i--) {
    const place = placeFromWitnessText(rows[i]!.text, otherName);
    if (place) return place;
  }
  return undefined;
}

function regionForPlaceName(
  state: SocietyState,
  place: string,
): string | undefined {
  const needle = place.trim();
  if (!needle) return undefined;
  let fuzzy: string | undefined;
  for (const [id, a] of state.anchors ?? []) {
    const name = (a.name ?? '').trim();
    if (id === needle || name === needle) return a.regionId;
    if (
      !fuzzy &&
      name &&
      (name.includes(needle) || needle.includes(name))
    ) {
      fuzzy = a.regionId;
    }
  }
  return fuzzy;
}

/**
 * Park: go to where I last saw X, not only to the current crowd centroid.
 * Mentioned people already in this region are skipped.
 */
function lastSeenRegionFromMemories(
  state: SocietyState,
  agent: SocietyAgent,
  mentionedIds: ReadonlySet<string>,
): string | undefined {
  for (const id of mentionedIds) {
    const other = state.agents.find((a) => a.id === id);
    if (!other || other.regionId === agent.regionId) continue;
    const place = lastSeenPlaceOf(state, agent.id, other.name);
    if (!place) continue;
    const region = regionForPlaceName(state, place);
    if (region && region !== agent.regionId && isSocietyRegionId(state, region)) {
      return region;
    }
  }
  return undefined;
}

/** Names that recently showed up in this agent's memory — people they have in mind. */
function mentionedNearby(
  state: SocietyState,
  agentId: string,
  others: readonly AgentPose[],
  now: number,
): Set<string> {
  const recent = state.stream
    .list(agentId)
    .filter((m) => now - m.simTime <= 10 && m.kind !== 'reflection');
  const ids = new Set<string>();
  for (const o of others) {
    if (o.agentId === agentId) continue;
    if (recent.some((m) => m.text.includes(o.name))) ids.add(o.agentId);
  }
  return ids;
}

/** Fast-forward N hours. */
export async function runSocietyHours(
  state: SocietyState,
  hours: number,
  options: StepSocietyOptions = {},
): Promise<SocietyEvent[]> {
  const all: SocietyEvent[] = [];
  const steps = Math.max(1, Math.ceil(hours / (options.dtHours ?? 1)));
  for (let i = 0; i < steps; i++) {
    const batch = await stepSociety(state, options);
    all.push(...batch);
  }
  return all;
}

/** Invalidate events after simTime and truncate (for intervention recompute). */
export function truncateEventsAfter(
  state: SocietyState,
  fromSimTime: number,
): void {
  state.events = state.events.filter((e) => e.simTime < fromSimTime);
  state.simTime = fromSimTime;
}
