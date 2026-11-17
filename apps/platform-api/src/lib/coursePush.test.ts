/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import { coursePushBodyForClosed, coursePushBodyForContested, coursePushBodyForStake } from './coursePush.js';

describe('coursePushBodyForStake', () => {
  it('describes a win with canon', () => {
    expect(
      coursePushBodyForStake({
        voided: false,
        voidReason: null,
        canon: '阿禾走了',
        won: true,
      }),
    ).toContain('阿禾走了');
  });

  it('describes uncontested void', () => {
    expect(
      coursePushBodyForStake({
        voided: true,
        voidReason: 'uncontested',
        canon: null,
        won: false,
      }),
    ).toContain('只有一边');
  });

  it('describes betting close', () => {
    expect(coursePushBodyForClosed()).toContain('封盘');
  });

  it('describes contested board for author', () => {
    expect(coursePushBodyForContested('阿禾会走吗')).toContain('成盘');
    expect(coursePushBodyForContested('阿禾会走吗')).toContain('阿禾会走吗');
    expect(coursePushBodyForContested(null)).toContain('成盘');
  });
});
