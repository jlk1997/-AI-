/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Privacy and money routes fail closed when Redis (revoke / rate-limit) is down.
 * Alley browse stays fail-open so a Redis blip does not empty the street.
 */

export function isTightAuthedPath(path: string): boolean {
  return (
    /\/me\/(export|delete)/.test(path) ||
    /\/appeals/.test(path) ||
    // Checkout / orders / invite only. GET market (开镇礼) and wallet reads
    // share the alley bucket — the old /billing/ blanket 429'd daily claim.
    /\/billing\/(orders|checkout|link|invite)/.test(path) ||
    /\/world\/light/.test(path) ||
    /\/world-light/.test(path) ||
    /\/town-time/.test(path) ||
    /\/(tip|jiaxi|play-session|adopt)\b/.test(path) ||
    /\/course\/(stake|withdraw)/.test(path)
  );
}

function isWrite(method: string): boolean {
  const verb = method.toUpperCase();
  return verb !== 'GET' && verb !== 'HEAD' && verb !== 'OPTIONS';
}

/** Generate / retry enqueue. Must not share a Redis counter with job polls. */
export function isGenerateSpendRequest(method: string, path: string): boolean {
  if (!isWrite(method)) return false;
  return (
    /\/messages$/.test(path) ||
    /\/jobs\/[^/]+\/retry$/.test(path) ||
    /\/requeue$/.test(path)
  );
}

/** Generate / publish spend: POST only. GET job status stays fail-open. */
export function isTightAuthedRequest(method: string, path: string): boolean {
  if (isTightAuthedPath(path)) return true;
  if (!isWrite(method)) return false;
  return (
    isGenerateSpendRequest(method, path) ||
    /\/build$/.test(path) ||
    /\/publish$/.test(path) ||
    /\/fork$/.test(path)
  );
}

export type AuthedRateLimitKind = 'generate' | 'tight' | 'alley';

/**
 * Studio polls (jobs, heartbeat, wallet) used to INCR the same `v1u` key as
 * `POST /messages`. After ~10 reads in a minute the next generate 429'd even
 * though the user had not generated yet. Each kind now has its own keys.
 */
export function authedRateLimitKind(
  method: string,
  path: string,
): AuthedRateLimitKind {
  if (isGenerateSpendRequest(method, path)) return 'generate';
  if (isTightAuthedRequest(method, path)) return 'tight';
  return 'alley';
}

export function authedRateLimitSpec(
  method: string,
  path: string,
  userId: string,
  ip: string,
): {
  readonly kind: AuthedRateLimitKind;
  readonly userKey: string;
  readonly ipKey: string;
  readonly userLimit: number;
  readonly ipLimit: number;
} {
  const kind = authedRateLimitKind(method, path);
  if (kind === 'generate') {
    return {
      kind,
      userKey: `v1gen:${userId}`,
      ipKey: `v1genip:${ip}`,
      userLimit: 15,
      ipLimit: 40,
    };
  }
  if (kind === 'tight') {
    return {
      kind,
      userKey: `v1tight:${userId}`,
      ipKey: `v1tightip:${ip}`,
      userLimit: 10,
      ipLimit: 20,
    };
  }
  return {
    kind,
    userKey: `v1u:${userId}`,
    ipKey: `v1ip:${ip}`,
    userLimit: 120,
    ipLimit: 240,
  };
}

/**
 * Anonymous /v1 (magic, share cards, catalog). Play-session assets are many
 * files per game — do not fold them into the same minute bucket.
 */
export function shouldRateLimitAnonymousV1(path: string): boolean {
  // Signed play and studio preview assets are dozens of files per town.
  // Folding them into the anonymous minute bucket 429s walk sheets, and the
  // stage then swaps those people onto a different fallback face.
  return !/\/play\//.test(path) && !/\/preview-dist\//.test(path);
}
