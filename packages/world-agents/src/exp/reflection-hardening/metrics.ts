/**
 * Aware / Believe / Act / Emergence rates from caller-provided snapshots.
 * Never invents percentages — rates are null when denominators are zero / missing.
 * NOT merged into packages/world-agents/src/eval/metrics.ts.
 */

import type {
  AgentMemorySnapshot,
  EmergenceEventLike,
  MemoryEntryLike,
  PlanOrActEventLike,
} from './types';
import { simTimeNumber } from './types';

export interface AgentAwareBelieveInput {
  agentId: string;
  entries: MemoryEntryLike[];
  rumorFactKey: string;
  correctionFactKey?: string;
  /** If true, Believe requires reflection/belief kind only. */
  believeStrict?: boolean;
  /** Conflict rule: when both rumor and correction present, prefer latest reflection. */
  conflictRule?: 'prefer_latest_reflection' | 'rumor_wins' | 'correction_wins';
  agentKnowsFact?: (agentId: string, factKey: string) => boolean;
}

export interface LayerFlags {
  aware: boolean;
  believe: boolean;
}

function textOrKeysMatch(e: MemoryEntryLike, factKey: string): boolean {
  if ((e.factKeys ?? []).includes(factKey)) return true;
  if (!factKey) return false;
  return e.text.toLowerCase().includes(factKey.toLowerCase());
}

const TOM_BELIEF = /【信念】|believes that|believes other/i;

/**
 * Aware: any memory entry matching rumorFactKey (incl. hearsay observations).
 */
export function agentAware(
  entries: MemoryEntryLike[],
  rumorFactKey: string,
  opts?: { skipRolledBack?: boolean },
): boolean {
  for (const e of entries) {
    if (opts?.skipRolledBack && e.taintStatus === 'rolled_back') continue;
    if (e.quarantined && e.kind === 'reflection') continue;
    if (textOrKeysMatch(e, rumorFactKey)) return true;
  }
  return false;
}

function latestMatchingReflection(
  entries: MemoryEntryLike[],
  factKey: string,
): MemoryEntryLike | undefined {
  let best: MemoryEntryLike | undefined;
  let bestT = -Infinity;
  for (const e of entries) {
    if (e.kind !== 'reflection' && e.kind !== 'belief') continue;
    if (e.taintStatus === 'rolled_back' || e.quarantined) continue;
    if (!textOrKeysMatch(e, factKey)) continue;
    const t = simTimeNumber(e.simTime);
    if (t >= bestT) {
      bestT = t;
      best = e;
    }
  }
  return best;
}

/**
 * Believe: reflection/belief adopting rumor, ToM【信念】, or host agentKnowsFact.
 * With correctionFactKey + prefer_latest_reflection: if latest supporting
 * reflection is correction, Believe_rumor = false.
 */
export function agentBelieves(input: AgentAwareBelieveInput): boolean {
  const {
    agentId,
    entries,
    rumorFactKey,
    correctionFactKey,
    believeStrict,
    conflictRule = 'prefer_latest_reflection',
    agentKnowsFact,
  } = input;

  if (agentKnowsFact?.(agentId, rumorFactKey)) {
    if (correctionFactKey && agentKnowsFact(agentId, correctionFactKey)) {
      if (conflictRule === 'correction_wins') return false;
      if (conflictRule === 'rumor_wins') return true;
    } else {
      return true;
    }
  }

  if (correctionFactKey && conflictRule === 'prefer_latest_reflection') {
    const rumorRef = latestMatchingReflection(entries, rumorFactKey);
    const corrRef = latestMatchingReflection(entries, correctionFactKey);
    if (rumorRef && corrRef) {
      return simTimeNumber(rumorRef.simTime) > simTimeNumber(corrRef.simTime);
    }
    if (!rumorRef && corrRef) return false;
  }

  for (const e of entries) {
    if (e.taintStatus === 'rolled_back') continue;
    if (e.quarantined) continue;
    if (!textOrKeysMatch(e, rumorFactKey)) continue;
    if (e.kind === 'reflection' || e.kind === 'belief') return true;
    if (TOM_BELIEF.test(e.text)) return true;
    if (!believeStrict) {
      // Protocol default: observation-only ≠ Believe.
    }
  }
  return false;
}

export function layerFlagsForAgent(input: AgentAwareBelieveInput): LayerFlags {
  return {
    aware: agentAware(input.entries, input.rumorFactKey),
    believe: agentBelieves(input),
  };
}

export interface RateSnapshot {
  nAgents: number;
  awareCount: number;
  believeCount: number;
  actCount: number;
  emergenceRumorEvents: number;
  emergenceTotalEvents: number;
  awareRate: number | null;
  believeRate: number | null;
  actRate: number | null;
  /** null if no emergence events in window (do not coerce to 0). */
  emergenceRumorRate: number | null;
  conditionalActRate: number | null;
}

function safeDiv(num: number, den: number): number | null {
  return den <= 0 ? null : num / den;
}

export function computeRates(args: {
  nAgents: number;
  awareCount: number;
  believeCount: number;
  actCount: number;
  emergenceRumorEvents: number;
  emergenceTotalEvents: number;
  /** Act ∧ Believe count for conditional Act. */
  actAndBelieveCount?: number;
}): RateSnapshot {
  const { nAgents, awareCount, believeCount, actCount } = args;
  return {
    nAgents,
    awareCount,
    believeCount,
    actCount,
    emergenceRumorEvents: args.emergenceRumorEvents,
    emergenceTotalEvents: args.emergenceTotalEvents,
    awareRate: safeDiv(awareCount, nAgents),
    believeRate: safeDiv(believeCount, nAgents),
    actRate: safeDiv(actCount, nAgents),
    emergenceRumorRate: safeDiv(
      args.emergenceRumorEvents,
      args.emergenceTotalEvents,
    ),
    conditionalActRate: safeDiv(
      args.actAndBelieveCount ?? 0,
      believeCount,
    ),
  };
}

