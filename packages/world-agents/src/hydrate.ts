/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Overlay persisted agents/memories/plans onto a Spec-seeded SocietyState.
 */

import { createMemoryEntry, MemoryStream } from './memory.js';
import { normalizeNeeds } from './needs.js';
import type { DayPlan } from './plan.js';
import { parseRelation } from './relations.js';
import type { SocietyState } from './tick.js';
import { restoreTalkSeqFromEvents } from './talkOrder.js';
import {
  isRumorMemoryText,
  isWhisperMemoryText,
  RUMOR_PREFIX_ZH,
  WHISPER_PREFIX_ZH,
} from './copyLocale.js';

export interface PersistedSocietyAgent {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly regionId: string;
  readonly currentAction?: string;
  readonly identitySummary?: string;
  readonly name?: string;
  readonly needs?: Record<string, number>;
}

export interface PersistedSocietyMemory {
  readonly id: string;
  readonly agentId: string;
  readonly kind: string;
  readonly text: string;
  readonly simTime: number;
  readonly importance: number;
  readonly embedding?: number[] | null;
  readonly pointers?: string[];
}

export interface PersistedSocietyPlan {
  readonly agentKey: string;
  readonly dayIndex: number;
  readonly segments: unknown;
}

export interface PersistedSocietyRelation {
  readonly from: string;
  readonly to: string;
  readonly summary: string;
  readonly affinity: number;
}

export interface PersistedSocietySnapshot {
  readonly simTime?: number;
  readonly agents?: readonly PersistedSocietyAgent[];
  readonly memories?: readonly PersistedSocietyMemory[];
  readonly plans?: readonly PersistedSocietyPlan[];
  readonly relations?: readonly PersistedSocietyRelation[];
  /** Pair key `a|b` → last dialogue simTime (restores talk cooldown across ticks). */
  readonly lastConverseAt?: ReadonlyArray<readonly [string, number]>;
  /** Replay events used to restore monotone `talkSeq`. */
  readonly events?: ReadonlyArray<{ payload?: Record<string, unknown> | null }>;
}

/**
 * True when `id` is a real map region. Place ids like `forge` must not become
 * `regionId` or the sprite vanishes from every map tab.
 */
export function isSocietyRegionId(
  state: Pick<SocietyState, 'regionBounds' | 'anchors'>,
  id: string,
): boolean {
  if (!id) return false;
  const hasBounds = Boolean(state.regionBounds && state.regionBounds.size > 0);
  const hasAnchors = Boolean(state.anchors && state.anchors.size > 0);
  if (!hasBounds && !hasAnchors) return true;
  if (state.regionBounds?.has(id)) return true;
  if (state.anchors) {
    for (const a of state.anchors.values()) {
      if (a.regionId === id) return true;
    }
  }
  return false;
}

/** Replay the latest walk destination onto poses (no extra table). */
export function applyGoalFromEvents(
  agents: Array<{
    id: string;
    goalX?: number;
    goalY?: number;
    goalPlace?: string;
    goalReason?: string;
    drive?: string;
  }>,
  events: ReadonlyArray<{
    kind: string;
    simTime?: number;
    agentId?: string | null;
    payload?: Record<string, unknown>;
  }>,
): void {
  const latest = new Map<
    string,
    {
      simTime: number;
      goalX?: number;
      goalY?: number;
      goalPlace?: string;
      goalReason?: string;
      drive?: string;
    }
  >();
  for (const e of events) {
    if (e.kind !== 'action' && e.kind !== 'move') continue;
    const id = e.agentId;
    if (!id) continue;
    const p = e.payload ?? {};
    const goalX = typeof p['goalX'] === 'number' ? Number(p['goalX']) : undefined;
    const goalY = typeof p['goalY'] === 'number' ? Number(p['goalY']) : undefined;
    const goalPlace =
      typeof p['goalPlace'] === 'string' ? String(p['goalPlace']) : undefined;
    const goalReason =
      typeof p['goalReason'] === 'string' ? String(p['goalReason']) : undefined;
    const driveRaw = p['drive'];
    const drive =
      typeof driveRaw === 'string'
        ? driveRaw
        : driveRaw &&
            typeof driveRaw === 'object' &&
            typeof (driveRaw as { kind?: unknown }).kind === 'string'
          ? String((driveRaw as { kind: string }).kind)
          : undefined;
    if (goalX == null && goalY == null && !goalPlace && !goalReason) continue;
    const simTime = typeof e.simTime === 'number' ? e.simTime : 0;
    const prev = latest.get(id);
    if (prev && prev.simTime > simTime) continue;
    latest.set(id, { simTime, goalX, goalY, goalPlace, goalReason, drive });
  }
  if (!latest.size) return;
  for (const a of agents) {
    const g = latest.get(a.id);
    if (!g) continue;
    if (g.goalX != null) a.goalX = g.goalX;
    if (g.goalY != null) a.goalY = g.goalY;
    if (g.goalPlace) a.goalPlace = g.goalPlace;
    if (g.goalReason) a.goalReason = g.goalReason;
    if (g.drive) a.drive = g.drive;
  }
}

