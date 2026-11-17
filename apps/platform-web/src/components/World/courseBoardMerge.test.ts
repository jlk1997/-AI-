/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import type { CourseBoard, CourseView } from '../../services/api';
import { mergeCourseBoardKeepExtras, mergeCourseBoardPoll } from './courseBoardMerge';

function view(partial: Partial<CourseView> & { readonly id: string }): CourseView {
  return {
    worldId: 'w1',
    gameId: 'g1',
    prompt: '题',
    kind: 'binary',
    status: 'open',
    opensAt: '2026-08-24T12:00:00.000Z',
    bettingClosesAt: '2026-08-24T20:00:00.000Z',
    settlesAt: '2026-08-25T02:00:00.000Z',
    mutedHint: false,
    pool: 12,
    minStake: 12,
    myPoints: 0,
    myOptionId: null,
    options: [],
    winningOptionId: null,
    voidReason: null,
    transcriptHash: null,
    canon: null,
    maxAdd: 48,
    addSteps: [12, 24, 48],
    hangs: [],
    contested: false,
    ...partial,
  };
}

describe('mergeCourseBoardKeepExtras', () => {
  it('keeps watching and queued after a stake patch', () => {
    const prev: CourseBoard = {
      current: view({ id: 'n1', myPoints: 0 }),
      history: [],
      watching: true,
      queued: view({ id: 'q1', prompt: '下一题' }),
    };
    const next = mergeCourseBoardKeepExtras(prev, {
      current: view({ id: 'n1', myPoints: 12 }),
      history: [],
    });
    expect(next.watching).toBe(true);
    expect(next.queued?.id).toBe('q1');
    expect(next.current?.myPoints).toBe(12);
  });

  it('prefers API watching on poll but keeps prev when absent', () => {
    const prev: CourseBoard = {
      current: view({ id: 'n1' }),
      history: [],
      watching: true,
      queued: view({ id: 'q1', prompt: '下一题' }),
    };
    const polled: CourseBoard = {
      current: view({ id: 'n1', pool: 48 }),
      history: [],
      watching: false,
    };
    const merged = mergeCourseBoardPoll(prev, polled);
    expect(merged.watching).toBe(false);
    expect(merged.queued?.id).toBe('q1');
    expect(merged.current?.pool).toBe(48);
  });

  it('keeps prev watching when poll omits the field', () => {
    const prev: CourseBoard = {
      current: view({ id: 'n1' }),
      history: [],
      watching: true,
    };
    const polled: CourseBoard = {
      current: view({ id: 'n1', pool: 24 }),
      history: [],
    };
    expect(mergeCourseBoardPoll(prev, polled).watching).toBe(true);
  });
});
