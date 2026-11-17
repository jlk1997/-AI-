/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Multi-key provider pool with cooldown and health scoring.
 *
 * `providerConfig.ts` resolves ONE primary config plus (optionally) ONE
 * fallback per modality. That is not enough for cost governance: when a key
 * hits a 429 or goes into arrears, the whole generation stalls even though the
 * user may own several keys.
 *
 * This module turns that "primary + single spare" into an ordered pool:
 *
 *   OPENGAME_<MOD>_API_KEYS=key1,key2,key3   ← rotated, same provider/base URL
 *   OPENGAME_<MOD>_API_KEY=key0              ← still honoured, ranked first
 *   OPENGAME_FALLBACK_*                      ← appended as a lower tier
 *
 * Every candidate carries mutable health state kept in a module-level map so
 * it survives across calls inside one worker process:
 *
 * - `quota` failures (429 / rate limit / token plan) park the key for
 *   `OPENGAME_POOL_QUOTA_COOLDOWN_MS` (default 60s) — those recover on their own.
 * - `billing` failures (overdue balance / 余额不足) park it for
 *   `OPENGAME_POOL_BILLING_COOLDOWN_MS` (default 30min) — those need a human.
 * - A health score in [0, 1] decays on failure and recovers on success, so a
 *   flaky key drifts to the back of the pool instead of being retried first.
 */

import {
  MissingProviderConfigError,
  resolveFallbackProviderConfig,
  tryResolveProviderConfig,
  type Modality,
  type OpenGameProvidersSettings,
  type ProviderName,
  type ResolvedProviderConfig,
} from './providerConfig.js';
import { isModalityQuotaError } from './modalityQuotaError.js';

/** Why a key was parked. `billing` needs human action, `quota` self-heals. */
export type PoolFailureKind = 'quota' | 'billing' | 'error';

export interface ProviderPoolEntry {
  /** Stable identity: `<modality>:<provider>:<baseUrl>:<key fingerprint>`. */
  readonly id: string;
  /** `primary` comes from the modality's own env/settings, `fallback` from OPENGAME_FALLBACK_*. */
  readonly tier: 'primary' | 'fallback';
  /** Position within its tier, as declared by the user. */
  readonly rank: number;
  readonly config: ResolvedProviderConfig;
}

interface PoolHealth {
  /** 1 = healthy, 0 = fully distrusted. */
  score: number;
  successes: number;
  failures: number;
  /** Epoch ms until which this key is parked; 0 when usable. */
  cooldownUntil: number;
  lastKind: PoolFailureKind | null;
  lastError: string | null;
}

/** Sanitized view for logs, `/setup` output and the platform UI. */
export interface ProviderPoolStatusEntry {
  readonly id: string;
  readonly tier: 'primary' | 'fallback';
  readonly provider: ProviderName;
  readonly baseUrl: string;
  readonly model: string;
  /** Last 4 characters only — never the key itself. */
  readonly keyHint: string;
  readonly score: number;
  readonly successes: number;
  readonly failures: number;
  readonly coolingDown: boolean;
  readonly cooldownMsRemaining: number;
  readonly lastKind: PoolFailureKind | null;
}

const DEFAULT_QUOTA_COOLDOWN_MS = 60_000;
const DEFAULT_BILLING_COOLDOWN_MS = 30 * 60_000;
const DEFAULT_ERROR_COOLDOWN_MS = 15_000;

/** Multiplier applied to the health score on each failure kind. */
const SCORE_PENALTY: Record<PoolFailureKind, number> = {
  quota: 0.6,
  billing: 0.2,
  error: 0.8,
};

const health = new Map<string, PoolHealth>();

