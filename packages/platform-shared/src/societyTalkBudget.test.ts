/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import {
  SOCIETY_EMERGENCY_BUDGET,
  SOCIETY_TALK_BUDGET,
  SOCIETY_WORLD_LIGHT,
  activeLightBonus,
  grantHourLightBonusOn,
  orderLiveWorldsForCourse,
  pacedTalkSlotsThisWalk,
  peekEmergencyTalkOn,
  peekSocietyTalkBudgetOn,
  pickSocietyLlmLane,
  releaseSocietyTalksOn,
  reserveEmergencyTalkOn,
  reserveSocietyTalksOn,
  societyTalkBudgetOpenOn,
  tipExtendsLightMs,
  settleSocietyTalksOn,
  societyEmergencyTalkKey,
  societyTalkBudgetKeys,
  societyTalkBudgetView,
  societyTalkHourBonus,
  societyTalkHourResetsAt,
  societyTalkMinutesLeftInHour,
  talkFundingOpen,
  societyTalksOverBudget,
  stackWorldLight,
  talkBudgetReserveExceeded,
  type SocietyTalkBudgetRedis,
} from './societyTalkBudget.js';

function memoryRedis(init: Record<string, number> = {}): SocietyTalkBudgetRedis & {
  readonly store: Map<string, number>;
  readonly expires: string[];
} {
  const store = new Map<string, number>(Object.entries(init));
  const expires: string[] = [];
  const bump = (key: string, n: number): number => {
    const next = (store.get(key) ?? 0) + n;
    store.set(key, next);
    return next;
  };
  return {
    store,
    expires,
    get: async (key: string) => (store.has(key) ? String(store.get(key)) : null),
    incrby: async (key: string, n: number) => bump(key, n),
    expire: async (key: string) => {
      expires.push(key);
      return 1;
    },
    eval: async (script: string, numKeys: number, ...args: Array<string | number>) => {
      const keys = args.slice(0, numKeys).map(String);
      const argv = args.slice(numKeys);
      if (script.includes('og:society_reserve_talks')) {
        const count = Number(argv[0]);
        const worldCap = Number(argv[1]);
        const platformCap = Number(argv[2]);
        const leaseBonus = Math.max(0, Number(argv[3]) || 0);
        const worldUsed = bump(keys[0]!, count);
        const platUsed = bump(keys[1]!, count);
        expires.push(keys[0]!, keys[1]!);
        if (worldUsed <= worldCap && platUsed <= platformCap) return 'floor';
        bump(keys[0]!, -count);
        bump(keys[1]!, -count);
        const hourPack = Math.max(0, store.get(keys[3]!) ?? 0);
        const bonus = hourPack + leaseBonus;
        if (bonus <= 0) return 'none';
        const litUsed = bump(keys[2]!, count);
        expires.push(keys[2]!);
        if (litUsed <= bonus) return 'lit';
        bump(keys[2]!, -count);
        return 'none';
      }
      if (script.includes('og:society_release_talks')) {
        const n = Number(argv[0]);
        for (const key of keys) {
          const cur = store.get(key) ?? 0;
          if (cur > 0) bump(key, -Math.min(cur, n));
        }
        return 1;
      }
      if (script.includes('og:society_reserve_emergency')) {
        const cap = Number(argv[0]);
        if (cap <= 0) return 0;
        const after = bump(keys[0]!, 1);
        expires.push(keys[0]!);
        if (after <= cap) return 1;
        bump(keys[0]!, -1);
        return 0;
      }
      throw new Error(`unknown script ${script.slice(0, 40)}`);
    },
  };
}

