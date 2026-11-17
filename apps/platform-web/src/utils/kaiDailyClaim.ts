/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * GET /billing/market claims the daily 开镇礼 as a side effect.
 * The wallet button must call that endpoint — navigating to /wallet is a no-op
 * when the user is already there.
 */

export type DailyClaimTone = 'success' | 'info';

export interface DailyClaimInput {
  daily?: {
    justGranted?: number;
    loginPoints?: number;
  };
  welcomeJustGranted?: number;
}

export interface DailyClaimFeedback {
  tone: DailyClaimTone;
  key: 'kai.daily.just' | 'kai.welcome.just' | 'kai.daily.in';
  points: number;
}

export function dailyClaimFeedback(market: DailyClaimInput): DailyClaimFeedback {
  const just = market.daily?.justGranted ?? 0;
  const welcome = market.welcomeJustGranted ?? 0;
  if (just > 0) {
    return { tone: 'success', key: 'kai.daily.just', points: just };
  }
  if (welcome > 0) {
    return { tone: 'success', key: 'kai.welcome.just', points: welcome };
  }
  return { tone: 'info', key: 'kai.daily.in', points: market.daily?.loginPoints ?? 0 };
}
