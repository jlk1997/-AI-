/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import { worldAudienceLine } from './WorldAudienceHint';

const t = (k: string, vars?: Record<string, string | number>): string => {
  if (k === 'product.obs.watchers') return `${vars?.n} watching`;
  if (k === 'product.obs.watchersOne') return '1 watching';
  if (k === 'product.obs.lampBy') return `Lamp · ${vars?.name}`;
  if (k === 'product.obs.lampMonth') return 'Month’s keeper';
  if (k === 'product.obs.watchFreeAlone') return 'Watching is free · you’re here';
  if (k === 'product.obs.nobodyWatchingYet') return 'Nobody staying yet — you first';
  if (k === 'community.world.authorPaused') return 'Author paused the clock';
  return k;
};

describe('worldAudienceLine', () => {
  it('invites the visitor when a living town has no audience yet', () => {
    expect(
      worldAudienceLine(t, {
        simTime: 10,
        simDays: 1,
        residents: 4,
        living: true,
        lastAdvancedAt: null,
        watcherCount: 0,
        lamp: null,
      }),
    ).toBe('Watching is free · you’re here');
  });

  it('does not call an idle town paused', () => {
    expect(
      worldAudienceLine(t, {
        simTime: 10,
        simDays: 1,
        residents: 4,
        living: false,
        lastAdvancedAt: null,
        watcherCount: 0,
        lamp: null,
      }),
    ).toBe('Nobody staying yet — you first');
  });

  it('names an author-paused clock', () => {
    expect(
      worldAudienceLine(t, {
        simTime: 10,
        simDays: 1,
        residents: 4,
        living: false,
        clockPaused: true,
        lastAdvancedAt: null,
        watcherCount: 2,
        lamp: null,
      }),
    ).toBe('Author paused the clock · 2 watching');
  });

  it('names the watchers and never sells the lamp on a discovery card', () => {
    expect(
      worldAudienceLine(t, {
        simTime: 10,
        simDays: 1,
        residents: 4,
        living: true,
        speaking: true,
        lastAdvancedAt: null,
        watcherCount: 3,
        lamp: {
          displayName: '阿禾',
          avatarUrl: null,
          sku: 'month',
          townTimeUntil: '2026-09-19T00:00:00.000Z',
        },
      }),
    ).toBe('3 watching');
  });
});
