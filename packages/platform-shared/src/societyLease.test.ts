/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import {
  PRESENCE_HIDDEN_GRACE_MS,
  SOCIETY_AUTHOR_WATCH_TTL_MS,
  authorWatchTtlMs,
  clampSocietyPresenceTtlMs,
  guestPresenceDecision,
  guestPresenceWriteGuard,
  leaseActive,
  presenceWhilePageVisible,
  societyTalkMuteReason,
  societyTalksAllowed,
  stackPermitUntil,
  townCatalogHeat,
  townPresenceBadge,
} from './societyLease.js';

describe('society leases', () => {
  const now = 1_700_000_000_000;

  it('treats a null lease as not present', () => {
    expect(leaseActive(null, now)).toBe(false);
    expect(leaseActive(new Date(now + 1), now)).toBe(true);
    expect(leaseActive(new Date(now - 1), now)).toBe(false);
  });

  it('lets the author talk without town-time', () => {
    expect(
      societyTalksAllowed({
        presenceUntil: new Date(now + 60_000),
        authorWatchUntil: new Date(now + 60_000),
        townTimeUntil: null,
        now,
      }),
    ).toBe(true);
  });

  it('lets a present visitor talk without town-time', () => {
    expect(
      societyTalksAllowed({
        presenceUntil: new Date(now + 60_000),
        authorWatchUntil: null,
        townTimeUntil: null,
        now,
      }),
    ).toBe(true);
    expect(
      societyTalksAllowed({
        presenceUntil: null,
        authorWatchUntil: null,
        townTimeUntil: new Date(now + 86_400_000),
        now,
      }),
    ).toBe(false);
    expect(
      societyTalksAllowed({
        presenceUntil: null,
        authorWatchUntil: new Date(now + 60_000),
        townTimeUntil: null,
        now,
      }),
    ).toBe(false);
  });

  it('mutes leftover author-watch and an empty budget, not unpaid guests', () => {
    expect(
      societyTalkMuteReason({
        presenceUntil: null,
        authorWatchUntil: new Date(now + 60_000),
        now,
      }),
    ).toBe('unwatched');
    expect(
      societyTalkMuteReason({
        presenceUntil: new Date(now + 60_000),
        authorWatchUntil: null,
        townTimeUntil: null,
        now,
      }),
    ).toBeNull();
    expect(
      societyTalkMuteReason({
        presenceUntil: new Date(now + 60_000),
        authorWatchUntil: new Date(now + 60_000),
        budgetOpen: false,
        now,
      }),
    ).toBe('budget');
    expect(
      societyTalkMuteReason({
        clockPaused: true,
        presenceUntil: new Date(now + 60_000),
        authorWatchUntil: new Date(now + 60_000),
        townTimeUntil: new Date(now + 86_400_000),
        now,
      }),
    ).toBe('unwatched');
  });

  it('keeps author-watch shorter than a crafted presence ttl', () => {
    expect(clampSocietyPresenceTtlMs(120 * 60_000)).toBe(15 * 60_000);
    expect(authorWatchTtlMs(12 * 60_000)).toBe(SOCIETY_AUTHOR_WATCH_TTL_MS);
  });

  it('does not mark an unwatched paid town as living', () => {
    expect(
      townPresenceBadge({
        presenceUntil: null,
        townTimeUntil: new Date(now + 86_400_000),
        now,
      }),
    ).toEqual({ living: false, speaking: false });
  });

  it('only marks speaking when someone is present and the lamp is on', () => {
    expect(
      townPresenceBadge({
        presenceUntil: new Date(now + 60_000),
        litUntil: null,
        now,
      }),
    ).toEqual({ living: true, speaking: false });
    expect(
      townPresenceBadge({
        presenceUntil: new Date(now + 60_000),
        litUntil: new Date(now + 86_400_000),
        now,
      }),
    ).toEqual({ living: true, speaking: true });
  });

  it('lets a guest leave clear presence unless someone else is still watching', () => {
    expect(
      guestPresenceDecision({
        leave: true,
        authorWatchUntil: null,
        now,
      }),
    ).toBe('clear');
    expect(
      guestPresenceDecision({
        leave: true,
        authorWatchUntil: new Date(now + 60_000),
        now,
      }),
    ).toBe('keep_author');
    expect(
      guestPresenceDecision({
        leave: true,
        authorWatchUntil: null,
        remainingWatchers: 2,
        now,
      }),
    ).toBe('keep_watchers');
    expect(guestPresenceDecision({ clockPaused: true, now })).toBe('paused');
    expect(guestPresenceDecision({ now })).toBe('extend');
    expect(
      guestPresenceWriteGuard({ action: 'extend', clockPaused: true }),
    ).toBe('paused');
    expect(
      guestPresenceWriteGuard({
        action: 'clear',
        authorWatchUntil: new Date(now + 60_000),
        remainingWatchers: 0,
        now,
      }),
    ).toBe('keep');
    expect(
      guestPresenceWriteGuard({
        action: 'clear',
        authorWatchUntil: null,
        remainingWatchers: 0,
        now,
      }),
    ).toBe('clear');
  });

  it('stops treating a hidden tab as presence after the grace window', () => {
    expect(presenceWhilePageVisible({ hiddenSince: null, now })).toBe('ping');
    expect(
      presenceWhilePageVisible({
        hiddenSince: now,
        now: now + PRESENCE_HIDDEN_GRACE_MS - 1,
      }),
    ).toBe('hold');
    expect(
      presenceWhilePageVisible({
        hiddenSince: now,
        now: now + PRESENCE_HIDDEN_GRACE_MS,
      }),
    ).toBe('leave');
  });

  it('stacks a permit on the later of now and the current expiry', () => {
    const current = new Date(now + 10_000);
    expect(stackPermitUntil(current, new Date(now), 5_000).getTime()).toBe(
      now + 15_000,
    );
    expect(stackPermitUntil(null, new Date(now), 5_000).getTime()).toBe(
      now + 5_000,
    );
  });

  it('ranks talking towns above walking ones in the alley', () => {
    expect(townCatalogHeat({ speaking: true, living: true })).toBe(2);
    expect(townCatalogHeat({ speaking: false, living: true })).toBe(1);
    expect(townCatalogHeat({ living: false })).toBe(0);
    expect(townCatalogHeat(null)).toBe(0);
  });
});
