/**
 * Conceptual eval pipeline orchestrator for Candidate-1.
 * Does NOT run a town sim. Throws if callers expect measured results without
 * wiring maybeReflect / correction campaign on the host OpenGame tree.
 * NOT merged into OpenGame.
 */

import { createDefaultGate } from './gate';
import { flagsForArm, shouldEvaluateGate, shouldRunMaybeReflect, shouldRunRollback } from './conditions';
import { createDefaultRollback } from './rollback';
import {
  computeLayerRatesFromSnapshots,
  metricSnapshotLog,
} from './metrics';
import type {
  AgentMemorySnapshot,
  ArmId,
  EmergenceEventLike,
  ExperimentFlags,
  GateResult,
  MemoryEntryLike,
  MemoryStreamLike,
  PlanOrActEventLike,
  ReflectionGate,
  RollbackResult,
  RunConfig,
  TaintedReflectionRollback,
} from './types';
import { listAgentEntries } from './types';

export class NotWiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotWiredError';
  }
}

export interface EvalRunnerOptions {
  armId: ArmId;
  runConfig: RunConfig;
  gate?: ReflectionGate;
  rollback?: TaintedReflectionRollback;
  flags?: ExperimentFlags;
}

export interface ReflectAttemptLog {
  type: 'reflect_attempt';
  sim_time: number | string;
  agent_id: string;
  recent_importance_sum: number | null;
  threshold: number;
  candidate_evidence_ids: string[];
  gate_enabled: boolean;
  gate_decision: 'pass' | 'block' | 'skipped';
  gate_reason?: string;
  reflections_written: number;
  reflection_ids: string[];
}

/**
 * Orchestrates the conceptual A0/A1/A2 pipeline. Wire points are marked TODO.
 * Calling expectResults() / runFullEval() without host hooks throws NotWiredError.
 */
export class ReflectionHardeningEvalRunner {
  readonly flags: ExperimentFlags;
  readonly runConfig: RunConfig;
  readonly gate: ReflectionGate;
  readonly rollback: TaintedReflectionRollback;
  readonly logs: Array<Record<string, unknown> | ReflectAttemptLog> = [];

  private wiredMaybeReflect = false;
  private wiredCorrectionCampaign = false;

  constructor(opts: EvalRunnerOptions) {
    this.runConfig = opts.runConfig;
    this.flags =
      opts.flags ??
      flagsForArm(opts.armId, {
        reflectThreshold: opts.runConfig.reflect_threshold,
        trackedFactKeys: [
          opts.runConfig.rumorFactKey,
          opts.runConfig.correctionFactKey,
        ].filter(Boolean),
        minIndependentSources: opts.runConfig.min_independent_sources,
        gateRuleVersion: opts.runConfig.gate_rule_version,
      });
    this.gate = opts.gate ?? createDefaultGate(this.flags.gateRuleVersion);
    this.rollback = opts.rollback ?? createDefaultRollback();
  }

  /** Host calls this after patching maybeReflect to acknowledge the wire. */
  markMaybeReflectWired(): void {
    this.wiredMaybeReflect = true;
  }

  /** Host calls this after patching correction-campaign rollback trigger. */
  markCorrectionCampaignWired(): void {
    this.wiredCorrectionCampaign = true;
  }

  /**
   * Conceptual gate step for a single agent reflection attempt.
   * TODO(wire): call from packages/world-agents/src/reflect.ts maybeReflect
   *   after candidateEvidence is built and BEFORE llm insight / createMemoryEntry.
   */
  async gateReflectAttempt(input: {
    agentId: string;
    agentName: string;
    nowSimTime: number | string;
    stream: MemoryStreamLike;
    candidateEvidence: MemoryEntryLike[];
    recentImportanceSum?: number;
  }): Promise<{ gate: GateResult | null; attemptLog: ReflectAttemptLog }> {
    if (!shouldRunMaybeReflect(this.flags)) {
      const attemptLog: ReflectAttemptLog = {
        type: 'reflect_attempt',
        sim_time: input.nowSimTime,
        agent_id: input.agentId,
        recent_importance_sum: input.recentImportanceSum ?? null,
        threshold: this.flags.reflectThreshold,
        candidate_evidence_ids: input.candidateEvidence.map((e) => e.id),
        gate_enabled: false,
        gate_decision: 'skipped',
        gate_reason: 'arm_reflect_disabled',
        reflections_written: 0,
        reflection_ids: [],
      };
      this.logs.push(attemptLog);
      return { gate: null, attemptLog };
    }

    if (!shouldEvaluateGate(this.flags)) {
      const attemptLog: ReflectAttemptLog = {
        type: 'reflect_attempt',
        sim_time: input.nowSimTime,
        agent_id: input.agentId,
        recent_importance_sum: input.recentImportanceSum ?? null,
        threshold: this.flags.reflectThreshold,
        candidate_evidence_ids: input.candidateEvidence.map((e) => e.id),
        gate_enabled: false,
        gate_decision: 'skipped',
        reflections_written: 0,
        reflection_ids: [],
      };
      this.logs.push(attemptLog);
      return { gate: null, attemptLog };
    }

    const gate = await this.gate.evaluate({
      agentId: input.agentId,
      agentName: input.agentName,
      nowSimTime: input.nowSimTime,
      stream: input.stream,
      candidateEvidence: input.candidateEvidence,
      trackedFactKeys: this.flags.trackedFactKeys,
      minIndependentSources: this.flags.minIndependentSources,
      gateRuleVersion: this.flags.gateRuleVersion,
      contradictionPairs: [
        {
          rumorKey: this.runConfig.rumorFactKey,
          correctionKey: this.runConfig.correctionFactKey,
        },
      ],
      // TODO(wire): loadTrustedAnchors(stream) — correction observations / system truth
      trustedAnchors: listAgentEntries(input.stream, input.agentId).filter(
        (e) =>
          (e.factKeys ?? []).includes(this.runConfig.correctionFactKey) ||
          e.text.toLowerCase().includes(
            this.runConfig.correctionFactKey.toLowerCase(),
          ),
      ),
    });

    const attemptLog: ReflectAttemptLog = {
      type: 'reflect_attempt',
      sim_time: input.nowSimTime,
      agent_id: input.agentId,
      recent_importance_sum: input.recentImportanceSum ?? null,
      threshold: this.flags.reflectThreshold,
      candidate_evidence_ids: input.candidateEvidence.map((e) => e.id),
      gate_enabled: true,
      gate_decision: gate.decision,
      gate_reason: gate.reason,
      reflections_written: 0,
      reflection_ids: [],
    };
    this.logs.push(attemptLog);
    return { gate, attemptLog };
  }

