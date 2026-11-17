/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it } from 'vitest';

import type { MyCourseStakeRow, MyCourseWatchRow } from '../../services/api';
import { pushCourseOutcome } from './courseOutcomeInbox';
import {
  courseWatchHubRank,
  listWatchSettledHits,
  pickCourseTonightMineChips,
  sortCourseWatchHubRows,
} from './courseWatchHub';
import { markWatchPulseSeen } from './courseWatchSignals';

function watch(
  partial: Partial<MyCourseWatchRow> & { readonly gameId: string },
): MyCourseWatchRow {
  return {
    slug: partial.slug ?? partial.gameId,
    title: partial.title ?? partial.gameId,
    course: partial.course ?? null,
    ...partial,
  };
}

describe('courseWatchHub', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('ranks pulsing settled ahead of open watches', () => {
    const settled = watch({
      gameId: 'a',
      title: 'A',
      course: {
        nodeId: 'n1',
        prompt: '题',
        status: 'settled',
        pool: 0,
        canon: '成了',
      },
    });
    const open = watch({
      gameId: 'b',
      title: 'B',
      course: {
        nodeId: 'n2',
        prompt: '题2',
        status: 'open',
        pool: 12,
        canon: null,
        bettingClosesAt: '2026-08-24T20:00:00.000Z',
      },
    });
    expect(courseWatchHubRank(settled)).toBeLessThan(courseWatchHubRank(open));
    expect(sortCourseWatchHubRows([open, settled]).map((row) => row.gameId)).toEqual([
      'a',
      'b',
    ]);
  });

  it('lists unseen watch_settled hits for subscribed towns', () => {
    const row = watch({
      gameId: 'g1',
      title: '禾镇',
      course: {
        nodeId: 'n1',
        prompt: '今夜谁走',
        status: 'settled',
        pool: 0,
        canon: '阿禾走了',
      },
    });
    markWatchPulseSeen(row);
    pushCourseOutcome({
      gameId: 'g1',
      nodeId: 'n1',
      kind: 'watch_settled',
      canon: '阿禾走了',
      at: Date.now(),
    });
    const hits = listWatchSettledHits([row]);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.watch.title).toBe('禾镇');
  });

  it('reserves pulse watch chips ahead of a full stake strip', () => {
    const stakes: MyCourseStakeRow[] = Array.from({ length: 6 }, (_, i) => ({
      gameId: `s${i}`,
      slug: `stake-${i}`,
      title: `Stake ${i}`,
      nodeId: `n-s${i}`,
      prompt: '题',
      status: 'open',
      myPoints: 12,
      myOptionLabel: '走',
      pool: 24,
      contested: true,
      bettingClosesAt: '2026-08-24T20:00:00.000Z',
      settlesAt: '2026-08-25T02:00:00.000Z',
      actKey: null,
    }));
    const settled = watch({
      gameId: 'w-set',
      title: '出结果镇',
      course: {
        nodeId: 'nw',
        prompt: '旧题',
        status: 'settled',
        pool: 0,
        canon: '阿禾走了',
      },
    });
    const chips = pickCourseTonightMineChips(stakes, [settled], 6, 2);
    expect(chips[0]).toMatchObject({ kind: 'watch', row: { gameId: 'w-set' } });
    expect(chips.filter((c) => c.kind === 'stake')).toHaveLength(5);
    expect(chips).toHaveLength(6);
  });
});