function finiteCoord(n: number, fallback: number): number {
  return Number.isFinite(n) ? n : fallback;
}

/** Replace live poses/memory/plans with a DB checkpoint (keeps Spec anchors). */
export function overlayPersistedSociety(
  state: SocietyState,
  snap: PersistedSocietySnapshot,
): SocietyState {
  if (typeof snap.simTime === 'number' && Number.isFinite(snap.simTime)) {
    state.simTime = snap.simTime;
  }
  for (const a of snap.agents ?? []) {
    const cur = state.agents.find((x) => x.id === a.id);
    if (!cur) continue;
    cur.x = finiteCoord(a.x, cur.x);
    cur.y = finiteCoord(a.y, cur.y);
    if (a.regionId && isSocietyRegionId(state, a.regionId)) {
      cur.regionId = a.regionId;
    }
    if (a.currentAction) cur.currentAction = a.currentAction;
    // Without this, drives reset on every live hydrate and never interrupt.
    if (a.needs) cur.needs = normalizeNeeds(a.needs);
  }
  if (snap.memories && snap.memories.length > 0) {
    const entries = snap.memories.map((m) =>
      createMemoryEntry({
        id: m.id,
        agentId: m.agentId,
        kind: m.kind as 'observation' | 'reflection' | 'plan' | 'dialogue',
        text: m.text,
        simTime: m.simTime,
        importance: m.importance,
        embedding: m.embedding ?? undefined,
        pointers: m.pointers,
      }),
    );
    state.stream = MemoryStream.fromJSON(entries);
  }
  if (snap.plans) {
    state.plans.clear();
    for (const p of snap.plans) {
      if (!Array.isArray(p.segments)) continue;
      state.plans.set(p.agentKey, {
        agentId: p.agentKey,
        dayIndex: p.dayIndex,
        segments: p.segments as DayPlan['segments'],
      });
    }
  }
  if (snap.relations && snap.relations.length > 0) {
    state.relations.clear();
    for (const r of snap.relations) {
      const key = [r.from, r.to].sort().join('|');
      state.relations.set(key, parseRelation(r.summary, r.affinity));
    }
  }
  if (snap.lastConverseAt) {
    state.lastConverseAt = new Map(snap.lastConverseAt);
  }
  if (snap.events?.length) {
    restoreTalkSeqFromEvents(state, snap.events);
  }
  return state;
}

/** Fold extra DB rows into the live stream without wiping what is already there. */
export function mergePersistedMemories(
  state: SocietyState,
  memories: readonly PersistedSocietyMemory[],
): void {
  for (const m of memories) {
    if (!m.id || !m.agentId) continue;
    if (state.stream.get(m.agentId, m.id)) continue;
    state.stream.add(
      createMemoryEntry({
        id: m.id,
        agentId: m.agentId,
        kind: m.kind as 'observation' | 'reflection' | 'plan' | 'dialogue',
        text: m.text,
        simTime: m.simTime,
        importance: m.importance,
        embedding: m.embedding ?? undefined,
        pointers: m.pointers,
      }),
    );
  }
}

