/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Progressive quality gates for `generate` jobs.
 *
 * Historically every FIX attempt ran the *strictest* configured bar
 * (`strict` + beyond-baseline + smoke progress), so the very first round had to
 * satisfy every gate at once. Any single miss restarted a full CLI Agent round,
 * which is why a job could burn 8 rounds without ever shipping a preview.
 *
 * `progressive` (default) splits that into two tiers:
 *   - `baseline`: DSL + typecheck/vite + canvas smoke + ChangePlan intent.
 *     Passing it means "playable" and we ship a preview immediately.
 *   - `quality`: whatever the env asks for (strict / beyond / smoke progress).
 *     Runs only after a playable baseline exists, so escalation failures can
 *     never take the already-working preview away from the user.
 *
 * The downstream gates read env vars directly (`gameQualityGate`,
 * `playabilitySmoke`, `promptContracts`), so a tier is applied by temporarily
 * overriding those vars around one attempt — see {@link withGateTierEnv}.
 */

import { requireRealAssets } from './assetAuthenticity.js';

export type GateEscalationMode = 'progressive' | 'strict-first';

export interface GateTier {
  /** `baseline` = ship-as-soon-as-playable; `quality` = configured top bar. */
  readonly id: 'baseline' | 'quality';
  readonly qaMode: 'strict' | 'relaxed';
  readonly beyondBaseline: boolean;
  readonly requireProgress: boolean;
  /** Short Chinese label for the agent timeline. */
  readonly label: string;
}

export const BASELINE_TIER: GateTier = {
  id: 'baseline',
  qaMode: 'relaxed',
  beyondBaseline: false,
  requireProgress: false,
  label: '基线门禁（可玩即交付）',
};

/** `progressive` unless explicitly asked to run the top bar from round 1. */
export function readGateEscalationMode(): GateEscalationMode {
  const raw = process.env['PLATFORM_GATE_ESCALATION']?.trim().toLowerCase();
  if (raw === 'strict-first' || raw === 'strict' || raw === 'off') {
    return 'strict-first';
  }
  return 'progressive';
}

/** The quality bar the operator configured — the tier we escalate *towards*. */
export function resolveTargetGateTier(): GateTier {
  const strict =
    process.env['PLATFORM_GAME_QUALITY_MODE'] === 'strict' ||
    process.env['PLATFORM_GAME_QA_MODE'] === 'strict';
  const beyond =
    strict ||
    process.env['PLATFORM_QUALITY_BEYOND_BASELINE'] === 'true' ||
    process.env['PLATFORM_QUALITY_BEYOND_BASELINE'] === '1';
  const smokeEnv = process.env['PLATFORM_SMOKE_REQUIRE_PROGRESS'];
  const requireProgress =
    smokeEnv === 'true' ||
    smokeEnv === '1' ||
    (smokeEnv !== 'false' && smokeEnv !== '0' && beyond);
  if (!strict && !beyond && !requireProgress) {
    return BASELINE_TIER;
  }
  return {
    id: 'quality',
    qaMode: strict ? 'strict' : 'relaxed',
    beyondBaseline: beyond,
    requireProgress,
    label: strict ? '严格质量门禁（strict）' : '超越基线门禁（beyond）',
  };
}

export function gateTiersEqual(a: GateTier, b: GateTier): boolean {
  return (
    a.id === b.id &&
    a.qaMode === b.qaMode &&
    a.beyondBaseline === b.beyondBaseline &&
    a.requireProgress === b.requireProgress
  );
}

/**
 * Which tier this attempt should be judged against.
 *
 * In `progressive` mode we stay on `baseline` until a playable build has been
 * shipped, then switch to the configured target for the remaining budget.
 */
export function resolveGateTierForAttempt(options: {
  readonly mode: GateEscalationMode;
  readonly target: GateTier;
  readonly deliveredPlayable: boolean;
}): GateTier {
  if (options.mode === 'strict-first') return options.target;
  return options.deliveredPlayable ? options.target : BASELINE_TIER;
}

const TIER_ENV_KEYS = [
  'PLATFORM_GAME_QUALITY_MODE',
  'PLATFORM_GAME_QA_MODE',
  'PLATFORM_QUALITY_BEYOND_BASELINE',
  'PLATFORM_SMOKE_REQUIRE_PROGRESS',
  'PLATFORM_REQUIRE_REAL_ASSETS',
] as const;

export type GateTierEnvSnapshot = ReadonlyMap<string, string | undefined>;

/**
 * Rewrites the gate env vars so downstream checks behave like `tier`.
 *
 * Real-asset policy is deliberately *not* relaxed: `requireRealAssets()` keys
 * off the same beyond/strict vars, and downgrading it would let a placeholder
 * build pass the baseline tier. We pin `PLATFORM_REQUIRE_REAL_ASSETS` whenever
 * the ambient config already implied it.
 */
export function applyGateTierEnv(tier: GateTier): GateTierEnvSnapshot {
  const saved = new Map<string, string | undefined>();
  for (const k of TIER_ENV_KEYS) saved.set(k, process.env[k]);
  const realAssets = requireRealAssets();

  process.env['PLATFORM_GAME_QUALITY_MODE'] = tier.qaMode;
  process.env['PLATFORM_GAME_QA_MODE'] = tier.qaMode;
  process.env['PLATFORM_QUALITY_BEYOND_BASELINE'] = tier.beyondBaseline
    ? 'true'
    : 'false';
  process.env['PLATFORM_SMOKE_REQUIRE_PROGRESS'] = tier.requireProgress
    ? 'true'
    : 'false';
  if (realAssets) {
    process.env['PLATFORM_REQUIRE_REAL_ASSETS'] = 'true';
  }
  return saved;
}

export function restoreGateTierEnv(snapshot: GateTierEnvSnapshot): void {
  for (const k of TIER_ENV_KEYS) {
    const v = snapshot.get(k);
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

/** Convenience wrapper for callers that don't need `continue`/`break`. */
export async function withGateTierEnv<T>(
  tier: GateTier,
  fn: () => Promise<T>,
): Promise<T> {
  const snapshot = applyGateTierEnv(tier);
  try {
    return await fn();
  } finally {
    restoreGateTierEnv(snapshot);
  }
}

/** Prompt block appended when we ask the Agent to raise an already-playable game. */
export function formatQualityEscalationPrompt(options: {
  readonly userPrompt: string;
  readonly tier: GateTier;
  readonly issues: readonly string[];
}): string {
  const lines = [
    '【提质轮 / Quality escalation】基线版本已可玩并已部署预览，现在只做加分项。',
    `目标门禁：${options.tier.label}`,
    `用户原始需求（保留）：${options.userPrompt.slice(0, 400)}`,
    '',
    '硬性要求：',
    '- 禁止重写已通过的玩法闭环；只做增量增强。',
    '- 任何改动后 typecheck 必须仍然通过；宁可少改也不要改坏。',
  ];
  if (options.issues.length > 0) {
    lines.push('', '待补齐项：', ...options.issues.map((i) => `- ${i}`));
  }
  return lines.join('\n');
}