  /**
   * Conceptual correction-campaign rollback for one agent.
   * TODO(wire): invoke at t_correct in the host tick / campaign driver for each
   *   agent (or Believe=1 subset) when shouldRunRollback(flags).
   * TODO(wire): pass reReflectHook that calls real maybeReflect on filtered stream.
   */
  async runCorrectionRollbackForAgent(input: {
    stream: MemoryStreamLike;
    agentId: string;
    agentName: string;
    nowSimTime: number | string;
    sinceSimTime: number | string;
    idFactory: () => string;
    seedObservationIds?: string[];
  }): Promise<RollbackResult | null> {
    if (!shouldRunRollback(this.flags)) {
      return null;
    }

    const result = await this.rollback.runAtCorrection({
      stream: input.stream,
      agentId: input.agentId,
      agentName: input.agentName,
      nowSimTime: input.nowSimTime,
      sinceSimTime: input.sinceSimTime,
      idFactory: input.idFactory,
      rumorFactKeys: [this.runConfig.rumorFactKey],
      seedObservationIds: input.seedObservationIds,
      quarantineMode: 'exclude_from_retrieval',
      // TODO(wire): reReflectHook: async (rr) => maybeReflect({ ... filtered stream ... })
    });

    this.logs.push({
      type: 'rollback_event',
      sim_time: input.nowSimTime,
      trigger: 'correction_campaign',
      agent_id: input.agentId,
      tainted_reflection_ids: result.taint.taintedReflectionIds,
      quarantined_edge_count: result.quarantine.quarantinedEdgeCount,
      rereflect_ids: result.newReflectionIds,
      success: result.success,
      reason: result.reason,
    });

    return result;
  }

  /**
   * Offline metric snapshot from host-exported memories / plans / events.
   * Safe to call without town wiring — does not invent rates.
   */
  snapshotMetrics(input: {
    simTime: number | string;
    agentSnapshots: AgentMemorySnapshot[];
    planOrActEvents: PlanOrActEventLike[];
    emergenceEvents: EmergenceEventLike[];
  }): Record<string, unknown> {
    const rates = computeLayerRatesFromSnapshots({
      agentSnapshots: input.agentSnapshots,
      rumorFactKey: this.runConfig.rumorFactKey,
      correctionFactKey: this.runConfig.correctionFactKey,
      planOrActEvents: input.planOrActEvents,
      emergenceEvents: input.emergenceEvents,
      requireBelieveForAct: true,
    });
    const snap = metricSnapshotLog({
      sim_time: input.simTime,
      arm_id: this.flags.armId,
      rates,
    });
    this.logs.push(snap);
    return snap;
  }

  /**
   * Throws unless host has acknowledged wire points. Prevents treating scaffold
   * dry-runs as experimental outcomes.
   */
  expectResults(): void {
    const missing: string[] = [];
    if (!this.wiredMaybeReflect) {
      missing.push(
        'maybeReflect (reflect.ts) — call markMaybeReflectWired() after patch',
      );
    }
    if (this.flags.rollbackEnabled && !this.wiredCorrectionCampaign) {
      missing.push(
        'correction campaign rollback — call markCorrectionCampaignWired() after patch',
      );
    }
    if (missing.length) {
      throw new NotWiredError(
        `ReflectionHardeningEvalRunner: refusing results; not wired:\n- ${missing.join('\n- ')}\nSee ../04_下一步接线清单.md`,
      );
    }
  }

  /**
   * Full eval entry — always throws until OpenGame is patched locally.
   * Intentionally does not return fabricated H1–H3 numbers.
   */
  async runFullEval(): Promise<never> {
    this.expectResults();
    throw new NotWiredError(
      'runFullEval: wire points marked but no town harness is attached in scaffold. ' +
        'Drive the real sim on the user machine (OpenGame has no git remote in this workspace).',
    );
  }
}

export function createEvalRunner(opts: EvalRunnerOptions): ReflectionHardeningEvalRunner {
  return new ReflectionHardeningEvalRunner(opts);
}
