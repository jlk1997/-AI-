/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import { SOCIETY_TALK_BUDGET } from '@opengame/platform-shared';

import {
  consumeEmergencySocietyTalk,
  peekSocietyTalkBudget,
  reserveSocietyTalks,
  societyTalkBudgetOpen,
} from './societyTalkBudget.js';

describe('API society talk budget', () => {
  it('fails closed without Redis and when the world hour is spent', async () => {
    const now = Date.parse('2026-08-20T04:10:00.000Z');
    await expect(societyTalkBudgetOpen(undefined, 'w1', now)).resolves.toBe(false);

    const store = new Map<string, number>([
      ['society:talks:w1:2026-08-20T04', SOCIETY_TALK_BUDGET.worldHour],
    ]);
    const redis = {
      get: async (key: string) =>
        store.has(key) ? String(store.get(key)) : null,
      incrby: async (key: string, n: number) => {
        const next = (store.get(key) ?? 0) + n;
        store.set(key, next);
        return next;
      },
      expire: async () => 1,
    };
    await expect(societyTalkBudgetOpen(redis, 'w1', now)).resolves.toBe(false);
    await expect(societyTalkBudgetOpen(redis, 'w2', now)).resolves.toBe(false);
    const lit = { litUntil: new Date(now + 86_400_000) };
    await expect(societyTalkBudgetOpen(redis, 'w2', now, lit)).resolves.toBe(true);
    const view = await peekSocietyTalkBudget(redis, 'w2', now, lit);
    expect(view?.remaining).toBe(SOCIETY_TALK_BUDGET.worldHour);
    const after = await peekSocietyTalkBudget(redis, 'w2', now);
    expect(after?.remaining).toBe(0);
  });

  it('rolls back a reserve that would pass the hourly cap', async () => {
    const now = Date.parse('2026-08-20T04:10:00.000Z');
    const store = new Map<string, number>([
      ['society:talks:w1:2026-08-20T04', SOCIETY_TALK_BUDGET.worldHour - 1],
    ]);
    const redis = {
      get: async (key: string) =>
        store.has(key) ? String(store.get(key)) : null,
      incrby: async (key: string, n: number) => {
        const next = (store.get(key) ?? 0) + n;
        store.set(key, next);
        return next;
      },
      expire: async () => 1,
    };
    await expect(reserveSocietyTalks(redis, 'w1', 2, now)).resolves.toBe(false);
    expect(store.get('society:talks:w1:2026-08-20T04')).toBe(
      SOCIETY_TALK_BUDGET.worldHour - 1,
    );
    await expect(reserveSocietyTalks(redis, 'w1', 1, now)).resolves.toBe(false);
    expect(store.get('society:talks:w1:2026-08-20T04')).toBe(
      SOCIETY_TALK_BUDGET.worldHour - 1,
    );
  });

  it('does not spend platform 80 when a lit town burns past its free 36', async () => {
    const now = Date.parse('2026-08-20T04:10:00.000Z');
    const store = new Map<string, number>([
      ['society:talks:a:2026-08-20T04', SOCIETY_TALK_BUDGET.worldHour],
      ['society:talks:_platform:2026-08-20T04', SOCIETY_TALK_BUDGET.worldHour],
    ]);
    const redis = {
      get: async (key: string) =>
        store.has(key) ? String(store.get(key)) : null,
      incrby: async (key: string, n: number) => {
        const next = (store.get(key) ?? 0) + n;
        store.set(key, next);
        return next;
      },
      expire: async () => 1,
    };
    await expect(
      reserveSocietyTalks(redis, 'a', 1, now, {
        leaseBonus: 12,
        litUntil: new Date(now + 3_600_000),
      }),
    ).resolves.toBe('lit');
    expect(store.get('society:talks:_platform:2026-08-20T04')).toBe(
      SOCIETY_TALK_BUDGET.worldHour,
    );
    await expect(reserveSocietyTalks(redis, 'b', 1, now)).resolves.toBe(false);
    expect(store.get('society:talks:_platform:2026-08-20T04')).toBe(
      SOCIETY_TALK_BUDGET.worldHour,
    );
  });

  it('refuses emergency talks without Redis and after the hour cap', async () => {
    const now = Date.parse('2026-08-20T04:10:00.000Z');
    await expect(consumeEmergencySocietyTalk(undefined, now)).resolves.toBe(
      false,
    );
    const store = new Map<string, number>();
    const redis = {
      get: async (key: string) =>
        store.has(key) ? String(store.get(key)) : null,
      incrby: async (key: string, n: number) => {
        const next = (store.get(key) ?? 0) + n;
        store.set(key, next);
        return next;
      },
      expire: async () => 1,
    };
    await expect(consumeEmergencySocietyTalk(redis, now)).resolves.toBe(true);
    expect(store.get('society:talks:emergency:2026-08-20T04')).toBe(1);
  });
});
