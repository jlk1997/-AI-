/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  clearQuotaCooldown,
  isPoolEntryCoolingDown,
  markPoolFailure,
  markPoolSuccess,
  resolveProviderPool,
} from '@opengame/opengame-core';
import {
  detectLlmAuthError,
  detectLlmQuotaError,
} from '@opengame/platform-shared';

/**
 * Reasoning key pool for the CLI Agent child process.
 *
 * The Agent is not a library call we can wrap — it is a spawned process that
 * reads `OPENAI_*` / `OPENGAME_REASONING_*` from its environment. So instead of
 * rotating in-process (see `providerPool.ts` in core), this module produces an
 * ordered list of *env overlays*: one per usable key. `processJob` walks them
 * when an attempt dies with a quota / arrears error, which replaces the old
 * "primary MiniMax, then one Ark retry, then give up" behaviour with a full
 * MiniMax multi-key rotation (OPENAI_API_KEYS / REASONING_API_KEYS / FALLBACK_*).
 *
 * Health state (cooldown + score) is shared with core's pool, so a key that
 * 429'd during asset generation is also skipped for the Agent, and vice versa.
 */

export interface AgentKeyCandidate {
  /** Health-map id, shared with core's provider pool where possible. */
  readonly id: string;
  readonly tier: 'primary' | 'fallback';
  readonly provider: string;
  readonly baseUrl: string;
  readonly model: string;
  /** Last 4 chars of the key — safe for timeline events and logs. */
  readonly keyHint: string;
  /** Env overlay that points the CLI child at this key. */
  readonly env: NodeJS.ProcessEnv;
}

/** One failed CLI attempt attributed to a pool key — used for honest job logs. */
export interface AgentKeyAttemptFailure {
  readonly id: string;
  readonly tier: 'primary' | 'fallback';
  readonly provider: string;
  readonly model: string;
  readonly keyHint: string;
  readonly kind: 'quota' | 'billing' | 'auth';
  readonly snippet: string;
}

interface RawCandidate {
  readonly id: string;
  readonly tier: 'primary' | 'fallback';
  readonly provider: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKey: string;
}

function splitKeys(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[,\n]/)
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

function trimSlashes(url: string): string {
  return url.replace(/\/+$/g, '');
}

function inferProvider(baseUrl: string): string {
  if (/minimaxi?\.com/i.test(baseUrl)) return 'minimax';
  if (/volces\.com|ark\.cn-beijing/i.test(baseUrl)) return 'doubao';
  if (/dashscope|aliyuncs/i.test(baseUrl)) return 'tongyi';
  return 'openai-compat';
}

/**
 * Collect every reasoning key the operator configured, in preference order.
 *
 * Sources, highest priority first:
 * 1. Core's reasoning pool (`OPENGAME_REASONING_API_KEY[S]`, legacy keys).
 * 2. `OPENAI_API_KEYS` — the CLI-facing plural form, sharing OPENAI_BASE_URL/MODEL.
 * 3. `OPENAI_FALLBACK_*` / `OPENGAME_FALLBACK_*` — the pre-existing single spare.
 */
