/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import { stackPermitUntil, stackWorldLight } from '@opengame/platform-shared';

import {
  authorSharePoints,
  buildSandboxReport,
  COMMERCE,
  COURSE,
  jiaxiDeckForPublishedGame,
  jiaxiHostMessages,
  jiaxiReceiptActionable,
  resolveEventMenu,
  scaleJiaxiPoints,
  looksLikeGameId,
  publicCommerceView,
  worldVisitorSkuBlocked,
  townTimeCost,
  townTimeMs,
  worldLightCost,
} from './commerce.js';
import {
  activeCampaigns,
  chinaDayKey,
  chinaDayStart,
  firstTopupBonus,
  isChinaWeekend,
  nextLoginStreak,
  paywallDetails,
  prevChinaDay,
  inviterGrantAllowed,
  MARKET,
  quoteVisitorPrice,
  recommendPackSku,
  streakBonusPoints,
} from './kaiMarket.js';
import { snapshotWallet } from './wallet.js';

describe('kai commerce', () => {
  it('recommends the nearest point pack after the merge, not a lane sku', () => {
    expect(recommendPackSku(8)).toBe('pack_kai');
    expect(recommendPackSku(81)).toBe('pack_small');
    expect(recommendPackSku(200)).toBe('pack_plus');
    expect(paywallDetails(8)).toEqual({ needPoints: 8, recommendSku: 'pack_kai' });
    expect(paywallDetails(200)).toEqual({
      needPoints: 200,
      recommendSku: 'pack_plus',
    });
    expect(paywallDetails(20, 12)).toEqual({ needPoints: 8, recommendSku: 'pack_kai' });
    expect(paywallDetails(200, 90)).toEqual({
      needPoints: 110,
      recommendSku: 'pack_small',
    });
    expect(paywallDetails(150)).toEqual({
      needPoints: 150,
      recommendSku: 'pack_plus',
    });
  });

  it('keeps a single wallet column after the 加戏/巷议 merge', () => {
    const snap = snapshotWallet({
      balance: 42,
      lifetimeEarned: 50,
      lifetimeSpent: 8,
      welcomeGranted: true,
      loginStreak: 1,
      lastLoginDay: '2026-08-20',
      firstTopupGranted: false,
      inviteClaimed: false,
    });
    expect(snap.balance).toBe(42);
    expect(snap).not.toHaveProperty('jiaxiBalance');
    expect(snap).not.toHaveProperty('xiangyiBalance');
  });

  it('gives the author a majority cut without rounding them to zero', () => {
    expect(authorSharePoints(10)).toBe(7);
    expect(authorSharePoints(1)).toBe(1);
    expect(authorSharePoints(0)).toBe(0);
  });

  it('hides town-time / light / adopt prices on a visitor world page', () => {
    const game = {
      category: 'world',
      jiaxiEnabled: false,
      xiangyiEnabled: true,
      isOfficial: false,
      jiaxiCost: 0,
      xiangyiCost: 6,
      eventMenu: null,
    } as Parameters<typeof publicCommerceView>[0];
    const visitor = publicCommerceView(game, { hideWorldVisitorSkus: true });
    expect(visitor.townTimeDay).toBe(0);
    expect(visitor.worldLightHour).toBe(0);
    expect(visitor.adopt).toBe(0);
    expect(visitor.xiangyiEnabled).toBe(false);
    expect(visitor.courseMinStake).toBe(COURSE.minStake);
    const author = publicCommerceView(game);
    expect(author.worldLightHour).toBe(COMMERCE.worldLightHour);
    expect(author.xiangyiEnabled).toBe(true);
    expect(
      worldVisitorSkuBlocked({ category: 'world', viewerIsAuthor: false }),
    ).toBe(true);
    expect(
      worldVisitorSkuBlocked({ category: 'world', viewerIsAuthor: true }),
    ).toBe(false);
    expect(
      worldVisitorSkuBlocked({ category: 'game', viewerIsAuthor: false }),
    ).toBe(false);
  });

  it('does not treat a community slug as a uuid world id', () => {
    expect(looksLikeGameId('night-market')).toBe(false);
    expect(looksLikeGameId('11111111-1111-4111-8111-111111111111')).toBe(true);
  });

  it('stacks 镇时 onto townTimeUntil, not a 24h presence lease', () => {
    const now = new Date('2026-08-20T00:00:00.000Z');
    expect(stackPermitUntil(null, now, 86_400_000).toISOString()).toBe(
      '2026-08-21T00:00:00.000Z',
    );
  });

  it('prices town-time by the clock, not by another generate', () => {
    expect(townTimeCost('day')).toBe(COMMERCE.townTimeDay);
    expect(townTimeMs('week')).toBe(7 * 86_400_000);
    expect(townTimeCost('month')).toBe(COMMERCE.townTimeMonth);
    expect(townTimeMs('month')).toBe(30 * 86_400_000);
    expect(COMMERCE.townTimeMonth).toBeLessThan(COMMERCE.townTimeWeek * 4);
    expect(COMMERCE.townTimeDay).toBe(20);
    expect(COMMERCE.townTimeWeek).toBe(80);
    expect(COMMERCE.townTimeMonth).toBe(240);
    expect(COMMERCE.worldLightHour).toBe(15);
    expect(COMMERCE.worldLightDay).toBe(40);
    expect(COMMERCE.worldLightWeek).toBe(160);
    expect(COURSE.minStake).toBe(12);
    expect(COURSE.stakeSteps).toEqual([12, 24, 48]);
  });

  it('keeps author self-light from paying themselves a tip', () => {
    expect(authorSharePoints(40)).toBe(28);
    expect(authorSharePoints(15)).toBe(10);
    expect(authorSharePoints(160)).toBe(112);
  });

  it('stacks 点亮日卡/周卡 by GREATEST and keeps the higher hourly bonus', () => {
    const now = Date.parse('2026-08-20T04:00:00.000Z');
    const day = stackWorldLight({ sku: 'day', now });
    expect(day.bonusPerHour).toBe(12);
    expect(day.hourPackBonus).toBe(0);
    expect(day.until?.getTime()).toBe(now + 86_400_000);
    const week = stackWorldLight({
      sku: 'week',
      currentUntil: day.until,
      currentBonus: day.bonusPerHour,
      now,
    });
    expect(week.bonusPerHour).toBe(24);
    expect(week.until?.getTime()).toBe((day.until?.getTime() ?? now) + 7 * 86_400_000);
    const hour = stackWorldLight({
      sku: 'hour',
      currentUntil: week.until,
      currentBonus: week.bonusPerHour,
      now,
    });
    expect(hour.hourPackBonus).toBe(12);
    expect(hour.bonusPerHour).toBe(24);
    expect(hour.until?.getTime()).toBe(week.until?.getTime());
  });

  it('prices 点亮世界 without touching 镇时 20/80/240', () => {
    expect(worldLightCost('hour')).toBe(15);
    expect(worldLightCost('day')).toBe(40);
    expect(worldLightCost('week')).toBe(160);
    expect(COMMERCE.worldLightHour).toBe(15);
    expect(COMMERCE.worldLightDay).toBe(40);
    expect(COMMERCE.worldLightWeek).toBe(160);
    expect(COMMERCE.townTimeDay).toBe(20);
    expect(COMMERCE.townTimeWeek).toBe(80);
    expect(COMMERCE.townTimeMonth).toBe(240);
  });

  it('counts China login streaks and pays the 3/7 day bonuses', () => {
    expect(prevChinaDay('2026-08-18')).toBe('2026-08-17');
    expect(nextLoginStreak('2026-08-17', '2026-08-18', 2)).toBe(3);
    expect(nextLoginStreak('2026-08-16', '2026-08-18', 6)).toBe(1);
    expect(streakBonusPoints(3)).toBe(4);
    expect(streakBonusPoints(7)).toBe(12);
    expect(streakBonusPoints(14)).toBe(12);
    expect(streakBonusPoints(2)).toBe(0);
  });

  it('falls back to the stock festival menu when the author left none', () => {
    expect(resolveEventMenu([])[0]?.id).toBe('harvest');
    expect(resolveEventMenu([{ id: 'rain', stimulus: '下雨了', points: 9 }])).toEqual([
      { id: 'rain', label: 'rain', points: 9, stimulus: '下雨了' },
    ]);
  });

  it('builds a synthetic 巷议·沙盘 report without scraping real people', () => {
    const report = buildSandboxReport({
      stimulus: '新招牌上街了',
      contrast: true,
      residentNames: ['阿禾', '铁匠', '店主'],
      rumorCount: 3,
      talkCount: 8,
      simHours: 40,
    });
    expect(report.opinionLeaders).toContain('阿禾');
    expect(report.control?.heat).toBeLessThan(report.spread[0]!.heat);
    expect(report.headline).toContain('巷议');
  });

  it('halves the first 加戏 and discounts weekend 夜市', () => {
    expect(
      quoteVisitorPrice({ kind: 'jiaxi', list: 8, firstJiaxi: true }),
    ).toMatchObject({ pay: 4, reason: 'newbie' });
    expect(
      quoteVisitorPrice({ kind: 'jiaxi', list: 8, firstJiaxi: false, stackToday: 1 }),
    ).toMatchObject({ pay: 12, reason: 'stack' });
    expect(
      quoteVisitorPrice({ kind: 'jiaxi', list: 20, firstJiaxi: true, stackToday: 2 }),
    ).toMatchObject({ pay: 10, reason: 'newbie' });
    expect(
      quoteVisitorPrice({ kind: 'event', list: 15, firstJiaxi: false, weekend: true }),
    ).toMatchObject({ pay: 12, reason: 'weekend' });
    expect(
      quoteVisitorPrice({ kind: 'xiangyi', list: 6, firstJiaxi: true, weekend: true }),
    ).toMatchObject({ pay: 6, reason: null });
    expect(
      quoteVisitorPrice({ kind: 'xiangyi', list: 6, firstJiaxi: false, firstXiangyi: true }),
    ).toMatchObject({ pay: 3, reason: 'newbie' });
  });

  it('adds a first-topup bonus on the same balance', () => {
    expect(firstTopupBonus(100)).toBe(20);
    expect(firstTopupBonus(0)).toBe(0);
  });

  it('builds a 加戏 deck from MechanicSpec instead of four stock cards', () => {
    const chess = jiaxiDeckForPublishedGame({
      category: 'strategy',
      title: '中国象棋',
    });
    expect(chess.some((c) => c.id === 'extra_move')).toBe(true);
    expect(chess.some((c) => c.id === 'gravity')).toBe(false);
    expect(jiaxiDeckForPublishedGame({ category: 'world', title: '巷议镇' })).toEqual(
      [],
    );
    expect(scaleJiaxiPoints(12, 16)).toBe(24);
  });

  it('puts the weekend night market on the China Saturday clock', () => {
    const saturday = new Date('2026-08-15T16:00:00.000Z');
    expect(isChinaWeekend(saturday)).toBe(true);
    expect(activeCampaigns(saturday).some((c) => c.id === 'weekend-night-market')).toBe(true);
    expect(activeCampaigns().some((c) => c.id === 'jiaxi-run')).toBe(true);
    expect(activeCampaigns().some((c) => c.id === 'jiaxi-stack')).toBe(true);
    const noonCst = new Date('2026-08-18T16:00:00.000Z');
    expect(chinaDayKey(noonCst)).toBe('2026-08-19');
    expect(chinaDayStart(noonCst).toISOString()).toBe('2026-08-18T16:00:00.000Z');
  });

  it('rejects a paid 加戏 receipt that cannot change the run', () => {
    expect(jiaxiReceiptActionable([])).toBe(false);
    expect(
      jiaxiReceiptActionable(jiaxiHostMessages([{ effect: 'next_wave_harder', label: '加难' }])),
    ).toBe(true);
    expect(jiaxiHostMessages([{ effect: '', label: 'empty' }])).toEqual([]);
  });

  it('stops inviter grants once the China-day cap is full', () => {
    expect(inviterGrantAllowed(4)).toBe(true);
    expect(inviterGrantAllowed(5)).toBe(false);
    expect(inviterGrantAllowed(MARKET.inviteDailyCap)).toBe(false);
  });
});
