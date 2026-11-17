/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import { showAlleyCourseLane } from './components/Community/AlleyCharts';
import { featureFlags } from './utils/featureFlags';
import { isPublishUnfundedError } from './services/i18n';
import { en } from './services/locales/en';
import { zhCN } from './services/locales/zh-CN';

describe('dual-launch honesty', () => {
  it('keeps half-finished surfaces off by default', () => {
    expect(featureFlags.ecosystem).toBe(false);
    expect(featureFlags.customDomain).toBe(false);
    expect(featureFlags.researchLab).toBe(false);
    expect(featureFlags.courseMarket).toBe(true);
    expect(showAlleyCourseLane(false, [{ pool: 12 }])).toBe(false);
    expect(showAlleyCourseLane(true, [{ pool: 12 }])).toBe(true);
  });

  it('names the alley clock as China time in English', () => {
    expect(en['community.alley.kicker']).toMatch(/China/);
    expect(en['community.alley.kicker']).toMatch(/UTC\+8/);
    expect(en['community.subtitle']).toMatch(/China/);
    expect(en['community.subtitle']).toMatch(/UTC\+8/);
    expect(zhCN['community.alley.kicker']).toMatch(/今日榜单/);
    expect(en['community.alley.boardsHint']).toMatch(/UTC\+8/);
    expect(zhCN['community.alley.boardsHint']).toMatch(/还没结束/);
    expect(en['product.obs.course.clock.china']).toMatch(/UTC\+8/);
    expect(zhCN['product.obs.course.clock.betting']).not.toMatch(/等到整点/);
    expect(en['product.obs.course.clock.betting']).not.toMatch(/wait for the hour/i);
    expect(zhCN['product.obs.course.how1']).toMatch(/12 \/ 24 \/ 48/);
    expect(zhCN['product.obs.course.how3']).not.toMatch(/等到整点/);
    expect(zhCN['product.obs.course.how3']).toMatch(/一边倒/);
    expect(zhCN['product.obs.course.how3']).toMatch(/收回/);
    expect(zhCN['product.obs.course.goStake']).toMatch(/猜一猜/);
    expect(zhCN['product.obs.course.title']).toMatch(/今晚预测/);
    expect(zhCN['product.obs.course.title']).not.toMatch(/走向盘/);
    expect(zhCN['product.obs.course.rakeHint']).not.toMatch(/15%/);
    expect(zhCN['product.obs.course.rakeHint']).toMatch(/一边倒/);
    expect(zhCN['product.obs.course.phase.open']).toMatch(/开盘/);
    expect(en['product.obs.course.rakeHint']).not.toMatch(/15%/);
    expect(zhCN['community.alley.boardsHint']).toMatch(/选一个结果/);
    expect(zhCN['product.obs.guestWatchHint']).toMatch(/选一边/);
    expect(zhCN['product.obs.guestWatchHint']).not.toMatch(/镇时|开口许可|36/);
    expect(zhCN['product.obs.guestHint']).not.toMatch(/镇时|开口许可|36/);
    expect(zhCN['community.worlds.empty']).not.toMatch(/镇时|开口许可|36/);
    expect(zhCN['community.world.coursePrompt']).toMatch(/今夜/);
    expect(zhCN['product.obs.authorOps']).toMatch(/运维/);
    expect(zhCN['wallet.lede']).toMatch(/猜一猜/);
    expect(zhCN['wallet.lede']).not.toMatch(/镇时/);
    expect(zhCN['kai.guide.body']).toMatch(/猜一猜/);
    expect(zhCN['kai.guide.body']).not.toMatch(/镇时/);
    expect(zhCN['product.obs.course.closedNext']).toMatch(/说一句/);
    expect(zhCN['product.obs.course.closedNext']).not.toMatch(/巷议/);
    expect(zhCN['product.obs.guestAlertTitle']).toMatch(/选一边/);
    expect(zhCN['community.gameDetail.guestWorld']).toMatch(/围观免费/);
    expect(zhCN['community.gameDetail.guestWorld']).toMatch(/猜一猜/);
    expect(zhCN['community.gameDetail.observe']).toMatch(/猜一猜/);
    expect(zhCN['community.gameDetail.observe']).not.toMatch(/观察台/);
    expect(en['product.obs.guestAlertTitle']).toMatch(/stake/i);
    expect(en['wallet.lede']).not.toMatch(/镇时/);
    expect(en['kai.guide.body']).not.toMatch(/镇时/);
    expect(en['product.obs.course.closedNext']).toMatch(/whisper/i);
    expect(en['product.obs.course.closedNext']).not.toMatch(/巷议/);
    expect(zhCN['product.obs.talkFloorEmpty']).toMatch(/资助过期/);
    expect(zhCN['product.obs.course.phase.open']).not.toMatch(/开发中/);
    expect(zhCN['product.obs.authorCostHint']).not.toMatch(/36|80/);
    expect(zhCN['product.obs.sharedTalk']).toMatch(/同一条对白/);
    expect(zhCN['community.publish.unfunded']).toMatch(/实时对话/);
    expect(zhCN['community.publish.fundDay']).toMatch(/实时对话/);
    expect(zhCN['wallet.ledger.course_stake']).toMatch(/猜一猜/);
    expect(zhCN['wallet.ledger.course_stake']).not.toMatch(/走向盘/);
    expect(zhCN['product.obs.tipLightCoupon']).toMatch(/续时长/);
    expect(en['kai.event.hung']).not.toMatch(/course board/i);
    expect(zhCN['community.publish.fundHint']).toMatch(/本小时/);
    expect(zhCN['community.publish.hourNotEnough']).toMatch(/本小时/);
    expect(zhCN['community.world.visitorSku']).toMatch(/猜一猜/);
    expect(zhCN['community.world.visitorSku']).not.toMatch(/镇时|认养|点亮商店/);
    expect(zhCN['community.world.stakeTonight']).toBe('今晚可以猜');
    expect(zhCN['community.world.stakeTonight']).not.toMatch(/开发中/);
    expect(en['community.world.stakeTonight']).not.toMatch(/in development/i);
    expect(zhCN['product.obs.course.phase.closed']).toBe('核对中');
    expect(zhCN['product.obs.course.playLine']).toMatch(/确认选择/);
    expect(zhCN['product.obs.course.modal.pickHint']).not.toMatch(/是否盘|夜市|节拍/);
    expect(zhCN['product.obs.course.goBoard']).toBe('去看预测');
    expect(zhCN['product.obs.guestWalking']).not.toMatch(/资助过期/);
    expect(zhCN['product.obs.course.clock.evidenceUntil']).toMatch(/核对到/);
    expect(zhCN['product.obs.pulse.paused']).toMatch(/钟停了/);
    expect(zhCN['product.obs.pulse.fund']).toMatch(/实时对话/);
    expect(zhCN['product.obs.pulse.seed']).toMatch(/出题/);
    expect(zhCN['product.obs.course.modal.needPlaces']).toMatch(/两处/);
    expect(
      isPublishUnfundedError({ details: { reason: 'publish_unfunded' } }),
    ).toBe(true);
    expect(isPublishUnfundedError({ details: { reason: 'publish_legal' } })).toBe(
      false,
    );
    expect(zhCN['product.obs.llmBudget']).not.toMatch(/36|80/);
    expect(en['product.obs.llmBudget']).not.toMatch(/36|80/);
  });

  it('ships privacy + legal keys in both locales', () => {
    const keys = [
      'privacy.title',
      'login.legal.accept',
      'wallet.provider.stripe',
      'account.export',
      'account.delete',
      'account.exportOk',
      'account.deleteFail',
    ] as const;
    for (const key of keys) {
      expect(en[key]?.length).toBeGreaterThan(0);
      expect(zhCN[key]?.length).toBeGreaterThan(0);
    }
    expect(en['app.brand.short']).toBe('Gebi');
    expect(zhCN['app.brand.short']).toBe('隔壁');
  });
});
