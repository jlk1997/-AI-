/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import {
  courseActIndex,
  courseActLabelKey,
  courseActPrimaryNoteKey,
  courseActDisplay,
  courseActDisplayLabelKey,
  courseCanAuthorReplace,
  courseCanAuthorQueue,
  courseInEvidencePhase,
  courseSettlementState,
  courseSettlementTitleKey,
} from './courseAct.js';

describe('courseAct', () => {
  const future = new Date(Date.now() + 60_000).toISOString();
  const past = new Date(Date.now() - 60_000).toISOString();

  it('maps board status to three acts', () => {
    expect(
      courseActIndex({
        status: 'open',
        bettingClosesAt: future,
      }),
    ).toBe(1);
    expect(
      courseActIndex({
        status: 'closed',
        bettingClosesAt: past,
      }),
    ).toBe(2);
    expect(
      courseActIndex({
        status: 'open',
        bettingClosesAt: past,
      }),
    ).toBe(2);
    expect(
      courseActIndex({
        status: 'settled',
        bettingClosesAt: past,
      }),
    ).toBe(3);
    expect(courseActIndex(null)).toBeNull();
  });

  it('labels acts for the progress bar', () => {
    expect(courseActLabelKey(1)).toBe('product.obs.course.act.bet');
    expect(courseActLabelKey(2)).toBe('product.obs.course.act.evidence');
    expect(courseActLabelKey(3)).toBe('product.obs.course.act.result');
  });

  it('blocks author replace when contested', () => {
    expect(
      courseCanAuthorReplace({ status: 'open', contested: true }),
    ).toEqual({
      ok: false,
      reasonKey: 'product.obs.course.replace.blockedContested',
    });
    expect(
      courseCanAuthorReplace({ status: 'open', contested: false }),
    ).toEqual({ ok: true });
    expect(courseCanAuthorReplace({ status: 'settled', contested: true })).toEqual({
      ok: true,
    });
  });

  it('gates author queue while a board is live', () => {
    expect(
      courseCanAuthorQueue({ current: { status: 'open' }, queued: null }),
    ).toEqual({ ok: true });
    expect(
      courseCanAuthorQueue({ current: { status: 'open' }, queued: { id: 'q' } }),
    ).toEqual({
      ok: false,
      reasonKey: 'product.obs.course.queue.full',
    });
    expect(courseCanAuthorQueue({ current: null, queued: null })).toEqual({
      ok: false,
      reasonKey: 'product.obs.course.queue.noActive',
    });
  });

  it('picks one primary note per act', () => {
    expect(
      courseActPrimaryNoteKey({
        view: { status: 'open', bettingClosesAt: future, reachability: 'low' },
        inEvidence: false,
      }),
    ).toBe('product.obs.course.reachability.low');
    expect(
      courseActPrimaryNoteKey({
        view: { status: 'closed', bettingClosesAt: past },
        inEvidence: true,
        stakedEvidenceKey: 'product.obs.course.stakedLeading',
      }),
    ).toBe('product.obs.course.stakedLeading');
    expect(
      courseActPrimaryNoteKey({
        view: { status: 'settled', bettingClosesAt: past },
        inEvidence: false,
      }),
    ).toBeNull();
  });

  it('treats closed boards and post-betting open boards as evidence phase', () => {
    expect(
      courseInEvidencePhase({ status: 'closed', bettingClosesAt: past }),
    ).toBe(true);
    expect(
      courseInEvidencePhase({ status: 'open', bettingClosesAt: past }),
    ).toBe(true);
    expect(
      courseInEvidencePhase({ status: 'open', bettingClosesAt: future }),
    ).toBe(false);
  });

  it('names settlement posture for guests', () => {
    expect(
      courseSettlementState({
        status: 'settled',
        myPoints: 12,
        myOptionId: 'a',
        winningOptionId: 'a',
      }),
    ).toBe('win');
    expect(
      courseSettlementState({
        status: 'settled',
        myPoints: 12,
        myOptionId: 'a',
        winningOptionId: 'b',
      }),
    ).toBe('lose');
    expect(
      courseSettlementState({
        status: 'void',
        myPoints: 12,
        myOptionId: 'a',
        voidReason: 'muted',
      }),
    ).toBe('void');
    expect(courseSettlementTitleKey('win')).toBe(
      'product.obs.course.settlement.win',
    );
  });

  describe('courseActDisplay (5-act presentation)', () => {
    const now = Date.parse('2026-04-01T12:00:00.000Z');

    it('returns act 1 for open board with >5 min to close', () => {
      expect(
        courseActDisplay(
          {
            status: 'open',
            bettingClosesAt: new Date(now + 60 * 60_000).toISOString(),
            settlesAt: new Date(now + 8 * 60 * 60_000).toISOString(),
          },
          now,
        ),
      ).toBe(1);
    });

    it('returns act 2 for open board within 5 min of close', () => {
      expect(
        courseActDisplay(
          {
            status: 'open',
            bettingClosesAt: new Date(now + 3 * 60_000).toISOString(),
            settlesAt: new Date(now + 4 * 60 * 60_000).toISOString(),
          },
          now,
        ),
      ).toBe(2);
    });

    it('returns act 3 for closed board with >30s to settle', () => {
      expect(
        courseActDisplay(
          {
            status: 'closed',
            bettingClosesAt: new Date(now - 60_000).toISOString(),
            settlesAt: new Date(now + 30 * 60_000).toISOString(),
          },
          now,
        ),
      ).toBe(3);
    });

    it('returns act 4 for closed board within 30s of settle', () => {
      expect(
        courseActDisplay(
          {
            status: 'closed',
            bettingClosesAt: new Date(now - 60_000).toISOString(),
            settlesAt: new Date(now + 10_000).toISOString(),
          },
          now,
        ),
      ).toBe(4);
    });

    it('returns act 5 for settled/voided boards', () => {
      expect(
        courseActDisplay(
          {
            status: 'settled',
            bettingClosesAt: new Date(now - 60_000).toISOString(),
            settlesAt: new Date(now - 1).toISOString(),
          },
          now,
        ),
      ).toBe(5);
      expect(
        courseActDisplay(
          {
            status: 'voided',
            bettingClosesAt: new Date(now - 60_000).toISOString(),
            settlesAt: new Date(now - 1).toISOString(),
          },
          now,
        ),
      ).toBe(5);
    });

    it('returns null for null view', () => {
      expect(courseActDisplay(null, now)).toBeNull();
    });

    it('labels every act to a stable i18n key', () => {
      expect(courseActDisplayLabelKey(1)).toBe('product.obs.course.act5.open');
      expect(courseActDisplayLabelKey(2)).toBe('product.obs.course.act5.closing');
      expect(courseActDisplayLabelKey(3)).toBe('product.obs.course.act5.evidence');
      expect(courseActDisplayLabelKey(4)).toBe('product.obs.course.act5.settling');
      expect(courseActDisplayLabelKey(5)).toBe('product.obs.course.act5.done');
    });
  });
});
