/**
 * TaintedReflectionRollback — mark / quarantine / filter retrieval / re-reflect hook.
 * Trigger at correction campaign (t_correct).
 * NOT merged into OpenGame.
 */

import type {
  MemoryEntryLike,
  MemoryStreamLike,
  QuarantineInput,
  QuarantineResult,
  QuarantineMode,
  ReReflectHook,
  RereflectInput,
  RollbackResult,
  ScheduleReReflectRequest,
  TaintMarkInput,
  TaintMarkResult,
  TaintedReflectionRollback,
} from './types';
import { entryPointers, listAgentEntries } from './types';

function matchesRumor(e: MemoryEntryLike, rumorFactKeys: string[]): boolean {
  if (rumorFactKeys.length === 0) return false;
  const keys = e.factKeys ?? [];
  if (keys.some((k) => rumorFactKeys.includes(k))) return true;
  const text = e.text.toLowerCase();
  return rumorFactKeys.some((k) => text.includes(k.toLowerCase()));
}

/**
 * Walk reflection pointer trees: any reflection whose pointers intersect
 * seed/suspect/tainted ids, or whose text/factKeys match rumorFactKeys,
 * plus transitive closure through reflection→reflection pointers.
 */
export function findTaintedReflections(
  entries: readonly MemoryEntryLike[],
  seedObservationIds: readonly string[],
  rumorFactKeys: readonly string[],
): { taintedReflectionIds: string[]; suspectObservationIds: string[] } {
  const seed = new Set(seedObservationIds);
  const rumorKeys = [...rumorFactKeys];

  const suspectObservationIds = entries
    .filter(
      (e) =>
        e.kind === 'observation' &&
        (seed.has(e.id) || matchesRumor(e, rumorKeys)),
    )
    .map((e) => e.id);

  const suspectSet = new Set(suspectObservationIds);
  const tainted = new Set<string>();

  let changed = true;
  while (changed) {
    changed = false;
    for (const e of entries) {
      if (e.kind !== 'reflection') continue;
      if (tainted.has(e.id)) continue;
      const ptr = entryPointers(e);
      const hitSeed = ptr.some(
        (id) => seed.has(id) || suspectSet.has(id) || tainted.has(id),
      );
      const hitKey = matchesRumor(e, rumorKeys);
      if (hitSeed || hitKey) {
        tainted.add(e.id);
        changed = true;
      }
    }
  }

  return {
    taintedReflectionIds: [...tainted],
    suspectObservationIds,
  };
}

/**
 * Filter retrieval set: exclude quarantined / tainted / rolled_back reflections
 * when mode is exclude_from_retrieval; soft_downweight keeps them but callers
 * should prefer the returned list after importance floor.
 */
export function filterRetrieval(
  entries: readonly MemoryEntryLike[],
  opts?: { mode?: QuarantineMode; softWeightFloor?: number },
): MemoryEntryLike[] {
  const mode = opts?.mode ?? 'exclude_from_retrieval';
  const floor = opts?.softWeightFloor ?? 1;

  if (mode === 'exclude_from_retrieval') {
    return entries.filter((e) => {
      if (e.quarantined) return false;
      if (e.taintStatus === 'tainted' || e.taintStatus === 'rolled_back') {
        return e.kind !== 'reflection';
      }
      return true;
    });
  }

  // soft_downweight: keep entries but clamp importance on tainted reflections
  return entries.map((e) => {
    if (
      e.kind === 'reflection' &&
      (e.quarantined ||
        e.taintStatus === 'tainted' ||
        e.taintStatus === 'rolled_back')
    ) {
      return { ...e, importance: Math.min(e.importance, floor) };
    }
    return e;
  });
}