/** Rebuild talk-cooldown map from dialogue events (`payload.with`). */
export function lastConverseAtFromEvents(
  events: ReadonlyArray<{
    kind: string;
    simTime: number;
    agentId?: string | null;
    payload?: Record<string, unknown>;
  }>,
): Array<[string, number]> {
  const map = new Map<string, number>();
  for (const e of events) {
    if (e.kind !== 'dialogue' || !e.agentId) continue;
    // A failed beat is persisted as a visible marker, not as a conversation.
    // Counting it here would hand the pair a fresh cooldown on rehydrate and
    // the queued retry would never fire.
    if (e.payload?.['skipped'] === true) continue;
    const other = e.payload?.['with'];
    if (typeof other !== 'string' || !other) continue;
    const key = [e.agentId, other].sort().join('|');
    const prev = map.get(key) ?? -Infinity;
    if (e.simTime >= prev) map.set(key, e.simTime);
  }
  return [...map.entries()];
}

export const WHISPER_MEMORY_PREFIX = WHISPER_PREFIX_ZH;
export const RUMOR_MEMORY_PREFIX = RUMOR_PREFIX_ZH;

export function isRumorOrWhisperText(text: string): boolean {
  if (text.startsWith('【')) return false;
  return (
    isWhisperMemoryText(text) ||
    isRumorMemoryText(text) ||
    /办聚会|组织一场聚会|组织交班|召集晚课|把话传开|valentine party|hosting a gathering|calling vespers|organizing a watch handoff|meet at/i.test(
      text,
    )
  );
}

export function recentRumorText(
  memories: ReadonlyArray<{ text: string; simTime: number }>,
  now: number,
  withinHours = 24,
): string | undefined {
  const hit = [...memories]
    .filter((m) => {
      if (!isRumorOrWhisperText(m.text)) return false;
      const window = isWhisperMemoryText(m.text) ? 3 : withinHours;
      return now - m.simTime <= window;
    })
    .sort((a, b) => b.simTime - a.simTime)[0];
  return hit?.text;
}

/**
 * How long a whisper or town rumor keeps steering talk and walking.
 * Long enough that news from this viewing session is still what people
 * are reacting to, then it fades back into ordinary memory.
 */
export const FRESH_TRACE_H = 240;

/** Newest rumor or whisper still inside the reaction window. */
export function freshTraceText(
  memories: ReadonlyArray<{ text: string; simTime: number }>,
  now: number,
  withinHours = FRESH_TRACE_H,
): { readonly text: string; readonly simTime: number } | undefined {
  const hit = [...memories]
    .filter(
      (m) =>
        isRumorOrWhisperText(m.text) && now - m.simTime <= withinHours,
    )
    .sort((a, b) => b.simTime - a.simTime)[0];
  return hit ? { text: hit.text, simTime: hit.simTime } : undefined;
}

/**
 * A live whisper should spark talk on the next ticks — drop cooldown once
 * per new whisper/rumor memory (not on every live hydrate).
 */
export function clearTalkCooldownAfterWhispers(
  state: SocietyState,
  withinHours = 3,
): void {
  if (!state.lastConverseAt?.size) return;
  let newest = -Infinity;
  const sparked = new Set<string>();
  for (const a of state.agents) {
    for (const m of state.stream.list(a.id)) {
      if (!isRumorOrWhisperText(m.text)) continue;
      if (state.simTime - m.simTime > withinHours) continue;
      sparked.add(a.id);
      if (m.simTime > newest) newest = m.simTime;
    }
  }
  if (!sparked.size) return;
  const last = state.lastWhisperClearedAt ?? Number.NEGATIVE_INFINITY;
  if (newest <= last) return;
  for (const key of [...state.lastConverseAt.keys()]) {
    const [x, y] = key.split('|');
    if ((x && sparked.has(x)) || (y && sparked.has(y))) {
      state.lastConverseAt.delete(key);
    }
  }
  state.lastWhisperClearedAt = newest;
}