describe('society talk budget', () => {
  it('keys one hour bucket per world and the whole platform', () => {
    const now = Date.parse('2026-08-20T04:15:00.000Z');
    expect(societyTalkBudgetKeys('w1', now)).toEqual({
      world: 'society:talks:w1:2026-08-20T04',
      platform: 'society:talks:_platform:2026-08-20T04',
      lit: 'society:talks:lit:w1:2026-08-20T04',
      litCap: 'society:talks:litcap:w1:2026-08-20T04',
    });
  });

  it('trips when either cap is spent', () => {
    expect(
      societyTalksOverBudget({
        worldUsed: SOCIETY_TALK_BUDGET.worldHour,
        platformUsed: 0,
      }),
    ).toBe(true);
    expect(
      societyTalksOverBudget({
        worldUsed: 0,
        platformUsed: SOCIETY_TALK_BUDGET.platformHour,
      }),
    ).toBe(true);
    expect(
      societyTalksOverBudget({
        worldUsed: SOCIETY_TALK_BUDGET.worldHour - 1,
        platformUsed: SOCIETY_TALK_BUDGET.platformHour - 1,
      }),
    ).toBe(false);
    expect(
      talkBudgetReserveExceeded({
        worldUsedAfter: SOCIETY_TALK_BUDGET.worldHour,
        platformUsedAfter: 1,
      }),
    ).toBe(false);
    expect(
      talkBudgetReserveExceeded({
        worldUsedAfter: SOCIETY_TALK_BUDGET.worldHour + 1,
        platformUsedAfter: 1,
      }),
    ).toBe(true);
  });

  it('shows world remaining and the next UTC hour', () => {
    const now = Date.parse('2026-08-20T04:15:00.000Z');
    expect(societyTalkHourResetsAt(now)).toBe('2026-08-20T05:00:00.000Z');
    expect(
      societyTalkBudgetView({
        worldUsed: 10,
        worldCap: 36,
        now,
      }),
    ).toEqual({
      used: 10,
      cap: 36,
      remaining: 0,
      resetsAt: '2026-08-20T05:00:00.000Z',
      litBonus: 0,
      litUntil: null,
    });
    expect(societyTalkBudgetView({ worldUsed: 40, worldCap: 36, now }).remaining).toBe(
      0,
    );
    expect(societyTalkBudgetView({ worldUsed: 0, worldCap: 36, now }).remaining).toBe(
      0,
    );
    expect(talkFundingOpen({ now })).toBe(false);
    expect(talkFundingOpen({ litBonus: 12, now })).toBe(true);
    expect(
      talkFundingOpen({
        litUntil: new Date(now + 3_600_000),
        now,
      }),
    ).toBe(true);
    expect(
      societyTalkBudgetView({
        worldUsed: 2,
        worldCap: 12,
        litBonus: 12,
        now,
      }).remaining,
    ).toBe(10);
    expect(
      societyTalkBudgetView({
        worldUsed: 36,
        worldCap: 36,
        now,
        litUntil: new Date(now + 3_600_000).toISOString(),
      }).remaining,
    ).toBe(SOCIETY_TALK_BUDGET.worldHour);
    expect(
      pacedTalkSlotsThisWalk({
        remaining: SOCIETY_TALK_BUDGET.worldHour,
        minutesLeftInHour: 40,
        pending: 2,
        keepAlive: true,
      }),
    ).toBe(2);
  });

  it('spreads remaining talks across the wall-clock hour', () => {
    const now = Date.parse('2026-08-20T04:15:00.000Z');
    expect(societyTalkMinutesLeftInHour(now)).toBe(45);
    // Spacing is inside one walk, so a watched town speaks on every walk.
    expect(
      pacedTalkSlotsThisWalk({
        remaining: 36,
        minutesLeftInHour: 60,
        pending: 6,
      }),
    ).toBe(2);
    expect(
      pacedTalkSlotsThisWalk({
        remaining: 36,
        minutesLeftInHour: 60,
        pending: 6,
        minutesSinceLastTalk: 0.05,
        walkIntervalMinutes: 0.05,
      }),
    ).toBe(2);
    expect(
      pacedTalkSlotsThisWalk({
        remaining: 36,
        minutesLeftInHour: 60,
        pending: 6,
        minutesSinceLastTalk: 1.8,
        walkIntervalMinutes: 0.05,
      }),
    ).toBe(2);
    expect(
      pacedTalkSlotsThisWalk({
        remaining: 60,
        minutesLeftInHour: 60,
        pending: 2,
        minutesSinceLastTalk: 0.7,
        walkIntervalMinutes: 0.05,
      }),
    ).toBe(2);
    expect(
      pacedTalkSlotsThisWalk({
        remaining: 60,
        minutesLeftInHour: 60,
        pending: 2,
        minutesSinceLastTalk: 0.15,
        walkIntervalMinutes: 0.05,
      }),
    ).toBe(2);
    // Last minutes: spend leftovers instead of letting 36 expire.
    expect(
      pacedTalkSlotsThisWalk({
        remaining: 10,
        minutesLeftInHour: 0.4,
        pending: 4,
        minutesSinceLastTalk: 0.05,
        walkIntervalMinutes: 0.05,
      }),
    ).toBe(2);
    expect(
      pacedTalkSlotsThisWalk({
        remaining: 0,
        minutesLeftInHour: 40,
        pending: 3,
      }),
    ).toBe(0);
    expect(
      pacedTalkSlotsThisWalk({
        remaining: 36,
        minutesLeftInHour: 60,
        pending: 6,
        minutesSinceLastTalk: 0.05,
        walkIntervalMinutes: 0.05,
        keepAlive: true,
      }),
    ).toBe(2);
  });

  it('puts open-stake towns first without dropping the rest', () => {
    expect(
      orderLiveWorldsForCourse(
        [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
        new Set(['c', 'a']),
      ).map((w) => w.id),
    ).toEqual(['a', 'c', 'b']);
  });

  it('stacks 点亮 without folding an hour pack into the lease', () => {
    const now = Date.parse('2026-08-20T04:15:00.000Z');
    const hour = stackWorldLight({ sku: 'hour', currentBonus: 12, now });
    expect(hour.hourPackBonus).toBe(SOCIETY_WORLD_LIGHT.hour.bonus);
    expect(hour.bonusPerHour).toBe(12);
    const week = stackWorldLight({
      sku: 'week',
      currentBonus: 12,
      currentUntil: new Date(now + 3_600_000),
      now,
    });
    expect(week.bonusPerHour).toBe(24);
    expect(week.hourPackBonus).toBe(0);
    expect(week.until && week.until.getTime()).toBeGreaterThan(now);
    expect(activeLightBonus(new Date(now + 1000), 12, now)).toBe(12);
    expect(activeLightBonus(new Date(now - 1000), 12, now)).toBe(0);
    expect(societyTalkHourBonus({ leaseBonus: 12, hourPackBonus: 12 })).toBe(24);
    expect(
      societyTalkBudgetView({
        worldUsed: 36,
        litBonus: 12,
        now,
      }),
    ).toMatchObject({
      cap: SOCIETY_TALK_BUDGET.worldHour + 12,
      remaining: 12,
      litBonus: 12,
    });
    expect(pickSocietyLlmLane({ reserved: 'floor', litBonus: 12 })).toBe('lit');
    expect(pickSocietyLlmLane({ reserved: 'lit' })).toBe('lit');
    expect(pickSocietyLlmLane({ reserved: 'floor' })).toBe('floor');
  });

  it('keeps a lit town’s extra talks off the platform floor', async () => {
    const now = Date.parse('2026-08-20T04:10:00.000Z');
    const redis = memoryRedis({
      'society:talks:a:2026-08-20T04': SOCIETY_TALK_BUDGET.worldHour,
      'society:talks:_platform:2026-08-20T04': SOCIETY_TALK_BUDGET.worldHour,
    });
    const caps = {
      worldHour: SOCIETY_TALK_BUDGET.worldHour,
      platformHour: SOCIETY_TALK_BUDGET.platformHour,
    };
    await grantHourLightBonusOn(redis, 'a', SOCIETY_WORLD_LIGHT.hour.bonus, now);
    const claimed = await reserveSocietyTalksOn(
      redis,
      'a',
      1,
      now,
      { leaseBonus: 12, litUntil: new Date(now + 3_600_000) },
      caps,
    );
    expect(claimed).toBe('lit');
    expect(redis.store.get('society:talks:_platform:2026-08-20T04')).toBe(
      SOCIETY_TALK_BUDGET.worldHour,
    );
    expect(redis.store.get('society:talks:lit:a:2026-08-20T04') ?? 0).toBe(0);
    const other = await reserveSocietyTalksOn(redis, 'b', 1, now, undefined, caps);
    expect(other).toBe(false);
    expect(redis.store.get('society:talks:_platform:2026-08-20T04')).toBe(
      SOCIETY_TALK_BUDGET.worldHour,
    );
  });

  it('does not let an unfunded town talk on the free 36/80 floor', async () => {
    const now = Date.parse('2026-08-20T04:10:00.000Z');
    const redis = memoryRedis();
    const caps = {
      worldHour: SOCIETY_TALK_BUDGET.worldHour,
      platformHour: SOCIETY_TALK_BUDGET.platformHour,
    };
    expect(await societyTalkBudgetOpenOn(redis, 'w1', now, undefined, caps)).toBe(
      false,
    );
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        reserveSocietyTalksOn(redis, 'w1', 1, now, undefined, caps),
      ),
    );
    expect(results.every((row) => row === false)).toBe(true);
    expect(redis.store.get('society:talks:w1:2026-08-20T04')).toBeUndefined();
    await grantHourLightBonusOn(redis, 'w1', SOCIETY_WORLD_LIGHT.hour.bonus, now);
    expect(await societyTalkBudgetOpenOn(redis, 'w1', now, undefined, caps)).toBe(
      true,
    );
    expect(await reserveSocietyTalksOn(redis, 'w1', 1, now, undefined, caps)).toBe(
      'lit',
    );
    expect(redis.store.get('society:talks:lit:w1:2026-08-20T04')).toBe(1);
    await releaseSocietyTalksOn(redis, 'w1', 1, now, 'lit');
    expect(redis.store.get('society:talks:lit:w1:2026-08-20T04')).toBe(0);
  });

  it('settles leftover slots in the same hour bucket they were reserved', async () => {
    const reservedAt = Date.parse('2026-08-20T04:59:30.000Z');
    const later = Date.parse('2026-08-20T05:00:10.000Z');
    const redis = memoryRedis({
      'society:talks:w1:2026-08-20T04': 4,
      'society:talks:_platform:2026-08-20T04': 4,
    });
    await settleSocietyTalksOn(redis, 'w1', 1, 0, reservedAt, 'floor');
    expect(redis.store.get('society:talks:w1:2026-08-20T04')).toBe(3);
    expect(redis.store.get('society:talks:w1:2026-08-20T05')).toBeUndefined();
    await settleSocietyTalksOn(redis, 'w1', 1, 0, later, 'floor');
    expect(redis.store.get('society:talks:w1:2026-08-20T05') ?? 0).toBe(0);
  });

  it('caps expensive emergency talks for the whole platform this hour', async () => {
    const now = Date.parse('2026-08-20T04:10:00.000Z');
    const redis = memoryRedis();
    expect(societyEmergencyTalkKey(now)).toBe(
      'society:talks:emergency:2026-08-20T04',
    );
    const cap = SOCIETY_EMERGENCY_BUDGET.platformHour;
    for (let i = 0; i < cap; i += 1) {
      await expect(reserveEmergencyTalkOn(redis, now, cap)).resolves.toBe(true);
    }
    await expect(reserveEmergencyTalkOn(redis, now, cap)).resolves.toBe(false);
    await expect(reserveEmergencyTalkOn(redis, now, 0)).resolves.toBe(false);
    const peek = await peekEmergencyTalkOn(redis, now, cap);
    expect(peek).toEqual({ used: cap, cap, remaining: 0 });
  });

  it('does not mute a funded town on the 36/80 floor', async () => {
    const now = Date.parse('2026-08-20T04:10:00.000Z');
    const redis = memoryRedis({
      'society:talks:a:2026-08-20T04': SOCIETY_TALK_BUDGET.worldHour,
      'society:talks:_platform:2026-08-20T04': SOCIETY_TALK_BUDGET.platformHour,
    });
    const caps = {
      worldHour: SOCIETY_TALK_BUDGET.worldHour,
      platformHour: SOCIETY_TALK_BUDGET.platformHour,
    };
    const litUntil = new Date(now + 86_400_000);
    expect(await societyTalkBudgetOpenOn(redis, 'a', now, { litUntil }, caps)).toBe(
      true,
    );
    expect(await reserveSocietyTalksOn(redis, 'a', 1, now, { litUntil }, caps)).toBe(
      'lit',
    );
    const peek = await peekSocietyTalkBudgetOn(
      redis,
      'a',
      now,
      { litUntil },
      SOCIETY_TALK_BUDGET.worldHour,
    );
    expect(peek.remaining).toBeGreaterThan(0);
    expect(redis.store.get('society:talks:_platform:2026-08-20T04')).toBe(
      SOCIETY_TALK_BUDGET.platformHour,
    );
    expect(tipExtendsLightMs(5)).toBe(60 * 60 * 1000);
    expect(tipExtendsLightMs(12)).toBe(3 * 60 * 60 * 1000);
    expect(tipExtendsLightMs(30)).toBe(12 * 60 * 60 * 1000);
  });

  it('openWorld counts the hourly cap instead of the unpaid mute', async () => {
    const now = Date.parse('2026-08-20T04:10:00.000Z');
    const redis = memoryRedis();
    const caps = { worldHour: 2, platformHour: 3 };
    const opts = { openWorld: true as const };
    expect(await societyTalkBudgetOpenOn(redis, 'town', now, opts, caps)).toBe(true);
    expect(await reserveSocietyTalksOn(redis, 'town', 1, now, opts, caps)).toBe('floor');
    expect(await reserveSocietyTalksOn(redis, 'town', 1, now, opts, caps)).toBe('floor');
    expect(await reserveSocietyTalksOn(redis, 'town', 1, now, opts, caps)).toBe(false);
    expect(await societyTalkBudgetOpenOn(redis, 'town', now, opts, caps)).toBe(false);
    const peek = await peekSocietyTalkBudgetOn(redis, 'town', now, opts, 2);
    expect(peek.remaining).toBe(0);
    expect(peek.used).toBe(2);
  });
});
