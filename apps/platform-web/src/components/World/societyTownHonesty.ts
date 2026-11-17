/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * First-session copy: why the town is quiet, without blaming the visitor.
 */

import { guestTownFace } from './societyTownGating';

export type TownLiveChrome = {
  readonly living: boolean;
  readonly speaking: boolean;
  readonly watcherCount: number;
  readonly clockPaused: boolean;
  readonly honestyKey: string;
  readonly lamp: {
    readonly displayName: string;
    readonly avatarUrl: string | null;
    readonly sku: 'day' | 'week' | 'month';
    readonly townTimeUntil: string;
  } | null;
};

export function guestTownHonestyKey(input: {
  readonly clockPaused?: boolean;
  readonly presenceAcked?: boolean;
  readonly living?: boolean;
  readonly speaking?: boolean;
  readonly skipReason?: string | null;
  readonly isGenerating?: boolean;
}): string {
  if (input.isGenerating || input.skipReason === 'generate') {
    return 'product.obs.llmGenerateMute';
  }
  if (input.clockPaused) return 'product.obs.authorPaused';
  if (input.skipReason === 'no_permit') return 'product.obs.fundingWalk';
  if (input.skipReason === 'budget') return 'product.obs.fundingWalk';
  if (input.skipReason === 'keys_exhausted') return 'product.obs.llmKeysExhausted';
  if (input.skipReason === 'no_key') return 'product.obs.llmDegraded';
  if (!input.presenceAcked && !input.living) return 'product.obs.guestJoining';
  const face = guestTownFace({
    living: input.living,
    speaking: input.speaking,
  });
  if (face === 'speaking') return 'product.obs.guestSpeaking';
  if (face === 'walking') return 'product.obs.guestWalking';
  return 'product.obs.guestIdle';
}

export function followTownLiveLine(input: {
  readonly watcherCount?: number;
  readonly newHours?: number | null;
  readonly clockPaused?: boolean;
}):
  | { readonly key: 'paused' }
  | { readonly key: 'live'; readonly watchers: number }
  | { readonly key: 'gapAndLive'; readonly hours: number; readonly watchers: number }
  | { readonly key: 'days'; readonly days: number }
  | { readonly key: 'hours'; readonly hours: number }
  | { readonly key: 'quiet' } {
  if (input.clockPaused) return { key: 'paused' };
  const watchers = Math.max(0, Math.round(input.watcherCount ?? 0));
  const hours = Math.max(0, input.newHours ?? 0);
  if (watchers > 0 && hours >= 1) {
    return { key: 'gapAndLive', hours: Math.round(hours), watchers };
  }
  if (watchers > 0) return { key: 'live', watchers };
  if (hours >= 24) return { key: 'days', days: Math.floor(hours / 24) };
  if (hours > 0) return { key: 'hours', hours: Math.round(hours) };
  return { key: 'quiet' };
}

export function followTownLiveCopy(input: {
  readonly watcherCount?: number;
  readonly newHours?: number | null;
  readonly clockPaused?: boolean;
}): {
  readonly key: string;
  readonly vars?: Record<string, string | number>;
} {
  const line = followTownLiveLine(input);
  if (line.key === 'paused') return { key: 'community.world.authorPaused' };
  if (line.key === 'gapAndLive') {
    return {
      key: 'profile.follows.gapAndLive',
      vars: { hours: line.hours, n: line.watchers },
    };
  }
  if (line.key === 'live') {
    return line.watchers === 1
      ? { key: 'product.obs.watchersOne' }
      : { key: 'product.obs.watchers', vars: { n: line.watchers } };
  }
  if (line.key === 'days') {
    return { key: 'profile.follows.newDays', vars: { days: line.days } };
  }
  if (line.key === 'hours') {
    return { key: 'profile.follows.newHours', vars: { hours: line.hours } };
  }
  return { key: 'profile.follows.noNews' };
}
