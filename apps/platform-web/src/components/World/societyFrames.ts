/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Backpressure for the `society-frame` SSE stream.
 */

/** Events a coalesced frame may carry before older ones are dropped. */
export const MAX_COALESCED_FRAME_EVENTS = 240;

export interface CoalescableFrame {
  readonly simTime: number;
  readonly events: ReadonlyArray<{
    readonly id: string;
    readonly simTime: number;
    readonly payload?: Record<string, unknown> | null;
  }>;
  readonly relations?: readonly unknown[];
  readonly objects?: readonly unknown[];
  readonly report?: unknown;
  readonly agents?: readonly unknown[];
  readonly retrievalDegraded?: boolean;
  readonly dialogueKind?: string;
  readonly llm?: boolean;
  readonly degraded?: boolean;
  readonly skipReason?: string;
  readonly talkBudget?: unknown;
}

export function mergeSocietyFrameReport(
  prev: unknown,
  next: unknown,
): unknown {
  if (!next) return prev;
  if (!prev || typeof prev !== 'object' || typeof next !== 'object') return next;
  const a = prev as Record<string, unknown>;
  const b = next as Record<string, unknown>;
  const prevSeed = a['seed'];
  const nextSeed = b['seed'];
  const seed =
    nextSeed && typeof nextSeed === 'object'
      ? {
          ...(typeof prevSeed === 'object' && prevSeed
            ? (prevSeed as Record<string, unknown>)
            : {}),
          ...(nextSeed as Record<string, unknown>),
        }
      : prevSeed ?? nextSeed;
  return seed != null ? { ...a, ...b, seed } : { ...a, ...b };
}

/**
 * Folds a burst of frames into one.
 *
 * Applying every SSE message straight into React meant a busy town (or a
 * reconnect that replays a backlog) could queue more commits than the browser
 * could retire. Dropping frames would drop dialogue, so scalar fields take the
 * newest value while events accumulate.
 *
 * Honesty tags (`retrievalDegraded`, `dialogueKind`) and `report.seed` must
 * survive a frame that omits them — otherwise the clock flickers to "all
 * clear" on reconnect.
 */
export function coalesceSocietyFrames<T extends CoalescableFrame>(
  prev: T | null,
  next: T,
): T {
  if (!prev) return next;
  const byId = new Map<string, T['events'][number]>();
  for (const e of prev.events) byId.set(e.id, e);
  for (const e of next.events) byId.set(e.id, e);
  const events = [...byId.values()]
    .sort((a, b) => {
      if (a.simTime !== b.simTime) return a.simTime - b.simTime;
      const sa = Number(a.payload?.['talkSeq']) || 0;
      const sb = Number(b.payload?.['talkSeq']) || 0;
      if (sa !== sb) return sa - sb;
      const ca = Number(a.payload?.['createdAtMs']) || 0;
      const cb = Number(b.payload?.['createdAtMs']) || 0;
      if (ca !== cb) return ca - cb;
      return String(a.id).localeCompare(String(b.id));
    })
    .slice(-MAX_COALESCED_FRAME_EVENTS);
  return {
    ...prev,
    ...next,
    simTime: Math.max(prev.simTime, next.simTime),
    events,
    relations: next.relations?.length ? next.relations : prev.relations,
    objects: next.objects?.length ? next.objects : prev.objects,
    agents: next.agents?.length ? next.agents : prev.agents,
    report: mergeSocietyFrameReport(prev.report, next.report),
    retrievalDegraded: next.retrievalDegraded ?? prev.retrievalDegraded,
    dialogueKind: next.dialogueKind ?? prev.dialogueKind,
    llm: next.llm ?? prev.llm,
    degraded: next.degraded ?? prev.degraded,
    skipReason: next.skipReason ?? prev.skipReason,
    talkBudget: next.talkBudget ?? prev.talkBudget,
  };
}