export function countActAgents(events: PlanOrActEventLike[]): number {
  const ids = new Set<string>();
  for (const ev of events) {
    if (ev.matchesRumorPattern) ids.add(ev.agentId);
  }
  return ids.size;
}

export function countEmergence(events: EmergenceEventLike[]): {
  rumorConsistent: number;
  total: number;
} {
  return {
    rumorConsistent: events.filter((e) => e.consistent_with_rumor).length,
    total: events.length,
  };
}

/**
 * Compute Aware/Believe/Act/Emergence rates from memory snapshots + plan diffs
 * + emergence events. Caller supplies raw data; this does not invent outcomes.
 */
export function computeLayerRatesFromSnapshots(args: {
  agentSnapshots: readonly AgentMemorySnapshot[];
  rumorFactKey: string;
  correctionFactKey?: string;
  planOrActEvents: readonly PlanOrActEventLike[];
  emergenceEvents: readonly EmergenceEventLike[];
  /** Optional: only count Act if agent currently Believes. */
  requireBelieveForAct?: boolean;
  believeStrict?: boolean;
  agentKnowsFact?: (agentId: string, factKey: string) => boolean;
}): RateSnapshot {
  const nAgents = args.agentSnapshots.length;
  let awareCount = 0;
  let believeCount = 0;
  const believeIds = new Set<string>();

  for (const snap of args.agentSnapshots) {
    const flags = layerFlagsForAgent({
      agentId: snap.agentId,
      entries: snap.entries,
      rumorFactKey: args.rumorFactKey,
      correctionFactKey: args.correctionFactKey,
      believeStrict: args.believeStrict,
      agentKnowsFact: args.agentKnowsFact,
    });
    if (flags.aware) awareCount += 1;
    if (flags.believe) {
      believeCount += 1;
      believeIds.add(snap.agentId);
    }
  }

  const actIds = new Set<string>();
  for (const ev of args.planOrActEvents) {
    if (!ev.matchesRumorPattern) continue;
    if (args.requireBelieveForAct && !believeIds.has(ev.agentId)) continue;
    actIds.add(ev.agentId);
  }

  let actAndBelieve = 0;
  for (const id of actIds) {
    if (believeIds.has(id)) actAndBelieve += 1;
  }

  const emerg = countEmergence([...args.emergenceEvents]);

  return computeRates({
    nAgents,
    awareCount,
    believeCount,
    actCount: actIds.size,
    emergenceRumorEvents: emerg.rumorConsistent,
    emergenceTotalEvents: emerg.total,
    actAndBelieveCount: actAndBelieve,
  });
}

/**
 * Believe residual half-life from a time series of believe rates after t_correct.
 * Returns social-time delta to first bucket where rate <= half of rate at t0,
 * or Number.POSITIVE_INFINITY if never halves (report as "inf" in logs).
 *
 * series must be sorted by simTime ascending; values are rates in [0,1] or null.
 */
export function believeHalfLife(args: {
  series: ReadonlyArray<{ simTime: number | string; believeRate: number | null }>;
  tCorrect: number | string;
}): number {
  const t0 = simTimeNumber(args.tCorrect);
  const post = args.series
    .map((p) => ({ t: simTimeNumber(p.simTime), rate: p.believeRate }))
    .filter((p) => p.t >= t0 && p.rate !== null && Number.isFinite(p.rate!))
    .sort((a, b) => a.t - b.t) as Array<{ t: number; rate: number }>;

  if (post.length === 0) return Number.POSITIVE_INFINITY;

  const baseline = post[0]!.rate;
  if (baseline <= 0) return 0;
  const target = baseline / 2;

  for (const p of post) {
    if (p.rate <= target) return p.t - t0;
  }
  return Number.POSITIVE_INFINITY;
}

/** Encode half-life for JSONL (inf → "inf"). */
export function formatHalfLife(hl: number): number | 'inf' {
  return Number.isFinite(hl) ? hl : 'inf';
}

export function countTaintedReflections(
  entries: readonly MemoryEntryLike[],
): number {
  return entries.filter(
    (e) =>
      e.kind === 'reflection' &&
      (e.taintStatus === 'tainted' ||
        e.taintStatus === 'rolled_back' ||
        e.quarantined),
  ).length;
}

/**
 * Build a metric_snapshot log object — values may be null when unknown.
 * Never invent percentages.
 */
export function metricSnapshotLog(args: {
  sim_time: number | string;
  arm_id: string;
  rates: RateSnapshot | null;
  tainted_reflection_count?: number | null;
  gate_block_rate?: number | null;
  reinfection_rate?: number | null;
  believe_half_life?: number | 'inf' | null;
}): Record<string, unknown> {
  const r = args.rates;
  return {
    type: 'metric_snapshot',
    sim_time: args.sim_time,
    arm_id: args.arm_id,
    aware_rate: r?.awareRate ?? null,
    believe_rate: r?.believeRate ?? null,
    act_rate: r?.actRate ?? null,
    emergence_rumor_rate: r?.emergenceRumorRate ?? null,
    conditional_act_rate: r?.conditionalActRate ?? null,
    tainted_reflection_count: args.tainted_reflection_count ?? null,
    gate_block_rate: args.gate_block_rate ?? null,
    reinfection_rate: args.reinfection_rate ?? null,
    believe_half_life: args.believe_half_life ?? null,
  };
}
