/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it } from 'vitest';

import type { MyCourseStakeRow, MyCourseWatchRow } from '../../services/api';
import { pickReturnTarget } from './CourseReturnCapsule';
import { pushCourseOutcome } from './courseOutcomeInbox';
import { markWatchPulseSeen } from './courseWatchSignals';

function stake(partial: Partial<MyCourseStakeRow> = {}): MyCourseStakeRow {
  return {
    gameId: 's1',
    slug: 'stake-town',
    title: 'Stake Town',
    nodeId: 'n1',
    prompt: '题',
    status: 'open',
    myPoints: 12,
    myOptionLabel: '走',
    pool: 24,
    contested: true,
    bettingClosesAt: '2026-08-24T20:00:00.000Z',
    settlesAt: '2026-08-25T02:00:00.000Z',
    actKey: null,
    ...partial,
  };
}

function watch(partial: Partial<MyCourseWatchRow> = {}): MyCourseWatchRow {
  return {
    gameId: 'w1',
    slug: 'watch-town',
    title: 'Watch Town',
    course: {
      nodeId: 'nw1',
      prompt: '今夜谁走',
      status: 'open',
      pool: 36,
      canon: null,
      bettingClosesAt: '2026-08-24T20:00:00.000Z',
      settlesAt: '2026-08-25T02:00:00.000Z',
    },
    ...partial,
  };
}

describe('pickReturnTarget', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('prefers a pulsing open watch over an active stake', () => {
    const target = pickReturnTarget([stake()], [watch()]);
    expect(target?.gameId).toBe('w1');
    expect(target?.viaWatch).toBe(true);
  });

  it('prefers pulsing settled over pulsing open', () => {
    const openRow = watch({ gameId: 'open1', slug: 'open-town', title: 'Open' });
    const settledRow = watch({
      gameId: 'set1',
      slug: 'set-town',
      title: 'Settled',
      course: {
        nodeId: 'ns1',
        prompt: '旧题',
        status: 'settled',
        pool: 0,
        canon: '阿禾走了',
      },
    });
    const target = pickReturnTarget([], [openRow, settledRow]);
    expect(target?.gameId).toBe('set1');
    expect(target?.viaWatch).toBe(true);
  });

  it('falls back to stake when watch pulse is already seen', () => {
    const row = watch();
    markWatchPulseSeen(row);
    const target = pickReturnTarget([stake()], [row]);
    expect(target?.gameId).toBe('s1');
    expect(target?.viaWatch).toBe(false);
  });

  it('prefers unseen outcome town when no pulse', () => {
    const settled = watch({
      gameId: 'out1',
      slug: 'out-town',
      course: {
        nodeId: 'n-out',
        prompt: '旧题',
        status: 'settled',
        pool: 0,
        canon: '阿禾走了',
      },
    });
    markWatchPulseSeen(settled);
    pushCourseOutcome({
      gameId: 'out1',
      nodeId: 'n-out',
      kind: 'watch_settled',
      at: Date.now(),
    });
    const target = pickReturnTarget([], [settled]);
    expect(target?.gameId).toBe('out1');
    expect(target?.viaWatch).toBe(true);
  });
});
