/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Wall-clock budgeting for the generate self-heal loop.
 *
 * A fixed attempt count is a poor cost proxy: the same 4 rounds can cost 4
 * minutes or 50 depending on how long each CLI round wanders. We bound the loop
 * by elapsed time instead, and shrink the per-round CLI timeout as rounds get
 * smaller in scope (CODE authors a game; FIX patches a few lines).
 */

/** Default 20 minutes for the CLI/FIX/smoke self-heal loop (excludes pre-CLI art). */
export const DEFAULT_TIME_BUDGET_MS = 1_200_000;
export const DEFAULT_CLI_TIMEOUT_MS = 600_000;
/** Never give a round less than this, or slow providers can never finish. */
export const MIN_CLI_TIMEOUT_MS = 120_000;
/**
 * Stop opening new CLI rounds after this many back-to-back hard timeouts.
 * Short FIX rounds after a hung CODE almost never recover and just burn budget.
 */
export const MAX_CONSECUTIVE_CLI_HARD_TIMEOUTS = 2;

export function readGenerationTimeBudgetMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env['PLATFORM_GENERATION_TIME_BUDGET_MS'];
  if (!raw?.trim()) return DEFAULT_TIME_BUDGET_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 60_000
    ? Math.floor(n)
    : DEFAULT_TIME_BUDGET_MS;
}

export function readBaseCliTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = Number(env['PLATFORM_CLI_TIMEOUT_MS'] ?? DEFAULT_CLI_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_CLI_TIMEOUT_MS;
}

/** True when remaining wall-clock can still host a useful CLI round. */
export function hasUsefulCliBudget(remainingBudgetMs: number): boolean {
  return remainingBudgetMs >= MIN_CLI_TIMEOUT_MS;
}

/**
 * Round 1 keeps the full base; later FIX rounds decay gently.
 * Never returns more than `remainingBudgetMs` when that value is positive —
 * inflating past the remaining budget used to start doomed 120s rounds after
 * the 20-minute loop was already spent.
 *
 * MiniMax FIX often needs >3 minutes; /3 then /4 caused false hard-timeouts
 * after smoke already passed (quality-only polish).
 */
export function resolveCliTimeoutForAttempt(options: {
  readonly attempt: number;
  readonly remainingBudgetMs: number;
  readonly baseTimeoutMs?: number;
  /** Treat as CODE (full base) even when attempt > 1 — e.g. first CODE hung. */
  readonly forceFullTimeout?: boolean;
}): number {
  const base = options.baseTimeoutMs ?? readBaseCliTimeoutMs();
  const useFull =
    options.forceFullTimeout === true || options.attempt <= 1;
  const decayed = useFull
    ? base
    : options.attempt === 2
      ? Math.round(base / 2)
      : Math.round(base / 2.5);
  const floor = Math.min(base, MIN_CLI_TIMEOUT_MS);
  let timeout = useFull ? decayed : Math.max(floor, decayed);

  if (options.remainingBudgetMs > 0) {
    timeout = Math.min(timeout, options.remainingBudgetMs);
  }

  // Apply the floor only when the remaining budget can actually afford it.
  if (options.remainingBudgetMs >= floor) {
    timeout = Math.max(floor, timeout);
  }

  return Math.max(0, Math.floor(timeout));
}
