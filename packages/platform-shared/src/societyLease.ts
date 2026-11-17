/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Two clocks, one town:
 * - presence (`heartbeatUntil`) — someone is on the page (minutes).
 *   Nobody on the page: walk only, no model talks.
 * - author funding (`lightUntil`) — publish-time 点亮 or visitor 打赏.
 *   While funded, 36/80 must not mute. Author may still pause the clock.
 * - leftover town time / author watch — studio and old orders, not visitor SKUs.
 */

export function leaseActive(
  until: Date | string | null | undefined,
  now = Date.now(),
): boolean {
  if (until == null) return false;
  const t = until instanceof Date ? until.getTime() : Date.parse(String(until));
  return Number.isFinite(t) && t > now;
}

export function societyTalksAllowed(input: {
  readonly presenceUntil?: Date | string | null;
  readonly authorWatchUntil?: Date | string | null;
  readonly townTimeUntil?: Date | string | null;
  readonly now?: number;
}): boolean {
  const now = input.now ?? Date.now();
  return leaseActive(input.presenceUntil, now);
}

/**
 * Why MiniMax must stay off. Empty page and leftover author-watch never talk.
 */
export function societyTalkMuteReason(input: {
  readonly presenceUntil?: Date | string | null;
  readonly authorWatchUntil?: Date | string | null;
  readonly townTimeUntil?: Date | string | null;
  readonly generateBusy?: boolean;
  readonly hasLlm?: boolean;
  readonly budgetOpen?: boolean;
  readonly clockPaused?: boolean;
  readonly now?: number;
}): 'generate' | 'unwatched' | 'no_permit' | 'no_key' | 'budget' | null {
  const now = input.now ?? Date.now();
  if (input.generateBusy) return 'generate';
  if (input.clockPaused) return 'unwatched';
  if (!leaseActive(input.presenceUntil, now)) return 'unwatched';
  // `no_permit` stays on the union for live-frame skip reasons.
  // Talks no longer gate on leftover town-time / 开口许可.
  if (input.budgetOpen === false) return 'budget';
  if (input.hasLlm === false) return 'no_key';
  return null;
}

/** Community badge: walking vs speaking. */
export function townPresenceBadge(input: {
  readonly presenceUntil?: Date | string | null;
  readonly authorWatchUntil?: Date | string | null;
  readonly townTimeUntil?: Date | string | null;
  readonly litUntil?: Date | string | null;
  readonly now?: number;
}): { readonly living: boolean; readonly speaking: boolean } {
  const now = input.now ?? Date.now();
  const living = leaseActive(input.presenceUntil, now);
  return {
    living,
    speaking: living && leaseActive(input.litUntil, now),
  };
}

/** Catalog order: talking towns first, then walking, then idle. */
export function townCatalogHeat(status: {
  readonly living?: boolean;
  readonly speaking?: boolean;
} | null | undefined): number {
  if (!status) return 0;
  if (status.speaking) return 2;
  if (status.living) return 1;
  return 0;
}

export function stackPermitUntil(
  current: Date | null | undefined,
  now: Date,
  durationMs: number,
): Date {
  const ms = Math.max(0, Math.round(durationMs));
  const base =
    current && current.getTime() > now.getTime() ? current.getTime() : now.getTime();
  return new Date(base + ms);
}

/**
 * Community presence ping. Visitors must not restart a clock the author paused,
 * and must not wipe an author who is still on the observatory.
 */
export function guestPresenceDecision(input: {
  readonly leave?: boolean;
  readonly clockPaused?: boolean;
  readonly authorWatchUntil?: Date | string | null;
  readonly remainingWatchers?: number;
  readonly now?: number;
}): 'paused' | 'keep_author' | 'keep_watchers' | 'clear' | 'extend' {
  const now = input.now ?? Date.now();
  if (input.leave) {
    if (leaseActive(input.authorWatchUntil, now)) return 'keep_author';
    if ((input.remainingWatchers ?? 0) > 0) return 'keep_watchers';
    return 'clear';
  }
  if (input.clockPaused) return 'paused';
  return 'extend';
}

/**
 * What the presence UPDATE is allowed to touch. The decision above is
 * advisory; the SQL must still refuse to plant a lease on a frozen clock
 * or wipe an author who arrived between the read and the write.
 */
export function guestPresenceWriteGuard(input: {
  readonly action: 'extend' | 'clear';
  readonly clockPaused?: boolean;
  readonly authorWatchUntil?: Date | string | null;
  readonly remainingWatchers?: number;
  readonly now?: number;
}): 'extend' | 'clear' | 'paused' | 'keep' {
  if (input.action === 'extend') {
    return input.clockPaused ? 'paused' : 'extend';
  }
  if (leaseActive(input.authorWatchUntil, input.now ?? Date.now())) {
    return 'keep';
  }
  if ((input.remainingWatchers ?? 0) > 0) return 'keep';
  return 'clear';
}

/** Hidden tab is not "someone staying on the page". */
export const PRESENCE_HIDDEN_GRACE_MS = 90_000;
/** Guest / author presence refresh. Crash leftovers must not hold a sweep slot long. */
export const SOCIETY_PRESENCE_TTL_MS = 8 * 60_000;
/** Author-watch is shorter so a leftover studio lease cannot gift guests free talks. */
export const SOCIETY_AUTHOR_WATCH_TTL_MS = 4 * 60_000;
/** Crafted `ttlMinutes` must not buy hours of MiniMax. */
export const SOCIETY_PRESENCE_TTL_MAX_MS = 15 * 60_000;

export function clampSocietyPresenceTtlMs(ttlMs: number): number {
  const ms = Number.isFinite(ttlMs) ? Math.round(ttlMs) : SOCIETY_PRESENCE_TTL_MS;
  return Math.min(
    SOCIETY_PRESENCE_TTL_MAX_MS,
    Math.max(60_000, ms),
  );
}

export function authorWatchTtlMs(presenceTtlMs: number): number {
  return Math.min(SOCIETY_AUTHOR_WATCH_TTL_MS, clampSocietyPresenceTtlMs(presenceTtlMs));
}

export function presenceWhilePageVisible(input: {
  readonly hiddenSince: number | null;
  readonly now?: number;
  readonly graceMs?: number;
}): 'ping' | 'hold' | 'leave' {
  const now = input.now ?? Date.now();
  if (input.hiddenSince == null) return 'ping';
  const grace = input.graceMs ?? PRESENCE_HIDDEN_GRACE_MS;
  return now - input.hiddenSince >= grace ? 'leave' : 'hold';
}
