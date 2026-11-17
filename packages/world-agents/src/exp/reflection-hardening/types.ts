/**
 * Candidate-1 scaffold types — drop-in ready, NOT merged into OpenGame world-agents.
 * Aligns with reflect.ts maybeReflect + 02_实验协议.md logging schema.
 * OpenGame MemoryEntry uses `pointers`; protocol draft uses `pointerIds` — both accepted.
 */

export type ArmId = 'A0' | 'A1' | 'A2';

export type MemoryKind = 'observation' | 'reflection' | 'belief' | string;

export type TaintStatus = 'clean' | 'suspect' | 'tainted' | 'rolled_back';

export type GateDecision = 'pass' | 'block' | 'n/a';

export type SeedChannel =
  | 'observation_direct'
  | 'paidInfluence_once'
  | 'converse_scripted_once';

export type QuarantineMode = 'exclude_from_retrieval' | 'soft_downweight';

/** Minimal mirror of OpenGame MemoryEntry + optional experiment extensions. */
export interface MemoryEntryLike {
  id: string;
  agentId: string;
  kind: MemoryKind;
  text: string;
  importance: number;
  simTime: number | string;
  /** OpenGame field name (reflect.ts createMemoryEntry). */
  pointers?: string[];
  /** Protocol draft alias — prefer pointers when both present. */
  pointerIds?: string[];
  factKeys?: string[];
  taintStatus?: TaintStatus;
  gateDecision?: GateDecision;
  quarantined?: boolean;
}

/** Resolve evidence pointer ids from either OpenGame or protocol field. */
export function entryPointers(e: MemoryEntryLike): string[] {
  if (e.pointers?.length) return e.pointers;
  if (e.pointerIds?.length) return e.pointerIds;
  return [];
}

export function simTimeNumber(t: number | string): number {
  if (typeof t === 'number' && Number.isFinite(t)) return t;
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
}

/** Subset of maybeReflect args needed by gate/rollback. */
export interface MaybeReflectArgsLike {
  stream: MemoryStreamLike;
  agentId: string;
  agentName: string;
  nowSimTime: number | string;
  sinceSimTime: number | string;
  threshold?: number;
  idFactory: () => string;
  llm?: LlmTextFnLike;
}

export type LlmTextFnLike = (prompt: string) => Promise<string>;

/**
 * Stream adapter: OpenGame MemoryStream has list(agentId)/add/get;
 * scaffold accepts either that shape or a flat `entries` array for unit tests.
 */
export interface MemoryStreamLike {
  entries?: MemoryEntryLike[];
  list?(agentId: string): MemoryEntryLike[];
  get?(agentId: string, id: string): MemoryEntryLike | undefined;
  add?(entry: MemoryEntryLike): void;
  recentImportanceSum?(agentId: string, sinceSimTime: number): number;
}

export function listAgentEntries(
  stream: MemoryStreamLike,
  agentId: string,
): MemoryEntryLike[] {
  if (typeof stream.list === 'function') {
    return [...stream.list(agentId)];
  }
  return (stream.entries ?? []).filter((e) => e.agentId === agentId);
}

export function allEntries(stream: MemoryStreamLike): MemoryEntryLike[] {
  if (stream.entries) return stream.entries;
  // OpenGame stream without flat entries: host must pass entries or list.
  return [];
}

export interface GateContext {
  agentId: string;
  agentName: string;
  nowSimTime: number | string;
  stream: MemoryStreamLike;
  candidateEvidence: MemoryEntryLike[];
  trackedFactKeys?: string[];
  /** Correction / ground-truth anchors (observations or system facts). */
  trustedAnchors?: MemoryEntryLike[];
  /** Independent-source minimum before allowing reflection upgrade. Default 2. */
  minIndependentSources?: number;
  /** Explicit rumor ↔ correction contradiction pairs (optional). */
  contradictionPairs?: ReadonlyArray<{
    rumorKey: string;
    correctionKey: string;
  }>;
  /** Gate rule version for run_config reproducibility. */
  gateRuleVersion?: string;
}

export interface GateResult {
  decision: 'pass' | 'block';
  /** Convenience alias: true iff decision === 'pass'. */
  allowUpgrade: boolean;
  reason: string;
  /** Human-readable / machine reasons accumulated during evaluate. */
  reasons: string[];
  conflictingIds?: string[];
  suspectFactKeys?: string[];
  diagnostics?: Record<string, unknown>;
}

export interface ReflectionGate {
  evaluate(ctx: GateContext): Promise<GateResult>;
}

export interface TaintMarkInput {
  stream: MemoryStreamLike;
  agentId: string;
  seedObservationIds?: string[];
  rumorFactKeys?: string[];
  nowSimTime: number | string;
}

