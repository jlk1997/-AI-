/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Fixed-window caps for expensive community writes. Presence / comments /
 * ratings may fail open so a Redis blip does not freeze the alley. Money
 * paths (tip / 加戏 / play-session) fail closed — a cache outage must not
 * mint unlimited drinks.
 */

import type { Redis } from 'ioredis';

/** Fixed hourly buckets for expensive community writes. */
export const HOURLY_CAPS = {
  tip: 20,
  jiaxi: 12,
  comment: 30,
  rating: 20,
  playSession: 40,
  presence: 180,
  report: 12,
} as const;

export const FAIL_CLOSED_CAP_PREFIXES = [
  'tip:',
  'jiaxi:',
  'play-session:',
  'report:',
] as const;

export function hourlyCapFailsClosed(bucketKey: string): boolean {
  return FAIL_CLOSED_CAP_PREFIXES.some((prefix) => bucketKey.startsWith(prefix));
}

export async function assertHourlyCap(
  redis: Redis,
  bucketKey: string,
  limit: number,
  ttlSec = 3_600,
): Promise<boolean> {
  try {
    const used = await redis.incr(bucketKey);
    if (used === 1) await redis.expire(bucketKey, ttlSec);
    return used <= limit;
  } catch {
    return !hourlyCapFailsClosed(bucketKey);
  }
}
