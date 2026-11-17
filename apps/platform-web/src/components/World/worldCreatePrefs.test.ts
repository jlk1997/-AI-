/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  defaultWorldCreatePrefs,
  readWorldCreatePrefs,
  societySeedHoursOf,
  storeWorldCreatePrefs,
  townExtrasOf,
  worldPopulationOf,
} from './worldCreatePrefs';

function installMemoryLocalStorage(): void {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => store.clear(),
    },
  });
}

describe('worldCreatePrefs', () => {
  beforeEach(() => {
    installMemoryLocalStorage();
  });

  it('defaults to hand-painted standard town with a China day of gossip', () => {
    const prefs = readWorldCreatePrefs();
    expect(prefs).toEqual(defaultWorldCreatePrefs());
    expect(worldPopulationOf(prefs)).toBe(22);
    expect(societySeedHoursOf(prefs)).toBe(16);
  });

  it('round-trips compact dawn choices', () => {
    storeWorldCreatePrefs({
      artStyleId: 'ink_wash',
      scale: 'compact',
      livedIn: 'dawn',
      packId: 'society.town',
      useCase: 'xiangyi',
      venues: ['night_market', 'teahouse'],
      castA: '',
      castB: '',
      rumor: '',
      note: '林嫂和阿禾要在夜市对质',
    });
    const prefs = readWorldCreatePrefs();
    expect(prefs.note).toMatch(/林嫂/);
    expect(prefs.artStyleId).toBe('ink_wash');
    expect(worldPopulationOf(prefs)).toBe(10);
    expect(townExtrasOf(prefs)).toBe(8);
    expect(societySeedHoursOf(prefs)).toBe(4);
  });

  it('upgrades a legacy three-field prefs blob without dropping to demo town', () => {
    localStorage.setItem(
      'opengame_world_create_prefs',
      JSON.stringify({
        artStyleId: 'hand_painted',
        scale: 'standard',
        livedIn: 'full_day',
      }),
    );
    const prefs = readWorldCreatePrefs();
    expect(prefs.packId).toBe('society.town');
    expect(prefs.useCase).toBe('xiangyi');
    expect(prefs.venues.length).toBeGreaterThan(0);
    expect(prefs.note).toBe('');
    expect(societySeedHoursOf({ ...prefs, livedIn: 'long_day' })).toBe(24);
  });
});
