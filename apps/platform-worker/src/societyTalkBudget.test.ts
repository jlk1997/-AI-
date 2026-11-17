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
  settleSocietyTalks,
  societyTalkBudgetOpen,
} from './societyTalkBudget.js';

describe('societyTalkBudget redis wrapper', () => {
  it('opens when under both caps and closes when either is spent', async () => {
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
    const now = Date.parse('2026-08-20T04:10:00.000Z');
    const lit = { litUntil: new Date(now + 86_400_000) };
    await expect(societyTalkBudgetOpen(redis, 'w1', now)).resolves.toBe(false);
    await expect(societyTalkBudgetOpen(redis, 'w2', now)).resolves.toBe(false);
    await expect(societyTalkBudgetOpen(redis, 'w2', now, lit)).resolves.toBe(true);
    const view = await peekSocietyTalkBudget(redis, 'w2', now, lit);
    expect(view?.remaining).toBe(SOCIETY_TALK_BUDGET.worldHour);
  });

  it('returns unused reserved slots after a skipped talk', async () => {
    const store = new Map<string, number>([
      ['society:talks:w1:2026-08-20T04', 4],
      ['society:talks:_platform:2026-08-20T04', 4],
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
    const now = Date.parse('2026-08-20T04:10:00.000Z');
    await settleSocietyTalks(redis, 'w1', 1, 0, now);
    expect(store.get('society:talks:w1:2026-08-20T04')).toBe(3);
    expect(store.get('society:talks:_platform:2026-08-20T04')).toBe(3);
  });

  it('fails closed when Redis is missing', async () => {
    await expect(societyTalkBudgetOpen(undefined, 'w1')).resolves.toBe(false);
  });

  it('fails closed when Redis cannot be read', async () => {
    await expect(
      societyTalkBudgetOpen(
        {
          get: async () => {
            throw new Error('down');
          },
          incrby: async () => 0,
          expire: async () => 1,
        },
        'w1',
      ),
    ).resolves.toBe(false);
  });

  it('lets a lit town talk without eating another town’s platform floor', async () => {
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
    await settleSocietyTalks(redis, 'a', 1, 0, now, 'lit');
    expect(store.get('society:talks:lit:a:2026-08-20T04')).toBeUndefined();
    expect(store.get('society:talks:_platform:2026-08-20T04')).toBe(
      SOCIETY_TALK_BUDGET.worldHour,
    );
  });

  it('keeps a funded town open after the 36/80 floor is spent', async () => {
    const now = Date.parse('2026-08-20T04:10:00.000Z');
    const store = new Map<string, number>([
      ['society:talks:a:2026-08-20T04', SOCIETY_TALK_BUDGET.worldHour],
      ['society:talks:_platform:2026-08-20T04', SOCIETY_TALK_BUDGET.platformHour],
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
      societyTalkBudgetOpen(redis, 'a', now, {
        litUntil: new Date(now + 86_400_000),
      }),
    ).resolves.toBe(true);
    await expect(societyTalkBudgetOpen(redis, 'a', now)).resolves.toBe(false);
  });

  it('refuses emergency talks without Redis so Ark cannot run unbounded', async () => {
    await expect(consumeEmergencySocietyTalk(undefined)).resolves.toBe(false);
  });
});
