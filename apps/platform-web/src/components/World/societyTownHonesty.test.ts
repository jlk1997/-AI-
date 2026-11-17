/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import {
  followTownLiveCopy,
  followTownLiveLine,
  guestTownHonestyKey,
} from './societyTownHonesty';

describe('guestTownHonestyKey', () => {
  it('names generate-mute before a paused clock', () => {
    expect(
      guestTownHonestyKey({
        isGenerating: true,
        clockPaused: true,
        presenceAcked: true,
        living: true,
      }),
    ).toBe('product.obs.llmGenerateMute');
  });

  it('names an author-paused clock before any idle blame', () => {
    expect(
      guestTownHonestyKey({
        clockPaused: true,
        presenceAcked: false,
        living: false,
        skipReason: 'unwatched',
      }),
    ).toBe('product.obs.authorPaused');
  });

  it('does not say the page is empty before presence acks', () => {
    expect(
      guestTownHonestyKey({
        presenceAcked: false,
        living: false,
      }),
    ).toBe('product.obs.guestJoining');
  });

  it('keeps permit / budget reasons after the guest is counted in', () => {
    expect(
      guestTownHonestyKey({
        presenceAcked: true,
        living: true,
        skipReason: 'no_permit',
      }),
    ).toBe('product.obs.fundingWalk');
    expect(
      guestTownHonestyKey({
        presenceAcked: true,
        living: true,
        skipReason: 'budget',
      }),
    ).toBe('product.obs.fundingWalk');
    expect(
      guestTownHonestyKey({
        presenceAcked: true,
        living: true,
        skipReason: 'keys_exhausted',
      }),
    ).toBe('product.obs.llmKeysExhausted');
    expect(
      guestTownHonestyKey({
        presenceAcked: true,
        living: true,
        speaking: true,
      }),
    ).toBe('product.obs.guestSpeaking');
  });
});

describe('followTownLiveLine', () => {
  it('prefers people watching over a stale day gap', () => {
    expect(
      followTownLiveLine({ watcherCount: 3, newHours: 30 }),
    ).toEqual({ key: 'gapAndLive', hours: 30, watchers: 3 });
    expect(followTownLiveLine({ watcherCount: 2, newHours: 0 })).toEqual({
      key: 'live',
      watchers: 2,
    });
    expect(followTownLiveLine({ clockPaused: true, watcherCount: 4 })).toEqual({
      key: 'paused',
    });
  });

  it('maps follow copy onto living / paused keys', () => {
    expect(
      followTownLiveCopy({ watcherCount: 3, newHours: 8 }),
    ).toEqual({
      key: 'profile.follows.gapAndLive',
      vars: { hours: 8, n: 3 },
    });
    expect(followTownLiveCopy({ watcherCount: 1 })).toEqual({
      key: 'product.obs.watchersOne',
    });
    expect(followTownLiveCopy({ clockPaused: true })).toEqual({
      key: 'community.world.authorPaused',
    });
    expect(followTownLiveCopy({})).toEqual({ key: 'profile.follows.noNews' });
  });
});
