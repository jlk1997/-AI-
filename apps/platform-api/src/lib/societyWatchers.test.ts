/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import {
  countSocietyWatchers,
  countSocietyWatchersMany,
  leaveSocietyWatcher,
  societyWatcherTicket,
  societyWatchersKey,
  touchSocietyWatcher,
  type SocietyWatchersRedis,
} from './societyWatchers.js';

function memoryRedis(): SocietyWatchersRedis & {
  readonly store: Map<string, Map<string, number>>;
} {
  const store = new Map<string, Map<string, number>>();
  const members = (key: string): Map<string, number> => {
    const existing = store.get(key);
    if (existing) return existing;
    const next = new Map<string, number>();
    store.set(key, next);
    return next;
  };
  return {
    store,
    async zadd(key, score, member) {
      members(key).set(member, score);
    },
    async zrem(key, member) {
      members(key).delete(member);
    },
    async zremrangebyscore(key, min, max) {
      const lo = min === '-inf' ? Number.NEGATIVE_INFINITY : Number(min);
      const hi = max === '+inf' ? Number.POSITIVE_INFINITY : Number(max);
      const bag = members(key);
      for (const [member, score] of bag) {
        if (score >= lo && score <= hi) bag.delete(member);
      }
    },
    async zcard(key) {
      return members(key).size;
    },
    async expire() {
      /* ttl is owned by Redis in prod; the mock keeps the set */
    },
  };
}

describe('society watchers', () => {
  it('names the set per world', () => {
    expect(societyWatchersKey('w1')).toBe('society:watchers:w1');
  });

  it('gives each tab its own ticket so one leave cannot evict the other', () => {
    expect(
      societyWatcherTicket({ userId: 'u1', tab: 'aaaaaaaa' }),
    ).toBe('user:u1:aaaaaaaa');
    expect(
      societyWatcherTicket({ userId: 'u1', tab: 'bbbbbbbb' }),
    ).toBe('user:u1:bbbbbbbb');
    expect(societyWatcherTicket({ ip: '1.1.1.1', tab: 'bad tab!' })).toBe(
      'anon:1.1.1.1:main',
    );
  });

  it('keeps one tab of the same user after the other tab leaves', async () => {
    const redis = memoryRedis();
    const now = 1_700_000_000_000;
    const a = societyWatcherTicket({ userId: 'u1', tab: 'aaaaaaaa' });
    const b = societyWatcherTicket({ userId: 'u1', tab: 'bbbbbbbb' });
    await touchSocietyWatcher(redis, 'w1', a, now);
    await touchSocietyWatcher(redis, 'w1', b, now);
    expect(await leaveSocietyWatcher(redis, 'w1', a, now)).toBe(1);
  });

  it('does not drop the town when another guest is still in the set', async () => {
    const redis = memoryRedis();
    const now = 1_700_000_000_000;
    expect(await touchSocietyWatcher(redis, 'w1', 'user:a', now)).toBe(1);
    expect(await touchSocietyWatcher(redis, 'w1', 'anon:1.1.1.1', now)).toBe(2);
    expect(await leaveSocietyWatcher(redis, 'w1', 'anon:1.1.1.1', now)).toBe(1);
    expect(await countSocietyWatchers(redis, 'w1', now)).toBe(1);
    expect(await leaveSocietyWatcher(redis, 'w1', 'user:a', now)).toBe(0);
  });

  it('counts many worlds without mixing their sets', async () => {
    const redis = memoryRedis();
    const now = 1_700_000_000_000;
    await touchSocietyWatcher(redis, 'w1', 'a', now);
    await touchSocietyWatcher(redis, 'w1', 'b', now);
    await touchSocietyWatcher(redis, 'w2', 'c', now);
    const counts = await countSocietyWatchersMany(redis, ['w1', 'w2', 'w1'], now);
    expect(counts.get('w1')).toBe(2);
    expect(counts.get('w2')).toBe(1);
  });

  it('prunes a crashed tab whose heartbeat has expired', async () => {
    const redis = memoryRedis();
    const now = 1_700_000_000_000;
    await touchSocietyWatcher(redis, 'w1', 'stale', now - 10 * 60_000);
    expect(await countSocietyWatchers(redis, 'w1', now)).toBe(0);
  });
});
