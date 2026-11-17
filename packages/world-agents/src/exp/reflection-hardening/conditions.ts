/**
 * Three-arm ArmConfig / ExperimentFlags for Candidate-1.
 * NOT wired into OpenGame — import only after a deliberate local patch.
 */

import type { ArmConfig, ArmId, ExperimentFlags } from './types';
import { DEFAULT_GATE_RULE_VERSION } from './gate';

const DEFAULT_THRESHOLD = 150;
const DEFAULT_MIN_SOURCES = 2;

export type { ArmConfig, ExperimentFlags };

/**
 * Build ArmConfig for A0 (no reflection), A1 (free reflection), A2 (gate+rollback).
 * trackedFactKeys should include rumorFactKey (and optionally correctionFactKey).
 */
export function flagsForArm(
  armId: ArmId,
  opts?: {
    reflectThreshold?: number;
    minIndependentSources?: number;
    trackedFactKeys?: string[];
    forceSeedRespectsGate?: boolean;
    gateRuleVersion?: string;
  },
): ArmConfig {
  const reflectThreshold = opts?.reflectThreshold ?? DEFAULT_THRESHOLD;
  const minIndependentSources =
    opts?.minIndependentSources ?? DEFAULT_MIN_SOURCES;
  const trackedFactKeys = opts?.trackedFactKeys ?? [];
  const forceSeedRespectsGate = opts?.forceSeedRespectsGate ?? true;
  const gateRuleVersion = opts?.gateRuleVersion ?? DEFAULT_GATE_RULE_VERSION;

  const base = {
    reflectThreshold,
    minIndependentSources,
    trackedFactKeys,
    forceSeedRespectsGate,
    gateRuleVersion,
  };

  switch (armId) {
    case 'A0':
      return {
        armId,
        reflectEnabled: false,
        gateEnabled: false,
        rollbackEnabled: false,
        ...base,
      };
    case 'A1':
      return {
        armId,
        reflectEnabled: true,
        gateEnabled: false,
        rollbackEnabled: false,
        ...base,
      };
    case 'A2':
      return {
        armId,
        reflectEnabled: true,
        gateEnabled: true,
        rollbackEnabled: true,
        ...base,
      };
    default: {
      const _exhaustive: never = armId;
      throw new Error(`Unknown arm: ${_exhaustive}`);
    }
  }
}

/** Alias matching protocol wording. */
export const armConfigFor = flagsForArm;

/** Guard for maybeReflect call sites. */
export function shouldRunMaybeReflect(flags: ExperimentFlags): boolean {
  return flags.reflectEnabled;
}

/** Guard before ReflectionGate.evaluate. */
export function shouldEvaluateGate(flags: ExperimentFlags): boolean {
  return flags.reflectEnabled && flags.gateEnabled;
}

/** Guard at t_correct for TaintedReflectionRollback.runAtCorrection. */
export function shouldRunRollback(flags: ExperimentFlags): boolean {
  return flags.rollbackEnabled;
}

/** Map ArmConfig onto run_config gate/rollback/reflect_threshold fields. */
export function armConfigToRunConfigFields(flags: ArmConfig): {
  arm_id: ArmId;
  reflect_threshold: number;
  gate_enabled: boolean;
  rollback_enabled: boolean;
  gate_rule_version: string;
  min_independent_sources: number;
} {
  return {
    arm_id: flags.armId,
    reflect_threshold: flags.reflectThreshold,
    gate_enabled: flags.gateEnabled,
    rollback_enabled: flags.rollbackEnabled,
    gate_rule_version: flags.gateRuleVersion,
    min_independent_sources: flags.minIndependentSources,
  };
}
