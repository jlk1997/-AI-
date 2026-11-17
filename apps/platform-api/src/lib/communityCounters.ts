/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Chart numbers must survive a burst of play-url / fork traffic. Read-modify-write
 * on play_count / remix_count loses updates; SQL increment does not.
 */

import { eq, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';

import type { DrizzleDb } from '@opengame/platform-db';
import { communityDayStats, communityGames } from '@opengame/platform-db';

import { chinaDayKey } from './kaiMarket.js';

/** One chart key per visitor: signed-in users share a key across devices/IPs. */
export function playVisitorKey(userId: string | null | undefined, ip: string): string {
  const uid = userId?.trim();
  if (uid) return `user:${uid}`;
  return `ip:${ip.trim() || 'anon'}`;
}

/**
 * Guest-then-login on the same hop must not count twice. IP is always present
 * so the login visit can see the earlier guest play-url hit.
 */
export function playHitKeys(userId: string | null | undefined, ip: string): string[] {
  const ipKey = `ip:${ip.trim() || 'anon'}`;
  const uid = userId?.trim();
  return uid ? [ipKey, `user:${uid}`] : [ipKey];
}

export function playHitRedisKeys(gameId: string, visitorKeys: readonly string[]): string[] {
  return visitorKeys.map((key) => `play:hit:${gameId}:${key}`);
}

/**
 * KEYS[1] is the IP (or sole) lock. Companions (user:…) follow.
 * If any key already exists, stamp the rest and refuse a second increment.
 */
export const CLAIM_PLAY_HITS_LUA = `
if redis.call('EXISTS', KEYS[1]) == 1 then
  for i = 2, #KEYS do redis.call('SET', KEYS[i], '1', 'EX', ARGV[1]) end
  return 0
end
for i = 2, #KEYS do
  if redis.call('EXISTS', KEYS[i]) == 1 then
    for j = 1, #KEYS do redis.call('SET', KEYS[j], '1', 'EX', ARGV[1]) end
    return 0
  end
end
if not redis.call('SET', KEYS[1], '1', 'EX', ARGV[1], 'NX') then
  return 0
end
for i = 2, #KEYS do redis.call('SET', KEYS[i], '1', 'EX', ARGV[1]) end
return 1
`;

export function requestClientIp(headers: {
  readonly forwarded?: string | null;
  readonly cf?: string | null;
}): string {
  return headers.forwarded?.split(',')[0]?.trim() || headers.cf?.trim() || 'anon';
}

export async function bumpDayStat(
  db: DrizzleDb,
  gameId: string,
  field: 'plays' | 'remixes',
  day = chinaDayKey(),
): Promise<void> {
  await db
    .insert(communityDayStats)
    .values({
      gameId,
      chinaDay: day,
      plays: field === 'plays' ? 1 : 0,
      remixes: field === 'remixes' ? 1 : 0,
    })
    .onConflictDoUpdate({
      target: [communityDayStats.gameId, communityDayStats.chinaDay],
      set:
        field === 'plays'
          ? { plays: sql`${communityDayStats.plays} + 1` }
          : { remixes: sql`${communityDayStats.remixes} + 1` },
    });
}

export async function bumpPlayCount(db: DrizzleDb, gameId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(communityGames)
      .set({ playCount: sql`${communityGames.playCount} + 1` })
      .where(eq(communityGames.id, gameId));
    await bumpDayStat(tx as unknown as DrizzleDb, gameId, 'plays');
  });
}

export async function bumpRemixCount(db: DrizzleDb, gameId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(communityGames)
      .set({ remixCount: sql`${communityGames.remixCount} + 1` })
      .where(eq(communityGames.id, gameId));
    await bumpDayStat(tx as unknown as DrizzleDb, gameId, 'remixes');
  });
}

/**
 * One counted play per visitor per work in `ttlSec`. Opening the detail JSON
 * must not farm the popular chart — only play-url / visit may call this.
 */
export async function bumpPlayCountOnce(
  db: DrizzleDb,
  redis: Redis,
  gameId: string,
  visitorKeys: string | readonly string[],
  ttlSec = 1_800,
): Promise<boolean> {
  const keys = typeof visitorKeys === 'string' ? [visitorKeys] : [...visitorKeys];
  if (keys.length === 0) return false;
  try {
    const allowed = await redis.eval(
      CLAIM_PLAY_HITS_LUA,
      keys.length,
      ...playHitRedisKeys(gameId, keys),
      String(ttlSec),
    );
    if (allowed !== 1) return false;
  } catch {
    /* Redis down: still increment; a few extras beat a frozen chart. */
  }
  await bumpPlayCount(db, gameId);
  return true;
}