function readCooldownMs(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function cooldownForKind(
  kind: PoolFailureKind,
  env: NodeJS.ProcessEnv,
): number {
  switch (kind) {
    case 'billing':
      return readCooldownMs(
        env,
        'OPENGAME_POOL_BILLING_COOLDOWN_MS',
        DEFAULT_BILLING_COOLDOWN_MS,
      );
    case 'quota':
      return readCooldownMs(
        env,
        'OPENGAME_POOL_QUOTA_COOLDOWN_MS',
        DEFAULT_QUOTA_COOLDOWN_MS,
      );
    default:
      return readCooldownMs(
        env,
        'OPENGAME_POOL_ERROR_COOLDOWN_MS',
        DEFAULT_ERROR_COOLDOWN_MS,
      );
  }
}

function ensureHealth(id: string): PoolHealth {
  const existing = health.get(id);
  if (existing) return existing;
  const fresh: PoolHealth = {
    score: 1,
    successes: 0,
    failures: 0,
    cooldownUntil: 0,
    lastKind: null,
    lastError: null,
  };
  health.set(id, fresh);
  return fresh;
}

/**
 * Non-cryptographic fingerprint of a key. We never log the key, and we need
 * the id to be stable across resolves so health survives.
 */
function fingerprintKey(apiKey: string): string {
  let hash = 2166136261;
  for (let i = 0; i < apiKey.length; i += 1) {
    hash ^= apiKey.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function entryId(modality: Modality, cfg: ResolvedProviderConfig): string {
  return `${modality}:${cfg.provider}:${cfg.baseUrl}:${fingerprintKey(cfg.apiKey)}`;
}

function splitKeys(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[,\n]/)
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

/**
 * Build the ordered candidate list for a modality. Never throws: when nothing
 * is configured the pool is simply empty, letting callers degrade (placeholder
 * assets, skipped audio, …) exactly like `tryResolveProviderConfig` does.
 */
export function resolveProviderPool(
  modality: Modality,
  fromConfig?: OpenGameProvidersSettings,
  env: NodeJS.ProcessEnv = process.env,
): ProviderPoolEntry[] {
  const entries: ProviderPoolEntry[] = [];
  const seen = new Set<string>();

  const push = (
    tier: 'primary' | 'fallback',
    cfg: ResolvedProviderConfig,
  ): void => {
    const id = entryId(modality, cfg);
    if (seen.has(id)) return;
    seen.add(id);
    entries.push({ id, tier, rank: entries.length, config: cfg });
  };

  // Primary tier: the modality's own config, then every extra key in
  // OPENGAME_<MOD>_API_KEYS reusing that same provider/base URL/model.
  const primary = tryResolveProviderConfig(modality, fromConfig, env);
  if (primary) {
    push('primary', primary);
    for (const key of splitKeys(
      env[`OPENGAME_${modality.toUpperCase()}_API_KEYS`],
    )) {
      push('primary', { ...primary, apiKey: key });
    }
  } else {
    // No single key configured, but the user may have only filled the plural
    // form. Resolve again with the first pooled key injected so provider /
    // base URL / model inference still runs through providerConfig.
    const pooled = splitKeys(env[`OPENGAME_${modality.toUpperCase()}_API_KEYS`]);
    if (pooled.length > 0) {
      const upper = modality.toUpperCase();
      for (const key of pooled) {
        const resolved = tryResolveProviderConfig(modality, fromConfig, {
          ...env,
          [`OPENGAME_${upper}_API_KEY`]: key,
        });
        if (resolved) push('primary', resolved);
      }
    }
  }

  // Fallback tier: OPENGAME_FALLBACK_* (single) + optional plural form.
  const fallback = resolveFallbackProviderConfig(modality, env);
  if (fallback) {
    push('fallback', fallback);
    for (const key of splitKeys(env['OPENGAME_FALLBACK_API_KEYS'])) {
      push('fallback', { ...fallback, apiKey: key });
    }
  }

  return entries;
}

function tierWeight(tier: 'primary' | 'fallback'): number {
  return tier === 'primary' ? 0 : 1;
}

/**
 * Order candidates for an attempt: usable keys before parked ones, primary
 * tier before fallback, higher health first, declaration order last.
 */
export function orderPoolCandidates(
  entries: readonly ProviderPoolEntry[],
  now: number = Date.now(),
): ProviderPoolEntry[] {
  return [...entries].sort((a, b) => {
    const ha = ensureHealth(a.id);
    const hb = ensureHealth(b.id);
    const coolA = ha.cooldownUntil > now ? 1 : 0;
    const coolB = hb.cooldownUntil > now ? 1 : 0;
    if (coolA !== coolB) return coolA - coolB;
    const tierDiff = tierWeight(a.tier) - tierWeight(b.tier);
    if (tierDiff !== 0) return tierDiff;
    if (hb.score !== ha.score) return hb.score - ha.score;
    return a.rank - b.rank;
  });
}

/** Classify a thrown provider error into a cooldown bucket. */
export function classifyPoolFailure(error: unknown): PoolFailureKind {
  const text =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? `${error.message}\n${String((error as { cause?: unknown }).cause ?? '')}`
        : String(error ?? '');
  if (
    /overdue balance/i.test(text) ||
    /insufficient (balance|funds|credit)/i.test(text) ||
    /欠费/.test(text) ||
    /余额不足/.test(text) ||
    (/\b403\b/.test(text) && /balance|billing|payment|欠费|余额/i.test(text))
  ) {
    return 'billing';
  }
  return isModalityQuotaError(error) ? 'quota' : 'error';
}

/** Record a successful call: recover health and clear any cooldown. */
export function markPoolSuccess(id: string): void {
  const state = ensureHealth(id);
  state.successes += 1;
  state.cooldownUntil = 0;
  state.lastKind = null;
  state.lastError = null;
  state.score = Math.min(1, state.score + 0.25);
}

/**
 * Drop a short-lived quota/rate-limit park so the key can be retried after a
 * fallback billing failure. Billing parks are left alone — those need a human.
 */
export function clearQuotaCooldown(id: string): boolean {
  const state = health.get(id);
  if (!state) return false;
  if (state.lastKind === 'billing') return false;
  state.cooldownUntil = 0;
  if (state.lastKind === 'quota') {
    state.lastKind = null;
    state.lastError = null;
  }
  return true;
}

/** Record a failed call: park the key and decay its health score. */
export function markPoolFailure(
  id: string,
  error: unknown,
  env: NodeJS.ProcessEnv = process.env,
  now: number = Date.now(),
): PoolFailureKind {
  const kind = classifyPoolFailure(error);
  const state = ensureHealth(id);
  state.failures += 1;
  state.lastKind = kind;
  state.lastError =
    error instanceof Error ? error.message.slice(0, 240) : String(error ?? '').slice(0, 240);
  state.score = Math.max(0, state.score * SCORE_PENALTY[kind]);
  state.cooldownUntil = now + cooldownForKind(kind, env);
  return kind;
}

/** True when every candidate is currently parked. */
export function isPoolExhausted(
  entries: readonly ProviderPoolEntry[],
  now: number = Date.now(),
): boolean {
  if (entries.length === 0) return true;
  return entries.every((entry) => ensureHealth(entry.id).cooldownUntil > now);
}

export interface RunWithPoolOptions<T> {
  readonly modality: Modality;
  readonly run: (
    config: ResolvedProviderConfig,
    entry: ProviderPoolEntry,
  ) => Promise<T>;
  readonly fromConfig?: OpenGameProvidersSettings;
  readonly env?: NodeJS.ProcessEnv;
  /**
   * When false (default) a non-quota error aborts immediately — a malformed
   * prompt should not burn every key in the pool. Quota/billing errors always
   * advance to the next candidate.
   */
  readonly rotateOnAnyError?: boolean;
  /** Called before each attempt; used by the worker to surface failover in the timeline. */
  readonly onAttempt?: (entry: ProviderPoolEntry, attempt: number) => void;
}

/**
 * Run `run` against the pool, rotating on quota/billing failures.
 *
 * Parked keys are still tried as a last resort (ordered last) rather than
 * failing outright — a stale cooldown must never turn a recoverable request
 * into a hard failure.
 */
export async function runWithProviderPool<T>(
  options: RunWithPoolOptions<T>,
): Promise<T> {
  const env = options.env ?? process.env;
  const pool = resolveProviderPool(options.modality, options.fromConfig, env);
  if (pool.length === 0) {
    throw new MissingProviderConfigError(
      options.modality,
      `No usable API key for "${options.modality}". Set OPENGAME_${options.modality.toUpperCase()}_API_KEY ` +
        `or OPENGAME_${options.modality.toUpperCase()}_API_KEYS (comma-separated pool).`,
    );
  }

  const ordered = orderPoolCandidates(pool);
  let lastError: unknown;
  for (let i = 0; i < ordered.length; i += 1) {
    const entry = ordered[i]!;
    options.onAttempt?.(entry, i + 1);
    try {
      const result = await options.run(entry.config, entry);
      markPoolSuccess(entry.id);
      return result;
    } catch (error) {
      lastError = error;
      const kind = markPoolFailure(entry.id, error, env);
      const rotatable = kind !== 'error' || options.rotateOnAnyError === true;
      if (!rotatable || i === ordered.length - 1) throw error;
      console.warn(
        `[provider-pool] ${options.modality} ${entry.config.provider} key…${entry.config.apiKey.slice(-4)} ${kind} — rotating (${i + 2}/${ordered.length})`,
      );
    }
  }
  throw lastError;
}

/** True when a specific candidate is currently parked. */
export function isPoolEntryCoolingDown(
  id: string,
  now: number = Date.now(),
): boolean {
  return ensureHealth(id).cooldownUntil > now;
}

/**
 * Pool-backed replacement for `withProviderFailover`.
 *
 * Keeps the old call shape — callers already hold an instantiated service for
 * the primary config and can build another one from a `ResolvedProviderConfig`
 * — but walks every pooled key instead of switching once to a single spare.
 *
 * Sticky cooldown policy:
 * - `billing` (欠费): skip the primary while cooling — retries are futile.
 * - `quota` / rate-limit: **still try the primary first**. MiniMax Token Plan
 *   caps recover within seconds/minutes; skipping it forced Volcengine even
 *   when MiniMax already had budget again.
 */
export async function withProviderPoolFailover<T>(
  modality: Modality,
  primaryProvider: ProviderName,
  runPrimary: () => Promise<T>,
  runWith: (config: ResolvedProviderConfig) => Promise<T>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<T> {
  const now = Date.now();
  const pool = resolveProviderPool(modality, undefined, env);
  const primaryEntry = pool.find(
    (entry) => entry.tier === 'primary' && entry.config.provider === primaryProvider,
  );

  // Single-candidate pool: nothing to rotate to, so behave like a plain call
  // and let the caller's own error handling take over.
  if (pool.length <= 1) {
    try {
      const result = await runPrimary();
      if (primaryEntry) markPoolSuccess(primaryEntry.id);
      return result;
    } catch (error) {
      if (primaryEntry) markPoolFailure(primaryEntry.id, error, env, now);
      throw error;
    }
  }

  const primaryHealth = primaryEntry ? ensureHealth(primaryEntry.id) : null;
  const primaryBillingParked =
    Boolean(primaryEntry) &&
    isPoolEntryCoolingDown(primaryEntry!.id, now) &&
    primaryHealth?.lastKind === 'billing';

  interface Attempt {
    readonly entry: ProviderPoolEntry;
    readonly call: () => Promise<T>;
  }
  const attempts: Attempt[] = [];
  // Always prefer the configured primary unless it is in arrears cooldown.
  if (primaryEntry && !primaryBillingParked) {
    attempts.push({ entry: primaryEntry, call: runPrimary });
  }
  for (const entry of orderPoolCandidates(pool, now)) {
    if (primaryEntry && entry.id === primaryEntry.id) continue;
    attempts.push({ entry, call: () => runWith(entry.config) });
  }
  // Last resort: try a billing-parked primary anyway rather than hard-fail.
  if (primaryEntry && primaryBillingParked) {
    attempts.push({ entry: primaryEntry, call: runPrimary });
  }

  let lastError: unknown;
  for (let i = 0; i < attempts.length; i += 1) {
    const attempt = attempts[i]!;
    try {
      const result = await attempt.call();
      markPoolSuccess(attempt.entry.id);
      return result;
    } catch (error) {
      lastError = error;
      const kind = markPoolFailure(attempt.entry.id, error, env, Date.now());
      if (kind === 'error' || i === attempts.length - 1) throw error;
      const snippet =
        error instanceof Error
          ? error.message.replace(/\s+/g, ' ').slice(0, 160)
          : String(error ?? '').slice(0, 160);
      console.warn(
        `[provider-pool] ${modality} ${attempt.entry.config.provider} key…${attempt.entry.config.apiKey.slice(-4)} ${kind} — rotating (${i + 2}/${attempts.length}): ${snippet}`,
      );
    }
  }
  throw lastError;
}

/** Sanitized pool snapshot; safe to log or render. */
export function describeProviderPool(
  modality: Modality,
  fromConfig?: OpenGameProvidersSettings,
  env: NodeJS.ProcessEnv = process.env,
  now: number = Date.now(),
): ProviderPoolStatusEntry[] {
  return orderPoolCandidates(
    resolveProviderPool(modality, fromConfig, env),
    now,
  ).map((entry) => {
    const state = ensureHealth(entry.id);
    return {
      id: entry.id,
      tier: entry.tier,
      provider: entry.config.provider,
      baseUrl: entry.config.baseUrl,
      model: entry.config.model,
      keyHint: entry.config.apiKey.slice(-4),
      score: Number(state.score.toFixed(3)),
      successes: state.successes,
      failures: state.failures,
      coolingDown: state.cooldownUntil > now,
      cooldownMsRemaining: Math.max(0, state.cooldownUntil - now),
      lastKind: state.lastKind,
    };
  });
}

/** Reset all health state. Tests only — production wants the process-wide memory. */
export function resetProviderPoolHealth(): void {
  health.clear();
}