export class DefaultTaintedReflectionRollback
  implements TaintedReflectionRollback
{
  private scheduled: ScheduleReReflectRequest[] = [];
  private reReflectHook: ReReflectHook | null = null;

  /** Host wires real maybeReflect via this setter or per-call reReflectHook. */
  setReReflectHook(hook: ReReflectHook | null): void {
    this.reReflectHook = hook;
  }

  async markTainted(input: TaintMarkInput): Promise<TaintMarkResult> {
    const entries = listAgentEntries(input.stream, input.agentId);
    const result = findTaintedReflections(
      entries,
      input.seedObservationIds ?? [],
      input.rumorFactKeys ?? [],
    );

    for (const e of entries) {
      if (result.taintedReflectionIds.includes(e.id)) {
        e.taintStatus = 'tainted';
      } else if (result.suspectObservationIds.includes(e.id)) {
        e.taintStatus = e.taintStatus ?? 'suspect';
      }
    }

    return result;
  }

  async quarantine(input: QuarantineInput): Promise<QuarantineResult> {
    const idSet = new Set(input.taintedReflectionIds);
    const quarantinedIds: string[] = [];
    let quarantinedEdgeCount = 0;
    const entries = listAgentEntries(input.stream, input.agentId);

    for (const e of entries) {
      if (!idSet.has(e.id)) continue;
      e.quarantined = true;
      e.taintStatus = 'tainted';
      quarantinedIds.push(e.id);
      quarantinedEdgeCount += 1 + entryPointers(e).length;
      if (input.quarantineMode === 'soft_downweight') {
        e.importance = Math.min(e.importance, 1);
      }
    }

    return { quarantinedIds, quarantinedEdgeCount };
  }

  filterForRetrieval(
    entries: readonly MemoryEntryLike[],
    opts?: { mode?: QuarantineMode; softWeightFloor?: number },
  ): MemoryEntryLike[] {
    return filterRetrieval(entries, opts);
  }

  async rereflectClean(input: RereflectInput): Promise<MemoryEntryLike[]> {
    const exclude = new Set(input.excludeIds);
    const usable = this.filterForRetrieval(
      listAgentEntries(input.stream, input.agentId).filter(
        (e) => !exclude.has(e.id),
      ),
      { mode: 'exclude_from_retrieval' },
    );

    const force = new Set(input.forceIncludeIds ?? []);
    const forced = listAgentEntries(input.stream, input.agentId).filter((e) =>
      force.has(e.id),
    );
    const evidencePool = [...usable];
    for (const f of forced) {
      if (!evidencePool.some((e) => e.id === f.id)) evidencePool.push(f);
    }

    if (this.reReflectHook) {
      const written = await this.reReflectHook({
        ...input,
        // Host should retrieve only from evidencePool / excludeIds.
      });
      for (const r of written) {
        r.taintStatus = 'clean';
        r.gateDecision = r.gateDecision ?? 'n/a';
        if (matchesRumor(r, [])) {
          /* no-op */
        }
      }
      return written;
    }

    // No hook: schedule for host tick and return empty (not silent success).
    this.scheduleReReflect({
      agentId: input.agentId,
      agentName: input.agentName,
      nowSimTime: input.nowSimTime,
      sinceSimTime: input.sinceSimTime,
      excludeIds: input.excludeIds,
      forceIncludeIds: input.forceIncludeIds,
      reason: 'rereflect_pending_wire_maybeReflect',
    });
    void evidencePool;
    return [];
  }

  scheduleReReflect(req: ScheduleReReflectRequest): void {
    this.scheduled.push({ ...req, excludeIds: [...req.excludeIds] });
  }

  drainScheduledReReflects(): ScheduleReReflectRequest[] {
    const out = this.scheduled;
    this.scheduled = [];
    return out;
  }

  async runAtCorrection(input: {
    stream: MemoryStreamLike;
    agentId: string;
    agentName: string;
    nowSimTime: number | string;
    sinceSimTime: number | string;
    idFactory: () => string;
    llm?: RereflectInput['llm'];
    rumorFactKeys: string[];
    seedObservationIds?: string[];
    quarantineMode?: QuarantineMode;
    reReflectHook?: ReReflectHook;
  }): Promise<RollbackResult> {
    if (input.reReflectHook) {
      this.setReReflectHook(input.reReflectHook);
    }

    const taint = await this.markTainted({
      stream: input.stream,
      agentId: input.agentId,
      seedObservationIds: input.seedObservationIds,
      rumorFactKeys: input.rumorFactKeys,
      nowSimTime: input.nowSimTime,
    });

    const quarantine = await this.quarantine({
      stream: input.stream,
      agentId: input.agentId,
      taintedReflectionIds: taint.taintedReflectionIds,
      quarantineMode: input.quarantineMode ?? 'exclude_from_retrieval',
    });

    for (const e of listAgentEntries(input.stream, input.agentId)) {
      if (taint.taintedReflectionIds.includes(e.id)) {
        e.taintStatus = 'rolled_back';
      }
    }

    const beforeScheduled = this.scheduled.length;
    const newReflections = await this.rereflectClean({
      stream: input.stream,
      agentId: input.agentId,
      agentName: input.agentName,
      nowSimTime: input.nowSimTime,
      sinceSimTime: input.sinceSimTime,
      idFactory: input.idFactory,
      llm: input.llm,
      excludeIds: taint.taintedReflectionIds,
      threshold: 150,
    });

    const scheduled =
      newReflections.length === 0 && this.scheduled.length > beforeScheduled;

    for (const r of newReflections) {
      r.taintStatus = 'clean';
      // If new reflection still matches rumor keys, mark suspect for 2nd pass.
      if (matchesRumor(r, input.rumorFactKeys)) {
        r.taintStatus = 'suspect';
      }
    }

    return {
      taint,
      quarantine,
      newReflectionIds: newReflections.map((r) => r.id),
      success: true,
      reason: scheduled
        ? 'rereflect_scheduled_pending_wire'
        : newReflections.length === 0 && taint.taintedReflectionIds.length === 0
          ? 'nothing_to_rollback'
          : undefined,
      rereflectScheduled: scheduled,
    };
  }
}

export function createDefaultRollback(
  hook?: ReReflectHook,
): TaintedReflectionRollback {
  const rb = new DefaultTaintedReflectionRollback();
  if (hook) rb.setReReflectHook(hook);
  return rb;
}