export interface TaintMarkResult {
  taintedReflectionIds: string[];
  suspectObservationIds: string[];
}

export interface QuarantineInput {
  stream: MemoryStreamLike;
  agentId: string;
  taintedReflectionIds: string[];
  quarantineMode: QuarantineMode;
}

export interface QuarantineResult {
  quarantinedIds: string[];
  quarantinedEdgeCount: number;
}

export interface RereflectInput {
  stream: MemoryStreamLike;
  agentId: string;
  agentName: string;
  nowSimTime: number | string;
  sinceSimTime: number | string;
  idFactory: () => string;
  llm?: LlmTextFnLike;
  excludeIds: string[];
  forceIncludeIds?: string[];
  threshold?: number;
}

export interface RollbackResult {
  taint: TaintMarkResult;
  quarantine: QuarantineResult;
  newReflectionIds: string[];
  success: boolean;
  reason?: string;
  /** True when re-reflect was only scheduled, not executed in-process. */
  rereflectScheduled?: boolean;
}

/** Host implements this to call real maybeReflect on a filtered stream. */
export type ReReflectHook = (
  input: RereflectInput,
) => Promise<MemoryEntryLike[]>;

export interface ScheduleReReflectRequest {
  agentId: string;
  agentName: string;
  nowSimTime: number | string;
  sinceSimTime: number | string;
  excludeIds: string[];
  forceIncludeIds?: string[];
  reason: string;
}

export interface TaintedReflectionRollback {
  markTainted(input: TaintMarkInput): Promise<TaintMarkResult>;
  quarantine(input: QuarantineInput): Promise<QuarantineResult>;
  /** Filter memories eligible for retrieval / dialogue outbound. */
  filterForRetrieval(
    entries: readonly MemoryEntryLike[],
    opts?: { mode?: QuarantineMode; softWeightFloor?: number },
  ): MemoryEntryLike[];
  rereflectClean(input: RereflectInput): Promise<MemoryEntryLike[]>;
  /** Queue a re-reflect for the host tick (when hook not set). */
  scheduleReReflect(req: ScheduleReReflectRequest): void;
  drainScheduledReReflects(): ScheduleReReflectRequest[];
  runAtCorrection(input: {
    stream: MemoryStreamLike;
    agentId: string;
    agentName: string;
    nowSimTime: number | string;
    sinceSimTime: number | string;
    idFactory: () => string;
    llm?: LlmTextFnLike;
    rumorFactKeys: string[];
    seedObservationIds?: string[];
    quarantineMode?: QuarantineMode;
    /** If provided, called instead of empty stub. */
    reReflectHook?: ReReflectHook;
  }): Promise<RollbackResult>;
}

/** Experiment arm flags — see conditions.ts ArmConfig. */
export interface ExperimentFlags {
  armId: ArmId;
  reflectEnabled: boolean;
  gateEnabled: boolean;
  rollbackEnabled: boolean;
  reflectThreshold: number;
  minIndependentSources: number;
  trackedFactKeys: string[];
  forceSeedRespectsGate: boolean;
  gateRuleVersion: string;
}

/** Alias used in protocol docs. */
export type ArmConfig = ExperimentFlags;

/** run_config fields from 02_实验协议.md §6.1 (no fabricated metrics). */
export interface RunConfig {
  experiment_id: 'candidate1-reflection-hardening';
  arm_id: ArmId;
  rumorFactKey: string;
  correctionFactKey: string;
  t_seed: number | string;
  t_correct: number | string;
  t_end: number | string;
  n_agents: number;
  seed_agent_ids: string[];
  corrector_agent_ids: string[];
  seed_channel: SeedChannel;
  reflect_threshold: number;
  gate_enabled: boolean;
  rollback_enabled: boolean;
  believe_metric_mode: 'end_snapshot' | 'window_mean';
  tau_B: number | null;
  tau_A: number | null;
  tau_E: number | null;
  llm_model: string;
  code_git_sha: string;
  protocol_version: string;
  gate_rule_version?: string;
  min_independent_sources?: number;
}

/** Plan / action log line for Act metrics. */
export interface PlanOrActEventLike {
  agentId: string;
  simTime?: number | string;
  matchesRumorPattern: boolean;
  patternId?: string;
  actionOrPlanId?: string;
  /** Optional: plan text / activity for host-side pattern match. */
  text?: string;
}

/** Emergence event with rumor-consistency tag (protocol §6.6). */
export interface EmergenceEventLike {
  simTime?: number | string;
  participantIds?: string[];
  metricName?: string;
  consistent_with_rumor: boolean;
}

/** One agent's memory snapshot at a sim-time bucket. */
export interface AgentMemorySnapshot {
  agentId: string;
  entries: MemoryEntryLike[];
}
