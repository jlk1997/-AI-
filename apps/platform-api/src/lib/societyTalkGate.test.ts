/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import { SOCIETY_TALK_BUDGET } from '@opengame/platform-shared';

import { decideSocietyTalks } from './societyTalkGate.js';

describe('decideSocietyTalks', () => {
  const now = Date.parse('2026-08-20T04:10:00.000Z');

  it('mutes talks when nobody is on the page even if 镇时 is paid', async () => {
    const redis = {
      get: async () => '0',
      incrby: async () => 1,
      expire: async () => 1,
    };
    const decided = await decideSocietyTalks(
      redis,
      {
        id: 'w1',
        specJson: {},
        heartbeatUntil: null,
        authorWatchUntil: null,
        townTimeUntil: new Date(now + 86_400_000),
      },
      now,
    );
    expect(decided.allowTalks).toBe(false);
    expect(decided.mute).toBe('unwatched');
  });

  it('opens talks when present with a permit and budget left', async () => {
    const redis = {
      get: async () => '0',
      incrby: async () => 1,
      expire: async () => 1,
    };
    const decided = await decideSocietyTalks(
      redis,
      {
        id: 'w1',
        specJson: {},
        heartbeatUntil: new Date(now + 60_000),
        authorWatchUntil: null,
        townTimeUntil: new Date(now + 86_400_000),
        lightUntil: new Date(now + 86_400_000),
      },
      now,
    );
    expect(decided.allowTalks).toBe(true);
    expect(decided.mute).toBeNull();
  });

  it('mutes talks when the author froze the shared clock', async () => {
    const redis = {
      get: async () => '0',
      incrby: async () => 1,
      expire: async () => 1,
    };
    const decided = await decideSocietyTalks(
      redis,
      {
        id: 'w1',
        specJson: {},
        heartbeatUntil: new Date(now + 60_000),
        authorWatchUntil: null,
        townTimeUntil: new Date(now + 86_400_000),
        clockPaused: true,
      },
      now,
    );
    expect(decided.allowTalks).toBe(false);
    expect(decided.mute).toBe('unwatched');
  });

  it('walks only when present but the lamp is out', async () => {
    const redis = {
      get: async () => '0',
      incrby: async () => 1,
      expire: async () => 1,
    };
    const decided = await decideSocietyTalks(
      redis,
      {
        id: 'w1',
        specJson: {},
        heartbeatUntil: new Date(now + 60_000),
        authorWatchUntil: null,
        lightUntil: null,
      },
      now,
    );
    expect(decided.allowTalks).toBe(false);
    expect(decided.mute).toBe('budget');
  });

  it('closes talks when the hourly cap is spent', async () => {
    const redis = {
      get: async (key: string) =>
        key.includes('w1') ? String(SOCIETY_TALK_BUDGET.worldHour) : '0',
      incrby: async () => 1,
      expire: async () => 1,
    };
    const decided = await decideSocietyTalks(
      redis,
      {
        id: 'w1',
        specJson: {},
        heartbeatUntil: new Date(now + 60_000),
        authorWatchUntil: new Date(now + 60_000),
        townTimeUntil: null,
      },
      now,
    );
    expect(decided.allowTalks).toBe(false);
    expect(decided.mute).toBe('budget');
  });
});
