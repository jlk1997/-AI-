/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import { en } from './en';
import { zhCN } from './zh-CN';

const BRAND_KEYS = [
  'app.brand',
  'app.brand.short',
  'app.tagline',
  'kai.alley.title',
  'kai.alley.jiaxi',
  'kai.alley.xiangyi',
  'mobile.community.emptyCta',
  'conversation.welcome.title',
  'chat.sender.assistant',
  'kai.afterPlay.remix',
  'chat.send',
  'community.alley.hottest',
  'community.alley.remixed',
  'community.publish.done.remixProof',
  'community.gameDetail.remixCount',
  'kai.invite.landing',
  'community.lineage.mustCredit',
  'profile.follows.share',
  'profile.follows.shareTitle',
  'mobile.library.share',
  'generate.failedJobs.deadAlert',
  'generate.ops.deadAlert',
  'kai.daily.fail',
  'preview.diag.baking',
  'preview.diag.settling',
  'preview.diag.draftLive',
  'preview.diag.draftLiveGeneric',
  'product.obs.draftWalkHint',
  'preview.diag.refreshUrl',
  'preview.diag.hintJobFailed',
  'preview.diag.hintMissingPack',
  'preview.diag.retryJob',
  'preview.diag.noDeployment',
] as const;

describe('gebi brand copy', () => {
  it('uses the new name in both locales', () => {
    expect(zhCN['app.brand']).toBe('隔壁 · AI 小镇');
    expect(zhCN['app.brand.short']).toBe('隔壁');
    expect(en['app.brand.short']).toBe('Gebi');
    expect(zhCN['app.brand']).not.toContain('OpenGame');
    expect(en['conversation.welcome.title']).not.toContain('OpenGame');
    expect(zhCN['chat.sender.assistant']).toBe('隔壁');
    expect(en['chat.sender.assistant']).not.toContain('OpenGame');
    for (const key of BRAND_KEYS) {
      expect(en[key]?.length).toBeGreaterThan(0);
      expect(zhCN[key]?.length).toBeGreaterThan(0);
    }
  });
});
