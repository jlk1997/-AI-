/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Heartbeat talks run after the walk lock is released. If persist cannot
 * re-acquire the lock, park the spoken events for the next sweep instead of
 * keeping the slot and losing the line.
 */

export interface TalkRetryRedis {
  rpush(key: string, ...values: string[]): Promise<unknown>;
  expire(key: string, seconds: number): Promise<unknown>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  del(key: string): Promise<unknown>;
}

export const TALK_RETRY_TTL_SECONDS = 7_200;

export function talkRetryKey(worldId: string): string {
  return `society:talk-retry:${worldId}`;
}

export function asTalkRetryRedis(redis: object): TalkRetryRedis {
  return redis as TalkRetryRedis;
}

export async function enqueueTalkPersistRetry(
  redis: TalkRetryRedis,
  worldId: string,
  events: readonly unknown[],
): Promise<boolean> {
  if (events.length === 0) return true;
  try {
    const key = talkRetryKey(worldId);
    await redis.rpush(key, JSON.stringify(events));
    await redis.expire(key, TALK_RETRY_TTL_SECONDS);
    return true;
  } catch {
    return false;
  }
}

export async function drainTalkPersistRetry(
  redis: TalkRetryRedis,
  worldId: string,
): Promise<unknown[]> {
  const key = talkRetryKey(worldId);
  try {
    const raw = await redis.lrange(key, 0, -1);
    await redis.del(key);
    const out: unknown[] = [];
    for (const item of raw) {
      try {
        const parsed = JSON.parse(item) as unknown;
        if (Array.isArray(parsed)) out.push(...parsed);
      } catch {
        /* skip a corrupt batch */
      }
    }
    return out;
  } catch {
    return [];
  }
}
