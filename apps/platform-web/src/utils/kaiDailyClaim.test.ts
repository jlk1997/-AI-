/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment jsdom
 */

import { describe, expect, it } from 'vitest';

import { dailyClaimFeedback } from './kaiDailyClaim.js';

describe('dailyClaimFeedback', () => {
  it('celebrates a fresh daily grant', () => {
    expect(dailyClaimFeedback({ daily: { justGranted: 8, loginPoints: 8 } })).toEqual({
      tone: 'success',
      key: 'kai.daily.just',
      points: 8,
    });
  });

  it('celebrates a first-night welcome before repeating the daily line', () => {
    expect(
      dailyClaimFeedback({
        daily: { loginPoints: 8 },
        welcomeJustGranted: 20,
      }),
    ).toEqual({
      tone: 'success',
      key: 'kai.welcome.just',
      points: 20,
    });
  });

  it('says already in when the China-day stamp is already set', () => {
    expect(dailyClaimFeedback({ daily: { justGranted: 0, loginPoints: 8 } })).toEqual({
      tone: 'info',
      key: 'kai.daily.in',
      points: 8,
    });
  });
});
