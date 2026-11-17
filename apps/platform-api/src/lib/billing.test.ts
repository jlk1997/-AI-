/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import type { PlatformEnv } from '../env.js';
import { buildCatalog, newOutTradeNo, resolveSku } from './billing.js';

function envWith(overrides: Partial<PlatformEnv> = {}): PlatformEnv {
  return {
    dailyJobLimitPerOrg: 20,
    maxConcurrentJobsPerOrg: 2,
    planDailyJobLimits: { free: 20, creator: 100 },
    planMaxConcurrentJobs: { free: 2, creator: 4 },
    planMonthlyPoints: { free: 0, creator: 800, studio: 3000 },
    planPriceCents: { free: 0, creator: 3900, studio: 19900 },
    pointPacks: { pack_small: { points: 120, cents: 900 } },
    jobPointCosts: { generate: 10, world_generate: 25 },
    wechatPayMchId: undefined,
    wechatPayPrivateKey: undefined,
    alipayAppId: undefined,
    alipayPrivateKey: undefined,
    allowMockPayments: false,
    ...overrides,
  } as PlatformEnv;
}

describe('buildCatalog', () => {
  it('only advertises providers the server can actually charge with', () => {
    expect(buildCatalog(envWith()).providers).toEqual([]);
    expect(
      buildCatalog(
        envWith({ alipayAppId: 'app', alipayPrivateKey: 'pem', allowMockPayments: true }),
      ).providers,
    ).toEqual(['alipay', 'mock']);
    expect(buildCatalog(envWith({ stripeApiKey: 'sk_test' })).providers).toEqual([
      'stripe',
    ]);
    expect(buildCatalog(envWith({ stripeApiKey: 'sk_test' })).stripeStorefront).toBe(
      false,
    );
    expect(
      buildCatalog(
        envWith({ stripeApiKey: 'sk_test', stripeStorefront: true }),
      ).stripeStorefront,
    ).toBe(true);
  });

  it('falls back to the global quota for plans with no explicit limits', () => {
    const studio = buildCatalog(envWith()).plans.find((p) => p.id === 'studio');
    expect(studio?.dailyJobLimit).toBe(20);
    expect(studio?.maxConcurrentJobs).toBe(2);
  });

  it('lists point packs without a spend lane', () => {
    const catalog = buildCatalog(envWith());
    expect(catalog.commerce.jiaxi).toBe(8);
    expect(catalog.commerce.xiangyi).toBe(6);
    expect(catalog.packs.every((pack) => !('lane' in pack))).toBe(true);
    expect(catalog.packs.map((pack) => pack.id)).not.toContain('pack_jiaxi');
    expect(catalog.packs.map((pack) => pack.id)).not.toContain('pack_xiangyi');
  });
});

describe('resolveSku', () => {
  it('resolves a point pack to its price and points', () => {
    expect(resolveSku(envWith(), 'pack_small')).toMatchObject({
      kind: 'points',
      points: 120,
      cents: 900,
      plan: null,
      description: '开镇礼 120 点',
    });
    expect(
      resolveSku(
        envWith({ pointPacks: { pack_small: { points: 120, cents: 900 } } }),
        'pack_jiaxi',
      )?.description,
    ).toBe('开镇礼 200 点');
  });

  it('resolves a plan purchase to its monthly grant', () => {
    expect(resolveSku(envWith(), 'plan:creator')).toMatchObject({
      kind: 'subscription',
      points: 800,
      cents: 3900,
      plan: 'creator',
    });
  });

  it('refuses the free plan and unknown skus, so nothing unpriced reaches checkout', () => {
    expect(resolveSku(envWith(), 'plan:free')).toBeNull();
    expect(resolveSku(envWith(), 'plan:nope')).toBeNull();
    expect(resolveSku(envWith(), 'pack_giant')).toBeNull();
  });
});

describe('newOutTradeNo', () => {
  it('is unique and URL-safe', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newOutTradeNo()));
    expect(ids.size).toBe(200);
    for (const id of ids) {
      expect(id).toMatch(/^og[0-9a-f]{24}$/);
      expect(id.length).toBeLessThanOrEqual(32);
    }
  });
});
