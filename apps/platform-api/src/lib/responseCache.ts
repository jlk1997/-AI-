/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Redis } from 'ioredis';

/**
 * Thin Redis-backed response cache for "hot read" endpoints (public games
 * list, plugin browse, bench leaderboard, etc).
 *
 * Design:
 *   - Keys are namespaced with `rcache:` so the rate-limit / pub-sub
 *     namespaces never collide.
 *   - Values are the **pre-serialized** JSON body so we only stringify once.
 *   - TTLs are short (30–300s) — long enough to absorb spikes but short
 *     enough that publish/unpublish actions stay visible within a minute.
 *   - SingleFlight semantics are NOT enforced here; if you need them, wrap
 *     this call with `redis.setnx` on a `rcache:lock:<key>` companion key.
 */
export interface CacheJsonOptions<T> {
  readonly redis: Redis;
  readonly key: string;
  readonly ttlSeconds: number;
  readonly producer: () => Promise<T>;
}

export async function cacheJson<T>(opts: CacheJsonOptions<T>): Promise<T> {
  const namespaced = `rcache:${opts.key}`;
  const hit = await opts.redis.get(namespaced).catch(() => null);
  if (hit) {
    try {
      return JSON.parse(hit) as T;
    } catch {
      // Bad cache entry — drop it and fall through to the producer.
      await opts.redis.del(namespaced).catch(() => undefined);
    }
  }
  const value = await opts.producer();
  await opts.redis
    .set(namespaced, JSON.stringify(value), 'EX', Math.max(1, opts.ttlSeconds))
    .catch(() => undefined);
  return value;
}

/** Invalidate one or more cache keys (e.g. after a mutation). */
export async function invalidateCache(redis: Redis, keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await redis.del(...keys.map((k) => `rcache:${k}`)).catch(() => undefined);
}
