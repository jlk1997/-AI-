/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import {
  authorSeedCtaKey,
  availableCourseSeedPicks,
  courseBoardEmptyKey,
  courseEvidenceQuietKey,
  courseEvidenceQuietWarning,
  courseGuestReachabilityNoteKey,
  courseInEvidencePhase,
  coursePlayLineKey,
  coursePollingIntervalMs,
  coursePromptPreview,
  courseReachabilityTagForPick,
  courseReachabilityTagKey,
  courseGuestReachabilityWarning,
  courseSeedPickNeedsForm,
  courseSeedPickRecommendKind,
  courseRecommendNeedsPost,
  courseStakedEvidenceKey,
  courseCanAuthorReplace,
  minimalWorldSpecFromProfile,
  courseAuthorRecommendHintKey,
  genreProfileFromWorldSpec,
  courseActIndex,
  courseActLabelKey,
  authorSeedTownMeta,
  formatAuthorSeedTownMeta,
  authorReplacePreviewPrompt,
  coursePulseShouldFocusDesk,
  coursePulseShouldOpenSheet,
  guestCourseChromeKey,
  guestDeskOpenFolds,
} from './courseAuthorFlow';

describe('course author flow', () => {
  it('offers town-bound picks without jargon and always keeps auto + write', () => {
    expect(
      availableCourseSeedPicks({
        villagePack: false,
        residentCount: 0,
        placeCount: 1,
        hasTalks: false,
      }),
    ).toEqual(['auto', 'custom']);
    expect(
      availableCourseSeedPicks({
        villagePack: true,
        residentCount: 2,
        placeCount: 3,
        hasTalks: true,
      }),
    ).toEqual(['auto', 'village', 'resident', 'places', 'talks', 'custom']);
  });

  it('only asks the author to edit when the pick has a form', () => {
    expect(courseSeedPickNeedsForm('auto')).toBe(false);
    expect(courseSeedPickNeedsForm('village')).toBe(false);
    expect(courseSeedPickNeedsForm('resident')).toBe(true);
    expect(courseSeedPickNeedsForm('custom')).toBe(true);
  });

  it('names the author CTA by whether tonight already has a board', () => {
    expect(authorSeedCtaKey(null)).toBe('product.obs.course.authorTitle');
    expect(authorSeedCtaKey('open')).toBe('product.obs.course.modal.replaceShort');
    expect(authorSeedCtaKey('closed')).toBe('product.obs.course.modal.replaceShort');
    expect(authorSeedCtaKey('settled')).toBe('product.obs.course.seedNext');
    expect(authorSeedCtaKey('void')).toBe('product.obs.course.seedNext');
  });

  it('opens 说一句 during evidence and keeps stake as the betting CTA', () => {
    expect(guestDeskOpenFolds('open')).toEqual([]);
    expect(guestDeskOpenFolds('closed')).toEqual(['whisper']);
    expect(guestCourseChromeKey('open')).toBe('product.obs.course.goStake');
    expect(guestCourseChromeKey('closed')).toBe('product.obs.course.goBoard');
  });

  it('keeps the map wall clock prompt short', () => {
    expect(coursePromptPreview('桂花今夜还在镇上')).toBe('桂花今夜还在镇上');
    expect(coursePromptPreview('x'.repeat(40)).endsWith('…')).toBe(true);
  });

  it('maps author picks to recommend API kinds', () => {
    expect(courseSeedPickRecommendKind('auto')).toBe('auto');
    expect(courseSeedPickRecommendKind('village')).toBe('night_market');
    expect(courseSeedPickRecommendKind('resident')).toBe('binary');
    expect(courseSeedPickRecommendKind('places')).toBe('places');
    expect(courseSeedPickRecommendKind('talks')).toBe('talks');
    expect(courseSeedPickRecommendKind('custom')).toBeNull();
  });

  it('uses POST recommend when prompt and options are present', () => {
    expect(courseRecommendNeedsPost({ prompt: '今夜', options: [{ label: 'a' }] })).toBe(
      false,
    );
    expect(
      courseRecommendNeedsPost({
        prompt: '今夜谁走',
        options: [{ label: '留下' }, { label: '出走' }],
      }),
    ).toBe(true);
  });

  it('maps reachability tags for author confirmation', () => {
    expect(
      courseReachabilityTagKey(
        courseReachabilityTagForPick({ pick: 'talks', reachability: 'high' }),
      ),
    ).toBe('product.obs.course.reachability.talks');
    expect(
      courseReachabilityTagKey(
        courseReachabilityTagForPick({ pick: 'custom', reachability: 'low' }),
      ),
    ).toBe('product.obs.course.reachability.low');
  });

  it('names empty boards when ensure was blocked by funding', () => {
    expect(courseBoardEmptyKey({ skipReason: 'unfunded' })).toBe(
      'product.obs.course.skipUnfunded',
    );
    expect(courseBoardEmptyKey({ skipReason: 'unfunded', isAuthor: true })).toBe(
      'product.obs.course.skipUnfundedAuthor',
    );
  });

  it('warns guests on low-reachability boards while betting is open', () => {
    expect(
      courseGuestReachabilityWarning({
        status: 'open',
        reachability: 'low',
      }),
    ).toBe(true);
    expect(
      courseGuestReachabilityWarning({
        status: 'closed',
        reachability: 'low',
      }),
    ).toBe(false);
    expect(
      courseGuestReachabilityWarning({
        status: 'open',
        reachability: 'low',
        isAuthor: true,
      }),
    ).toBe(false);
  });

  it('treats closed boards and post-betting open boards as evidence phase', () => {
    const closesAt = new Date(Date.now() - 60_000).toISOString();
    expect(
      courseInEvidencePhase({ status: 'closed', bettingClosesAt: closesAt }),
    ).toBe(true);
    expect(
      courseInEvidencePhase({
        status: 'open',
        bettingClosesAt: closesAt,
      }),
    ).toBe(true);
    expect(
      courseInEvidencePhase({
        status: 'open',
        bettingClosesAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    ).toBe(false);
  });

  it('switches play copy and polling by phase', () => {
    const closesAt = new Date(Date.now() + 60_000).toISOString();
    expect(
      coursePlayLineKey({
        status: 'open',
        bettingClosesAt: closesAt,
      }),
    ).toBe('product.obs.course.playLine');
    expect(
      coursePlayLineKey({
        status: 'closed',
        bettingClosesAt: closesAt,
      }),
    ).toBe('product.obs.course.playLineEvidence');
    expect(coursePollingIntervalMs({ status: 'closed' })).toBe(2_500);
    expect(coursePollingIntervalMs({ status: 'open', myPoints: 12 })).toBe(
      3_000,
    );
  });

  it('names staked-side evidence posture during the window', () => {
    expect(
      courseStakedEvidenceKey({
        inEvidence: true,
        myOptionId: 'a',
        myPoints: 12,
        leadingOptionId: 'a',
        hitsByOption: { a: 2 },
      }),
    ).toBe('product.obs.course.stakedLeading');
    expect(
      courseStakedEvidenceKey({
        inEvidence: true,
        myOptionId: 'a',
        myPoints: 12,
        leadingOptionId: 'b',
        hitsByOption: { a: 0, b: 2 },
      }),
    ).toBe('product.obs.course.stakedBehind');
  });

  it('warns after half an hour of silence in betting or evidence', () => {
    const opensAt = new Date(Date.now() - 31 * 60_000).toISOString();
    const bettingClosesAt = new Date(Date.now() - 31 * 60_000).toISOString();
    expect(
      courseEvidenceQuietWarning({
        status: 'closed',
        evidenceHealth: 'none',
        opensAt,
        bettingClosesAt,
      }),
    ).toBe(true);
    expect(
      courseEvidenceQuietKey({
        status: 'closed',
        opensAt,
        bettingClosesAt,
      }),
    ).toBe('product.obs.course.evidenceQuietEvidence');
  });

  it('shows medium reachability copy for guests while betting', () => {
    expect(
      courseGuestReachabilityNoteKey({
        status: 'open',
        reachability: 'medium',
      }),
    ).toBe('product.obs.course.reachability.mediumGuest');
  });

  it('summarizes town context for author pick step', () => {
    const meta = authorSeedTownMeta({
      talkCount: 3,
      placeCount: 4,
      residentCount: 2,
      villagePack: true,
    });
    const line = formatAuthorSeedTownMeta(meta, (key, vars) =>
      vars?.n ? `${key}:${vars.n}` : key,
    );
    expect(line).toContain('talkCount:3');
    expect(line).toContain('villagePack');
  });

  it('focuses the desk or sheet on meaningful board pulses', () => {
    expect(coursePulseShouldFocusDesk({ kind: 'opposed' }, false)).toBe(true);
    expect(coursePulseShouldFocusDesk({ kind: 'closed' }, false)).toBe(false);
    expect(coursePulseShouldFocusDesk({ kind: 'closed' }, true)).toBe(true);
    expect(coursePulseShouldOpenSheet({ kind: 'won' }, true)).toBe(true);
    expect(coursePulseShouldOpenSheet({ kind: 'won' }, false)).toBe(false);
  });

  it('previews the next author prompt before replacing a board', () => {
    expect(
      authorReplacePreviewPrompt({
        pick: 'custom',
        prompt: '桂花还在吗',
        pickLabel: 'custom',
      }),
    ).toBe('桂花还在吗');
    expect(
      authorReplacePreviewPrompt({
        pick: 'auto',
        prompt: '',
        pickLabel: 'auto pick',
      }),
    ).toBe('auto pick');
  });

  it('blocks author replace when the board is contested', () => {
    expect(
      courseCanAuthorReplace({ status: 'open', contested: true }),
    ).toEqual({
      ok: false,
      reasonKey: 'product.obs.course.replace.blockedContested',
    });
    expect(courseActIndex({ status: 'open', bettingClosesAt: new Date(Date.now() + 60_000).toISOString() })).toBe(1);
    expect(courseActLabelKey(2)).toBe('product.obs.course.act.evidence');
  });

  it('picks genre-aware recommend hints', () => {
    expect(
      courseAuthorRecommendHintKey({ genreId: 'horror_mystery', packId: 'society.town' }),
    ).toBe('product.obs.course.recommend.genre.mystery');
    expect(
      courseAuthorRecommendHintKey({ packId: 'society.crew', villagePack: false }),
    ).toBe('product.obs.course.recommend.genre.crew');
    expect(
      courseAuthorRecommendHintKey({ villagePack: true }),
    ).toBe('product.obs.course.recommend.genre.village');
  });

  it('builds minimal world spec for author surfaces', () => {
    expect(
      genreProfileFromWorldSpec(
        minimalWorldSpecFromProfile({
          genreId: 'horror_mystery',
          packId: 'society.crew',
        }),
      ),
    ).toEqual({ genreId: 'horror_mystery', packId: 'society.crew' });
  });
});
