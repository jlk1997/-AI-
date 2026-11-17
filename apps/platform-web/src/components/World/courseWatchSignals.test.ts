/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment jsdom
 */

import { describe, expect, it, beforeEach } from 'vitest';

import type { MyCourseWatchRow } from '../../services/api';
import {
  consumePendingWatchPulse,
  markWatchPulseSeen,
  scheduleWatchPulseConsume,
  shouldPulseWatch,
  watchPulseKind,
} from './courseWatchSignals';

function row(partial: Partial<MyCourseWatchRow> = {}): MyCourseWatchRow {
  return {
    gameId: 'g1',
    slug: 'town',
    title: 'Town',
    course: {
      prompt: '今夜谁走',
      status: 'open',
      pool: 12,
      canon: null,
      bettingClosesAt: '2026-08-24T12:00:00.000Z',
    },
    ...partial,
  };
}

describe('courseWatchSignals', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('pulses once per open board fingerprint', () => {
    const watch = row();
    expect(watchPulseKind(watch)).toBe('open');
    expect(shouldPulseWatch(watch)).toBe(true);
    markWatchPulseSeen(watch);
    expect(shouldPulseWatch(watch)).toBe(false);
  });

  it('pulses again when a new board opens', () => {
    const watch = row();
    markWatchPulseSeen(watch);
    const next = row({
      course: {
        prompt: '下一题',
        status: 'open',
        pool: 0,
        canon: null,
        bettingClosesAt: '2026-08-25T12:00:00.000Z',
      },
    });
    expect(shouldPulseWatch(next)).toBe(true);
  });

  it('pulses settled canon for watchers', () => {
    const settled = row({
      course: {
        prompt: '昨夜题',
        status: 'settled',
        pool: 0,
        canon: '阿禾走了',
      },
    });
    expect(watchPulseKind(settled)).toBe('settled');
    expect(shouldPulseWatch(settled)).toBe(true);
  });

  it('consumes pending watch push landings', () => {
    const watch = row();
    scheduleWatchPulseConsume('g1');
    expect(shouldPulseWatch(watch)).toBe(true);
    expect(consumePendingWatchPulse([watch])).toBe(true);
    expect(shouldPulseWatch(watch)).toBe(false);
  });
});
