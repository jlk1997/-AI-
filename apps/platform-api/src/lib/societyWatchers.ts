/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Concurrent watchers for a published town. Members expire so a crashed tab
 * cannot hold the heartbeat forever. Leave only clears the town clock when
 * the set is empty.
 */

import { SOCIETY_PRESENCE_TTL_MS } from '@opengame/platform-shared';

export type SocietyWatchersRedis = {
  zadd(key: string, score: number, member: string): Promise<unknown>;
  zrem(key: string, member: string): Promise<unknown>;
  zremrangebyscore(key: string, min: number | string, max: number | string): Promise<unknown>;
  zcard(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
};

export function societyWatchersKey(worldId: string): string {
  return `society:watchers:${worldId}`;
}

const TAB_RE = /^[a-zA-Z0-9_-]{4,40}$/;

/** One browser tab = one ZSET member, so closing tab A cannot evict tab B. */
export function societyWatcherTab(raw?: string | null): string {
  const tab = raw?.trim() ?? '';
  return TAB_RE.test(tab) ? tab : 'main';
}

export function societyWatcherTicket(input: {
  readonly userId?: string | null;
  readonly ip?: string | null;
  readonly tab?: string | null;
}): string {
  const tab = societyWatcherTab(input.tab);
  if (input.userId) return `user:${input.userId}:${tab}`;
  return `anon:${input.ip?.trim() || '0'}:${tab}`;
}

async function pruneAndCount(
  redis: SocietyWatchersRedis,
  key: string,
  now: number,
): Promise<number> {
  await redis.zremrangebyscore(key, '-inf', now);
  return redis.zcard(key);
}

export async function touchSocietyWatcher(
  redis: SocietyWatchersRedis,
  worldId: string,
  ticket: string,
  now = Date.now(),
): Promise<number> {
  const key = societyWatchersKey(worldId);
  const expireAt = now + SOCIETY_PRESENCE_TTL_MS;
  await redis.zadd(key, expireAt, ticket);
  await redis.expire(key, Math.ceil((SOCIETY_PRESENCE_TTL_MS * 2) / 1000));
  return pruneAndCount(redis, key, now);
}

export async function leaveSocietyWatcher(
  redis: SocietyWatchersRedis,
  worldId: string,
  ticket: string,
  now = Date.now(),
): Promise<number> {
  const key = societyWatchersKey(worldId);
  await redis.zrem(key, ticket);
  return pruneAndCount(redis, key, now);
}

export async function countSocietyWatchers(
  redis: SocietyWatchersRedis,
  worldId: string,
  now = Date.now(),
): Promise<number> {
  return pruneAndCount(redis, societyWatchersKey(worldId), now);
}

export async function countSocietyWatchersMany(
  redis: SocietyWatchersRedis,
  worldIds: readonly string[],
  now = Date.now(),
): Promise<Map<string, number>> {
  const unique = [...new Set(worldIds.filter(Boolean))];
  const pairs = await Promise.all(
    unique.map(async (id) => [id, await countSocietyWatchers(redis, id, now)] as const),
  );
  return new Map(pairs);
}
