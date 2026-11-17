/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { societyTalksAllowed } from '@opengame/platform-shared';

import {
  evictIdleWorldCaches,
  viewerLeaseActive,
} from './societyHeartbeat.js';

describe('viewerLeaseActive', () => {
  it('is false for always-on rows with a null lease (old projects)', () => {
    expect(viewerLeaseActive(null)).toBe(false);
    expect(viewerLeaseActive(undefined)).toBe(false);
  });

  it('is true only while the observatory lease is in the future', () => {
    expect(viewerLeaseActive(new Date(Date.now() + 60_000))).toBe(true);
    expect(viewerLeaseActive(new Date(Date.now() - 60_000))).toBe(false);
  });
});

describe('societyTalksAllowed', () => {
  it('does not talk on a paid permit with nobody on the page', () => {
    expect(
      societyTalksAllowed({
        presenceUntil: null,
        townTimeUntil: new Date(Date.now() + 86_400_000),
      }),
    ).toBe(false);
  });

  it('does not let leftover author-watch talk on an empty page', () => {
    expect(
      societyTalksAllowed({
        presenceUntil: null,
        authorWatchUntil: new Date(Date.now() + 60_000),
      }),
    ).toBe(false);
  });

  it('lets a present visitor talk without town-time', () => {
    expect(
      societyTalksAllowed({
        presenceUntil: new Date(Date.now() + 60_000),
        townTimeUntil: null,
        authorWatchUntil: null,
      }),
    ).toBe(true);
  });
});

describe('evictIdleWorldCaches', () => {
  it('drops per-world caches once a world stops walking', () => {
    const reports = new Map<string, unknown>([
      ['idle', 1],
      ['busy', 2],
    ]);
    const held = new Map<string, unknown>([
      ['idle', 1],
      ['busy', 2],
    ]);
    const now = 10_000_000;
    const touched = new Map<string, number>([
      ['idle', now - 40 * 60_000],
      ['busy', now - 60_000],
    ]);
    const dropped = evictIdleWorldCaches(now, [reports, held], touched);
    expect(dropped).toBe(1);
    expect([...reports.keys()]).toEqual(['busy']);
    expect([...held.keys()]).toEqual(['busy']);
    expect(touched.has('idle')).toBe(false);
  });

  it('keeps everything when nothing has aged out', () => {
    const cache = new Map<string, unknown>([['w', 1]]);
    const touched = new Map<string, number>([['w', 999]]);
    expect(evictIdleWorldCaches(1_000, [cache], touched)).toBe(0);
    expect(cache.size).toBe(1);
  });
});
