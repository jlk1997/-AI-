/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import {
  guestTownFace,
  leaseRemainingMs,
  permitRemainParts,
  readTalkBudget,
  shouldAutoloadTownMap,
  shouldClearBudgetMute,
  talkBudgetStripLine,
  quietTownSkipReason,
  guestMuteOverlayKey,
  talkBudgetTone,
  talkHourResetMinutes,
  urgeWorldLight,
  worldLightUntilLine,
  authorTownPulses,
  shouldAutostartPlayback,
  livePausedHintKey,
  showAuthorServerClock,
  showTownInspector,
  applyObserveModeParam,
  shouldBootstrapInspectorNow,
  shouldHydrateIframeReplay,
  shouldFollowSharedCursor,
  shouldHydrateWithFullReplay,
  shouldKeepSocietyStream,
  shouldPushSocietySnapshotToIframe,
  mergeSocietyReloadOpts,
  isSocietySnapshotBehindLive,
  societyReloadCursor,
  isTownStageAliveMessage,
  societyTownCapabilities,
  talkLogNodKey,
  townTalkQuietOverlay,
} from './societyTownGating.js';

describe('societyTownCapabilities', () => {
  it('lets the author drive the shared town', () => {
    expect(societyTownCapabilities('author')).toEqual({
      canFastForward: true,
      canPauseSharedClock: true,
      canRebuild: true,
      canInterview: true,
      canAuthorWhisper: true,
      keepPresenceWhileLocallyPaused: false,
    });
  });

  it('keeps guests on observe + local pause only', () => {
    expect(societyTownCapabilities('guest')).toEqual({
      canFastForward: false,
      canPauseSharedClock: false,
      canRebuild: false,
      canInterview: false,
      canAuthorWhisper: false,
      keepPresenceWhileLocallyPaused: true,
    });
  });

  it('keeps the shared talk stream when a guest only pauses their view', () => {
    expect(
      shouldKeepSocietyStream({ role: 'guest', livePaused: true }),
    ).toBe(true);
    expect(
      shouldKeepSocietyStream({ role: 'author', livePaused: true }),
    ).toBe(false);
    expect(
      shouldKeepSocietyStream({
        role: 'guest',
        livePaused: false,
        dead: true,
      }),
    ).toBe(false);
  });

  it('autoloads the map for guests and an opened observatory', () => {
    expect(
      shouldAutoloadTownMap({
        role: 'guest',
        hasPreview: true,
        mapPrepReady: true,
        broken: false,
      }),
    ).toBe(true);
    expect(
      shouldAutoloadTownMap({
        role: 'author',
        autoloadMap: true,
        hasPreview: true,
        mapPrepReady: true,
        broken: false,
      }),
    ).toBe(true);
    expect(
      shouldAutoloadTownMap({
        role: 'author',
        hasPreview: true,
        mapPrepReady: true,
        broken: false,
      }),
    ).toBe(false);
    expect(
      shouldAutoloadTownMap({
        role: 'author',
        autoloadMap: true,
        hasPreview: true,
        mapPrepReady: true,
        broken: false,
        bundleReady: false,
      }),
    ).toBe(true);
    expect(
      shouldAutoloadTownMap({
        role: 'author',
        autoloadMap: true,
        hasPreview: true,
        mapPrepReady: true,
        broken: false,
      }),
    ).toBe(true);
    expect(
      shouldAutoloadTownMap({
        role: 'author',
        autoloadMap: true,
        hasPreview: true,
        mapPrepReady: true,
        broken: true,
        bundleReady: false,
      }),
    ).toBe(true);
  });

  it('labels generate-mute before “they just nodded”', () => {
    expect(talkLogNodKey({ isGenerating: true })).toBe(
      'product.obs.talkNodGenerate',
    );
    expect(talkLogNodKey({ skipReason: 'generate' })).toBe(
      'product.obs.talkNodGenerate',
    );
    expect(talkLogNodKey({})).toBe('product.obs.talkNodOnly');
    expect(
      townTalkQuietOverlay({
        isGenerating: true,
        livePaused: true,
        isAuthor: true,
      }),
    ).toEqual({ key: 'product.obs.llmGenerateMutePaused' });
    expect(townTalkQuietOverlay({ isGenerating: true })).toEqual({
      key: 'product.obs.llmGenerateMute',
    });
  });

  it('never tells a guest to 继续推演', () => {
    expect(
      livePausedHintKey({ role: 'guest', iframeReady: true, userStopped: false }),
    ).toBeNull();
    expect(
      livePausedHintKey({ role: 'guest', iframeReady: true, userStopped: true }),
    ).toBe('product.obs.viewPaused');
    expect(
      livePausedHintKey({ role: 'author', iframeReady: true }),
    ).toBe('product.obs.liveReadyHint');
    expect(showAuthorServerClock({ role: 'guest', serverClock: true })).toBe(
      false,
    );
    expect(showAuthorServerClock({ role: 'author', serverClock: true })).toBe(
      true,
    );
    expect(showTownInspector({ role: 'guest', courseHost: 'page' })).toBe(false);
    expect(showTownInspector({ role: 'guest', courseHost: 'stage' })).toBe(true);
    expect(showTownInspector({ role: 'author', courseHost: 'page' })).toBe(true);
    expect(
      applyObserveModeParam('https://cdn.example/pack/?mode=play', true),
    ).toContain('mode=observe');
    expect(
      applyObserveModeParam('https://cdn.example/pack/?mode=play', true),
    ).not.toContain('mode=play');
    expect(
      applyObserveModeParam('https://cdn.example/pack/?mode=play', false),
    ).toContain('mode=play');
  });

  it('auto-follows the shared clock unless the visitor paused their view', () => {
    expect(
      shouldAutostartPlayback({
        role: 'guest',
        userStopped: false,
        locked: false,
        broken: false,
        clockPaused: true,
      }),
    ).toBe(true);
    expect(
      shouldAutostartPlayback({
        role: 'guest',
        userStopped: true,
        locked: false,
        broken: false,
      }),
    ).toBe(false);
    expect(
      shouldAutostartPlayback({
        role: 'author',
        autoloadMap: true,
        userStopped: false,
        locked: false,
        broken: true,
        stageLive: false,
      }),
    ).toBe(true);
    expect(
      shouldAutostartPlayback({
        role: 'author',
        autoloadMap: true,
        userStopped: false,
        locked: false,
        clockPaused: true,
      }),
    ).toBe(false);
    expect(
      shouldBootstrapInspectorNow({
        role: 'guest',
        gameId: 'g1',
        locked: false,
      }),
    ).toBe(true);
  });

  it('treats society postMessages as proof the stage parsed', () => {
    expect(isTownStageAliveMessage('opengame-society-ready')).toBe(true);
    expect(isTownStageAliveMessage('opengame-society-cursor')).toBe(true);
    expect(isTownStageAliveMessage('opengame-preview-broken')).toBe(false);
    expect(isTownStageAliveMessage(undefined)).toBe(false);
  });

  it('replays the current town into the iframe only after both sides are up', () => {
    expect(
      shouldHydrateIframeReplay({
        iframeReady: true,
        inspectorBooted: true,
        alreadyHydrated: false,
      }),
    ).toBe(true);
    expect(
      shouldHydrateIframeReplay({
        iframeReady: true,
        inspectorBooted: false,
        alreadyHydrated: false,
      }),
    ).toBe(false);
    expect(
      shouldHydrateIframeReplay({
        iframeReady: true,
        inspectorBooted: true,
        alreadyHydrated: true,
      }),
    ).toBe(false);
  });

  it('reads walking vs speaking from the shared leases', () => {
    expect(guestTownFace({ living: true, speaking: true })).toBe('speaking');
    expect(guestTownFace({ living: true, speaking: false })).toBe('walking');
    expect(guestTownFace({})).toBe('idle');
  });

  it('formats a remaining 镇时 window', () => {
    const now = 1_700_000_000_000;
    expect(leaseRemainingMs(new Date(now + 90_000), now)).toBe(90_000);
    expect(permitRemainParts(0)).toEqual({ kind: 'none' });
    expect(permitRemainParts(10 * 60_000)).toEqual({
      kind: 'minutes',
      minutes: 10,
    });
    expect(permitRemainParts(5 * 60 * 60_000)).toEqual({
      kind: 'hours',
      hours: 5,
      minutes: 0,
    });
  });

  it('lets a guest freeze their view without leaving the shared tip while playing', () => {
    expect(
      shouldFollowSharedCursor({ role: 'guest', viewPaused: false }),
    ).toBe(true);
    expect(
      shouldFollowSharedCursor({ role: 'guest', viewPaused: true }),
    ).toBe(false);
    expect(
      shouldFollowSharedCursor({
        role: 'author',
        viewPaused: false,
        scrubbing: true,
      }),
    ).toBe(false);
  });

  it('rejects stale society snapshots that trail the live cursor', () => {
    expect(isSocietySnapshotBehindLive(232.2, 231.9)).toBe(true);
    expect(isSocietySnapshotBehindLive(232, 232)).toBe(false);
    expect(isSocietySnapshotBehindLive(0, 10)).toBe(false);
    expect(
      societyReloadCursor({
        liveCursor: 232.2,
        snapshotMaxT: 231.9,
        followTip: true,
      }),
    ).toBe(232.2);
    expect(
      shouldPushSocietySnapshotToIframe({
        liveCursor: 232.2,
        snapshotMaxT: 231.9,
        liveReady: true,
      }),
    ).toBe(false);
    expect(
      shouldHydrateWithFullReplay({
        liveCursor: 232.2,
        stashSimTime: 231.9,
      }),
    ).toBe(false);
  });

  it('does not drop a full replay that arrives while a quiet append is in flight', () => {
    expect(
      mergeSocietyReloadOpts({ quiet: true, iframe: 'append' }, { iframe: 'replay' }),
    ).toEqual({ quiet: false, iframe: 'replay' });
    expect(
      mergeSocietyReloadOpts({ iframe: 'none' }, { quiet: true, iframe: 'append' }),
    ).toEqual({ quiet: false, iframe: 'append' });
    expect(
      mergeSocietyReloadOpts({ quiet: true }, { quiet: true, iframe: 'append' }),
    ).toEqual({ quiet: true, iframe: 'append' });
  });

  it('reads hourly talk remaining without inventing a platform count', () => {
    expect(readTalkBudget(null)).toBeNull();
    expect(
      readTalkBudget({ used: 30, cap: 36, remaining: 6, resetsAt: '2026-08-20T05:00:00.000Z' }),
    ).toEqual({
      used: 30,
      cap: 36,
      remaining: 6,
      resetsAt: '2026-08-20T05:00:00.000Z',
      litBonus: 0,
      litUntil: null,
    });
    expect(
      readTalkBudget({
        used: 36,
        cap: 48,
        remaining: 12,
        resetsAt: '2026-08-20T05:00:00.000Z',
        litBonus: 12,
        litUntil: '2026-08-21T04:10:00.000Z',
      }),
    ).toMatchObject({ cap: 48, remaining: 12, litBonus: 12 });
    expect(talkBudgetTone({ remaining: 20, cap: 36 })).toBe('ok');
    expect(talkBudgetTone({ remaining: 6, cap: 36 })).toBe('low');
    expect(talkBudgetTone({ remaining: 0, cap: 36 })).toBe('empty');
    expect(urgeWorldLight('low')).toBe(true);
    expect(urgeWorldLight('empty')).toBe(true);
    expect(urgeWorldLight('ok')).toBe(false);
    expect(urgeWorldLight('ok', true)).toBe(true);
    expect(
      talkBudgetStripLine({
        tone: 'empty',
        remaining: 0,
        cap: 36,
        litBonus: 0,
      }),
    ).toEqual({ key: 'product.obs.fundingWalk' });
    expect(
      talkBudgetStripLine({
        tone: 'ok',
        remaining: 20,
        cap: 48,
        litBonus: 12,
      })?.key,
    ).toBe('product.obs.guestSpeaking');
    expect(
      talkBudgetStripLine({
        tone: 'ok',
        remaining: 20,
        cap: 48,
        litBonus: 12,
        audience: 'guest',
      }),
    ).toEqual({ key: 'product.obs.guestSpeaking' });
    expect(
      JSON.stringify(
        talkBudgetStripLine({
          tone: 'ok',
          remaining: 20,
          cap: 36,
          litBonus: 12,
          audience: 'guest',
        }),
      ),
    ).not.toMatch(/36|80|n\/cap/);
    expect(
      talkBudgetStripLine({
        tone: 'ok',
        remaining: 20,
        cap: 48,
        litBonus: 12,
        audience: 'author',
      })?.key,
    ).toBe('product.obs.sharedTalk');
    expect(
      talkHourResetMinutes('2026-08-20T05:00:00.000Z', Date.parse('2026-08-20T04:40:00.000Z')),
    ).toBe(20);
    expect(shouldClearBudgetMute({ remaining: 0 })).toBe(false);
    expect(shouldClearBudgetMute({ remaining: 12 })).toBe(true);
    expect(
      worldLightUntilLine({
        litBonus: 12,
        now: Date.parse('2026-08-20T04:10:00.000Z'),
      }),
    ).toEqual({ key: 'thisHour' });
    expect(
      worldLightUntilLine({
        litUntil: '2026-08-20T06:10:00.000Z',
        litBonus: 12,
        now: Date.parse('2026-08-20T04:10:00.000Z'),
      }),
    ).toEqual({ key: 'hours', hours: 2, minutes: 0 });
    expect(
      authorTownPulses({ paused: true, funded: false, hasBoard: false }),
    ).toEqual(['paused', 'fund', 'seed']);
    expect(
      authorTownPulses({ paused: false, funded: true, hasBoard: true }),
    ).toEqual([]);
    expect(
      authorTownPulses({ paused: false, funded: true, hasBoard: false }),
    ).toEqual(['seed']);
    expect(
      quietTownSkipReason({
        living: true,
        speaking: false,
        litUntil: null,
        remaining: 0,
        litBonus: 0,
      }),
    ).toBe('budget');
    expect(
      quietTownSkipReason({
        living: true,
        speaking: false,
        litUntil: null,
        remaining: 8,
        litBonus: 8,
      }),
    ).toBeNull();
    expect(
      quietTownSkipReason({
        living: true,
        speaking: true,
        litUntil: null,
        remaining: 0,
        litBonus: 0,
      }),
    ).toBeNull();
    expect(
      quietTownSkipReason({
        living: true,
        speaking: false,
        litUntil: '2099-01-01T00:00:00.000Z',
        remaining: 0,
        litBonus: 0,
      }),
    ).toBeNull();
    expect(guestMuteOverlayKey('budget')).toBe('product.obs.talkFloorEmpty');
    expect(guestMuteOverlayKey('no_permit')).toBe('product.obs.talkFloorEmpty');
    expect(guestMuteOverlayKey('keys_exhausted')).toBe(
      'product.obs.llmKeysExhausted',
    );
    expect(guestMuteOverlayKey('generate')).toBeNull();
  });
});
