/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import {
  composeJobLogKey,
  detectLlmAuthError,
  detectLlmQuotaError,
  formatLlmQuotaErrorSummary,
} from '@opengame/platform-shared';

describe('detectLlmQuotaError', () => {
  it('detects MiniMax 429 usage limit', () => {
    const text =
      '[API Error: 429 usage limit exceeded, 5-hour usage limit reached for Token Plan Hs_max (4500/4500 used), resets at 2026-05-25T20:00:00+08:00 (2056)]';
    const info = detectLlmQuotaError(text);
    expect(info).not.toBeNull();
    expect(info?.provider).toBe('MiniMax');
    expect(info?.resetAt).toContain('2026-05-25T20:00:00');
    expect(formatLlmQuotaErrorSummary(info!)).toContain('429');
    expect(formatLlmQuotaErrorSummary(info!)).toContain('2026-05-25T20:00:00');
  });

  it('detects MiniMax image status 2056 Chinese Token Plan cap', () => {
    const text =
      '生成失败：MiniMax image status 2056 已达到 Token Plan 用量上限：请升级 Token Plan 套餐或购买积分补充用量。';
    const info = detectLlmQuotaError(text);
    expect(info).not.toBeNull();
    expect(info?.provider).toBe('MiniMax');
    expect(info?.snippet).toMatch(/2056|用量上限/);
  });

  it('detects Volcengine Ark overdue balance 403', () => {
    const text =
      '[API Error: 403 The request failed because your account has an overdue balance. Request id: 021786263086992b924623d76074f65850d50039da6f8f560353c]';
    const info = detectLlmQuotaError(text);
    expect(info).not.toBeNull();
    expect(info?.provider).toBe('Volcengine Ark');
    expect(info?.kind).toBe('billing');
    expect(formatLlmQuotaErrorSummary(info!)).toMatch(/欠费|余额/);
  });

  it('returns null for unrelated stderr', () => {
    expect(detectLlmQuotaError('TS2779 optional property access')).toBeNull();
  });

  it('does not treat bare "quota" help text as a failover signal', () => {
    expect(
      detectLlmQuotaError(
        'Model API error: visit the quota page for remaining balance details',
      ),
    ).toBeNull();
    expect(
      detectLlmQuotaError('MiniMax image HTTP 401: invalid api key'),
    ).toBeNull();
    expect(
      detectLlmAuthError('MiniMax image HTTP 401: invalid api key'),
    ).not.toBeNull();
  });

  it('does NOT treat agent game code mentioning reset/rate as MiniMax 429', () => {
    const codeDump = `
## file: src/scenes/LevelScene.ts
// score resets at scene start? No — score is only reset in collectCoin(
player.setVelocity(0);
if (coins.length > rate limit) { /* noop */ }
this.scene.start('TitleScene');
`.repeat(20);
    expect(detectLlmQuotaError(codeDump)).toBeNull();
    const summary = formatLlmQuotaErrorSummary({
      provider: 'MiniMax',
      kind: 'quota',
      resetAt: 'scene start? No — score is only reset in collectCoin(',
      snippet: 'fake',
    });
    expect(summary).not.toContain('collectCoin');
  });

  it('composeJobLogKey keeps S3 tail', () => {
    const key = composeJobLogKey('摘要', 'projects/p/jobs/j/log.txt');
    expect(key).toContain('; log:');
    expect(key).toContain('projects/p/jobs/j/log.txt');
  });
});
