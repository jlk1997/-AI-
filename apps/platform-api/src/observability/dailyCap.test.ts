/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PLAN_DAILY_CAPS,
  checkAndIncrementDailyCap,
  resolvePlanDailyCap,
  resolvePlanTier,
} from './dailyCap.js';

function fakeRedis(): {
  incr: (k: string) => Promise<number>;
  expire: (k: string, s: number) => Promise<number>;
  store: Map<string, number>;
} {
  const store = new Map<string, number>();
  return {
    store,
    async incr(k: string): Promise<number> {
      const v = (store.get(k) ?? 0) + 1;
      store.set(k, v);
      return v;
    },
    async expire(k: string): Promise<number> {
      return store.has(k) ? 1 : 0;
    },
  };
}

const fixedNow = new Date('2026-04-01T05:00:00.000Z');

describe('dailyCap', () => {
  it('returns ok when redis is null (fail-open)', async () => {
    const decision = await checkAndIncrementDailyCap({
      redis: null,
      prefix: 'og.test',
      organizationId: 'org1',
      limit: 3,
      now: fixedNow,
    });
    expect(decision.ok).toBe(true);
  });

  it('allows up to limit, then blocks', async () => {
    const redis = fakeRedis();
    const first = await checkAndIncrementDailyCap({
      redis: redis as never,
      prefix: 'og.test',
      organizationId: 'org2',
      limit: 2,
      now: fixedNow,
    });
    const second = await checkAndIncrementDailyCap({
      redis: redis as never,
      prefix: 'og.test',
      organizationId: 'org2',
      limit: 2,
      now: fixedNow,
    });
    const third = await checkAndIncrementDailyCap({
      redis: redis as never,
      prefix: 'og.test',
      organizationId: 'org2',
      limit: 2,
      now: fixedNow,
    });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(third.ok).toBe(false);
    if (!third.ok) {
      expect(third.limit).toBe(2);
      expect(third.resetAt).toMatch(/T00:00:00\.000Z$/);
    }
  });

  it('uses different keys per day', async () => {
    const redis = fakeRedis();
    const day1 = new Date('2026-04-01T23:59:00.000Z');
    const day2 = new Date('2026-04-02T00:01:00.000Z');
    const r1 = await checkAndIncrementDailyCap({
      redis: redis as never,
      prefix: 'og.test',
      organizationId: 'org3',
      limit: 1,
      now: day1,
    });
    const r2 = await checkAndIncrementDailyCap({
      redis: redis as never,
      prefix: 'og.test',
      organizationId: 'org3',
      limit: 1,
      now: day2,
    });
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(redis.store.size).toBe(2);
  });

  it('records plan tier on decision', async () => {
    const redis = fakeRedis();
    const r = await checkAndIncrementDailyCap({
      redis: redis as never,
      prefix: 'og.test',
      organizationId: 'org_plan',
      limit: 5,
      now: fixedNow,
      plan: 'pro',
    });
    expect(r.plan).toBe('pro');
  });
});

describe('resolvePlanTier', () => {
  it('reads per-org first', () => {
    const env: NodeJS.ProcessEnv = {
      OG_PLAN_TIER_ORG_X: 'studio',
      OG_PLAN_TIER: 'free',
    };
    expect(resolvePlanTier({ organizationId: 'org_x', env })).toBe('studio');
  });
  it('falls back to global', () => {
    const env: NodeJS.ProcessEnv = { OG_PLAN_TIER: 'pro' };
    expect(resolvePlanTier({ organizationId: 'org_y', env })).toBe('pro');
  });
  it('falls back to free when nothing set', () => {
    expect(resolvePlanTier({ organizationId: 'org_z', env: {} })).toBe('free');
  });
  it('rejects unknown values and falls back to free', () => {
    const env: NodeJS.ProcessEnv = { OG_PLAN_TIER: 'enterprise' };
    expect(resolvePlanTier({ organizationId: 'org_w', env })).toBe('free');
  });
});

describe('resolvePlanDailyCap', () => {
  it('uses per-plan env override', () => {
    const env: NodeJS.ProcessEnv = {
      NARRATIVE_REFRESH_DAILY_CAP_PRO: '7',
      NODE_ENV: 'production',
    };
    expect(
      resolvePlanDailyCap({ quotaNamespace: 'narrative-refresh', plan: 'pro', env }),
    ).toBe(7);
  });

  it('uses global env override when per-plan missing', () => {
    const env: NodeJS.ProcessEnv = {
      NARRATIVE_REFRESH_DAILY_CAP: '4',
      // vitest 默认 NODE_ENV=test，会触发 dailyCapForEnv 的 dev/test 放大；这里显式关掉
      NODE_ENV: 'production',
    };
    expect(
      resolvePlanDailyCap({ quotaNamespace: 'narrative-refresh', plan: 'studio', env }),
    ).toBe(4);
  });

  it('uses default plan caps when env empty', () => {
    const env: NodeJS.ProcessEnv = { NODE_ENV: 'production' };
    expect(resolvePlanDailyCap({ quotaNamespace: 'narrative-refresh', plan: 'free', env })).toBe(
      DEFAULT_PLAN_DAILY_CAPS.free,
    );
    expect(resolvePlanDailyCap({ quotaNamespace: 'narrative-refresh', plan: 'studio', env })).toBe(
      DEFAULT_PLAN_DAILY_CAPS.studio,
    );
  });

  it('treats unknown plan as free (conservative)', () => {
    const env: NodeJS.ProcessEnv = { NODE_ENV: 'production' };
    expect(resolvePlanDailyCap({ quotaNamespace: 'narrative-refresh', plan: 'unknown', env })).toBe(
      DEFAULT_PLAN_DAILY_CAPS.free,
    );
  });

  it('ignores invalid env values', () => {
    const env: NodeJS.ProcessEnv = {
      NARRATIVE_REFRESH_DAILY_CAP_PRO: 'not-a-number',
      NARRATIVE_REFRESH_DAILY_CAP: '-3',
      NODE_ENV: 'production',
    };
    expect(resolvePlanDailyCap({ quotaNamespace: 'narrative-refresh', plan: 'pro', env })).toBe(
      DEFAULT_PLAN_DAILY_CAPS.pro,
    );
  });

  it('per-plan override works under dev/test mode (×100 multiplier still applies)', () => {
    const env: NodeJS.ProcessEnv = {
      NARRATIVE_REFRESH_DAILY_CAP_PRO: '7',
      NODE_ENV: 'test',
    };
    expect(
      resolvePlanDailyCap({ quotaNamespace: 'narrative-refresh', plan: 'pro', env }),
    ).toBe(700);
  });
});