export function resolveAgentKeyCandidates(
  env: NodeJS.ProcessEnv = process.env,
): AgentKeyCandidate[] {
  const raw: RawCandidate[] = [];
  const seen = new Set<string>();

  const push = (candidate: RawCandidate): void => {
    const dedupeKey = `${candidate.provider}|${candidate.baseUrl}|${candidate.apiKey}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    raw.push(candidate);
  };

  for (const entry of resolveProviderPool('reasoning', undefined, env)) {
    push({
      id: entry.id,
      tier: entry.tier,
      provider: entry.config.provider,
      baseUrl: entry.config.baseUrl,
      model: entry.config.model,
      apiKey: entry.config.apiKey,
    });
  }

  const openAiBase = trimSlashes(
    env['OPENAI_BASE_URL']?.trim() || 'https://api.minimaxi.com/v1',
  );
  const openAiModel = env['OPENAI_MODEL']?.trim() || 'MiniMax-M2.7';
  for (const key of splitKeys(env['OPENAI_API_KEYS'])) {
    push({
      id: `agent:${inferProvider(openAiBase)}:${openAiBase}:${key.slice(-4)}`,
      tier: 'primary',
      provider: inferProvider(openAiBase),
      baseUrl: openAiBase,
      model: openAiModel,
      apiKey: key,
    });
  }

  const fallbackKeys = [
    ...splitKeys(env['OPENAI_FALLBACK_API_KEYS']),
    ...splitKeys(env['OPENAI_FALLBACK_API_KEY']),
    ...splitKeys(env['OPENGAME_FALLBACK_API_KEYS']),
    ...splitKeys(env['OPENGAME_FALLBACK_API_KEY']),
  ];
  if (fallbackKeys.length > 0) {
    // Prefer MiniMax as the spare line. Never default to Volcengine Ark —
    // operators who want Ark must set OPENAI_FALLBACK_BASE_URL explicitly.
    const fbBase = trimSlashes(
      env['OPENAI_FALLBACK_BASE_URL']?.trim() ||
        env['OPENGAME_FALLBACK_BASE_URL']?.trim() ||
        env['OPENAI_BASE_URL']?.trim() ||
        env['OPENGAME_REASONING_BASE_URL']?.trim() ||
        'https://api.minimaxi.com/v1',
    );
    const fbModel =
      env['OPENAI_FALLBACK_MODEL']?.trim() ||
      env['OPENGAME_REASONING_FALLBACK_MODEL']?.trim() ||
      env['OPENAI_MODEL']?.trim() ||
      env['OPENGAME_REASONING_MODEL']?.trim() ||
      'MiniMax-M3';
    const fbProvider =
      env['OPENGAME_FALLBACK_PROVIDER']?.trim() || inferProvider(fbBase);
    for (const key of fallbackKeys) {
      push({
        id: `agent:${fbProvider}:${fbBase}:${key.slice(-4)}`,
        tier: 'fallback',
        provider: fbProvider,
        baseUrl: fbBase,
        model: fbModel,
        apiKey: key,
      });
    }
  }

  return raw.map((candidate) => ({
    id: candidate.id,
    tier: candidate.tier,
    provider: candidate.provider,
    baseUrl: candidate.baseUrl,
    model: candidate.model,
    keyHint: candidate.apiKey.slice(-4),
    env: {
      OPENAI_API_KEY: candidate.apiKey,
      OPENAI_BASE_URL: candidate.baseUrl,
      OPENAI_MODEL: candidate.model,
      OPENGAME_REASONING_PROVIDER: candidate.provider,
      OPENGAME_REASONING_API_KEY: candidate.apiKey,
      OPENGAME_REASONING_BASE_URL: candidate.baseUrl,
      OPENGAME_REASONING_MODEL: candidate.model,
    },
  }));
}

/** Apply a candidate's overlay on top of the current child env. */
export function applyAgentKeyCandidate(
  base: NodeJS.ProcessEnv,
  candidate: AgentKeyCandidate,
): NodeJS.ProcessEnv {
  return { ...base, ...candidate.env };
}

/** Jobs cheaper than this must not rotate onto Ark / doubao. */
export const DEFAULT_EMERGENCY_MIN_POINTS = 10;

export function emergencyMinJobPoints(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env['PLATFORM_EMERGENCY_MIN_POINTS']?.trim();
  const parsed = raw ? Number(raw) : NaN;
  if (Number.isFinite(parsed) && parsed >= 0) return Math.floor(parsed);
  return DEFAULT_EMERGENCY_MIN_POINTS;
}

/**
 * Expensive FALLBACK is last-resort for paid generate / world_generate.
 * A 2-point society seed or 1-point build must fail honestly instead.
 */
export function jobAllowsEmergencyModel(input: {
  readonly jobType?: string;
  readonly pointsCharged?: number;
  readonly env?: NodeJS.ProcessEnv;
}): boolean {
  const env = input.env ?? process.env;
  const min = emergencyMinJobPoints(env);
  if (input.pointsCharged != null) {
    return input.pointsCharged >= min;
  }
  return input.jobType === 'generate' || input.jobType === 'world_generate';
}

/**
 * Pick the next key to try. Skips ids already used in this job and keys parked
 * by an earlier quota / arrears failure; falls back to a parked key only when
 * nothing else is left, so a stale cooldown can't fail an otherwise fine job.
 *
 * `allowEmergency: false` skips fallback-tier (Ark) keys so cheap jobs
 * cannot lose money on the spare line.
 */
export function pickNextAgentKey(
  candidates: readonly AgentKeyCandidate[],
  usedIds: ReadonlySet<string>,
  now: number = Date.now(),
  opts?: { readonly allowEmergency?: boolean },
): AgentKeyCandidate | null {
  const pool =
    opts?.allowEmergency === false
      ? candidates.filter((c) => c.tier !== 'fallback')
      : candidates;
  const unused = pool.filter((c) => !usedIds.has(c.id));
  if (unused.length === 0) return null;
  return (
    unused.find((c) => !isPoolEntryCoolingDown(c.id, now)) ?? unused[0] ?? null
  );
}

/**
 * After a fallback-tier billing failure, reclaim a previously-used primary that
 * only hit a short-lived quota/rate-limit so we do not hard-fail the job solely
 * because Volcengine is in arrears while MiniMax may already have recovered.
 *
 * Mutates `usedIds` (removes the reclaimed id) and clears that key's quota park.
 * Returns null when there is nothing sensible to reclaim.
 */
export function reclaimPrimaryAfterFallbackBilling(
  candidates: readonly AgentKeyCandidate[],
  usedIds: Set<string>,
  trail: readonly AgentKeyAttemptFailure[],
): AgentKeyCandidate | null {
  const last = trail[trail.length - 1];
  if (!last || last.tier !== 'fallback' || last.kind !== 'billing') {
    return null;
  }

  const primaryFail = [...trail]
    .reverse()
    .find((f) => f.tier === 'primary' && f.kind !== 'billing');
  const targetId =
    primaryFail?.id ??
    candidates.find((c) => c.tier === 'primary' && usedIds.has(c.id))?.id ??
    null;
  if (!targetId) return null;

  const candidate = candidates.find((c) => c.id === targetId);
  if (!candidate || candidate.tier !== 'primary') return null;

  clearQuotaCooldown(targetId);
  usedIds.delete(targetId);
  return candidate;
}

/** Build a job-log summary that lists every key attempt, not only the last error. */
export function formatAgentKeyRotationSummary(
  trail: readonly AgentKeyAttemptFailure[],
): string {
  if (trail.length === 0) {
    return 'Key 池轮转失败（无详细轨迹）';
  }
  const parts = trail.map((f) => {
    const label = f.tier === 'primary' ? '主路' : '备路';
    const why =
      f.kind === 'billing'
        ? '欠费/余额'
        : f.kind === 'auth'
          ? '鉴权/Key无效'
          : '配额/限流';
    const snip = f.snippet.replace(/\s+/g, ' ').slice(0, 120);
    return `${label} ${f.provider}(${f.model}…${f.keyHint}): ${why} — ${snip}`;
  });
  const prefix =
    trail.length >= 2
      ? `Key 池已试 ${trail.length} 路均未成功：`
      : `Key 池轮转失败：`;
  return `${prefix}${parts.join('；')}`;
}

/**
 * Park a key after a failed CLI attempt. Quota/arrears/auth failures are
 * attributed to the key — a TypeScript error in generated code is the model's
 * fault, not the key's, and must not empty the pool.
 */
export function recordAgentKeyOutcome(
  candidateId: string,
  cliOutput: string,
  env: NodeJS.ProcessEnv = process.env,
): 'quota' | 'billing' | 'auth' | 'none' {
  const quota = detectLlmQuotaError(cliOutput);
  if (quota) {
    const kind = markPoolFailure(candidateId, new Error(quota.snippet), env);
    return kind === 'billing' ? 'billing' : 'quota';
  }
  const auth = detectLlmAuthError(cliOutput);
  if (auth) {
    markPoolFailure(candidateId, new Error(auth.snippet), env);
    return 'auth';
  }
  return 'none';
}

/** Append a trail row for the current candidate when CLI output is rotate-worthy. */
export function pushAgentKeyFailure(
  trail: AgentKeyAttemptFailure[],
  candidate: AgentKeyCandidate | undefined,
  cliOutput: string,
  env: NodeJS.ProcessEnv = process.env,
): 'quota' | 'billing' | 'auth' | 'none' {
  if (!candidate) return 'none';
  const quota = detectLlmQuotaError(cliOutput);
  const auth = quota ? null : detectLlmAuthError(cliOutput);
  if (!quota && !auth) return 'none';
  const kind = recordAgentKeyOutcome(candidate.id, cliOutput, env);
  if (kind === 'none') return 'none';
  trail.push({
    id: candidate.id,
    tier: candidate.tier,
    provider: candidate.provider,
    model: candidate.model,
    keyHint: candidate.keyHint,
    kind,
    snippet: (quota ?? auth)!.snippet,
  });
  return kind;
}

/** Credit a key after a successful CLI attempt so its score recovers. */
export function recordAgentKeySuccess(candidateId: string): void {
  markPoolSuccess(candidateId);
}

/** How many key rotations one CLI attempt may spend (`PLATFORM_AGENT_KEY_MAX_ROTATIONS`). */
export function agentKeyMaxRotations(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env['PLATFORM_AGENT_KEY_MAX_ROTATIONS']?.trim();
  const parsed = raw ? Number(raw) : NaN;
  if (Number.isFinite(parsed) && parsed >= 0) return Math.floor(parsed);
  return 2;
}
