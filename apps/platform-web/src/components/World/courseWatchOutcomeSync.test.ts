/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it } from 'vitest';

import type { MyCourseWatchRow } from '../../services/api';
import { listUnseenCourseOutcomes } from './courseOutcomeInbox';
import {
  markWatchPulseSeen,
  scheduleWatchPulseConsume,
  shouldPulseWatch,
} from './courseWatchSignals';
import {
  applyCourseWatchRows,
  syncWatchMilestoneOutcomes,
} from './courseWatchOutcomeSync';

function settledWatch(): MyCourseWatchRow {
  return {
    gameId: 'g1',
    slug: 'town',
    title: 'Town',
    course: {
      nodeId: 'node-1',
      prompt: '今夜谁走',
      status: 'settled',
      pool: 0,
      canon: '阿禾走了',
      bettingClosesAt: '2026-08-24T12:00:00.000Z',
      settlesAt: '2026-08-24T16:00:00.000Z',
    },
  };
}

describe('syncWatchMilestoneOutcomes', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('pushes unseen watch_settled rows into the inbox', () => {
    const row = settledWatch();
    syncWatchMilestoneOutcomes([row]);
    const unseen = listUnseenCourseOutcomes('g1');
    expect(unseen).toHaveLength(1);
    expect(unseen[0]?.kind).toBe('watch_settled');
    expect(unseen[0]?.nodeId).toBe('node-1');
  });

  it('skips after pulse is consumed', () => {
    const row = settledWatch();
    markWatchPulseSeen(row);
    syncWatchMilestoneOutcomes([row]);
    expect(listUnseenCourseOutcomes('g1')).toHaveLength(0);
  });

  it('applyCourseWatchRows syncs before consuming pending pulse', () => {
    const row = settledWatch();
    scheduleWatchPulseConsume(row.gameId);
    expect(shouldPulseWatch(row)).toBe(true);
    applyCourseWatchRows([row]);
    const unseen = listUnseenCourseOutcomes('g1');
    expect(unseen).toHaveLength(1);
    expect(unseen[0]?.kind).toBe('watch_settled');
    expect(shouldPulseWatch(row)).toBe(false);
  });
});
