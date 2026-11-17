/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import {
  detectLlmAuthError,
  detectLlmQuotaError,
  extractQuotaResetAt,
  formatLlmQuotaErrorSummary,
  isLlmAuthErrorLike,
  isLlmKeyRotateErrorLike,
} from './llmQuotaError.js';

describe('detectLlmQuotaError', () => {
  it('detects real MiniMax 429 API errors', () => {
    const text = `Chat completion failed: 429 - {"type":"error","error":{"type":"insufficient_quota","message":"429 usage limit exceeded, please check your Token Plan or upgrade to higher.` +
      ` Current TPM: xxx. Your TPM limit will resets at 2026-08-10 02:00:00"}}`;
    const hit = detectLlmQuotaError(text);
    expect(hit).not.toBeNull();
    expect(hit!.provider).toBe('MiniMax');
    expect(hit!.kind).toBe('quota');
    expect(hit!.resetAt).toMatch(/2026-08-10/);
  });

  it('does NOT treat agent-written Phaser code as quota failure', () => {
    const codeDump = `
## file: src/scenes/LevelScene.ts
// score resets at scene start? No — score is only reset in collectCoin(
player.setVelocity(0);
if (coins.length > rate limit) { /* noop */ }
this.scene.start('TitleScene');
`.repeat(40);
    expect(detectLlmQuotaError(codeDump)).toBeNull();
  });

  it('still detects 2056 Token Plan in MiniMax base_resp lines', () => {
    const text = `MiniMax image status 2056 已达到 Token Plan 用量上限`;
    const hit = detectLlmQuotaError(text);
    expect(hit).not.toBeNull();
    expect(hit!.provider).toBe('MiniMax');
  });

  it('extractQuotaResetAt rejects game-code phrases', () => {
    expect(
      extractQuotaResetAt('score is only reset in collectCoin(player)'),
    ).toBeNull();
    expect(
      extractQuotaResetAt('Your TPM limit will resets at 2026-08-10 02:00:00'),
    ).toContain('2026-08-10');
  });

  it('formatLlmQuotaErrorSummary omits bogus reset phrases', () => {
    const summary = formatLlmQuotaErrorSummary({
      provider: 'MiniMax',
      kind: 'quota',
      resetAt: 'scene start? No — score is only reset in collectCoin(',
      snippet: 'fake',
    });
    expect(summary).not.toContain('collectCoin');
    expect(summary).toContain('429');
  });

  it('detects MiniMax image status 2049 invalid api key as auth (not quota)', () => {
    const text = 'MiniMax image status 2049 invalid api key';
    expect(detectLlmQuotaError(text)).toBeNull();
    const auth = detectLlmAuthError(text);
    expect(auth).not.toBeNull();
    expect(auth!.provider).toBe('MiniMax');
    expect(isLlmAuthErrorLike(new Error(text))).toBe(true);
    expect(isLlmKeyRotateErrorLike(new Error(text))).toBe(true);
  });
});
