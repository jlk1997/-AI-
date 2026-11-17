/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { courseStakes, courseWatches } = vi.hoisted(() => ({
  courseStakes: vi.fn(),
  courseWatches: vi.fn(),
}));

vi.mock('../../services/api', () => ({
  api: {
    me: {
      courseStakes: (...args: unknown[]) => courseStakes(...args),
      courseWatches: (...args: unknown[]) => courseWatches(...args),
    },
  },
}));

import {
  __isMyCourseTonightBootstrappedForTests,
  __resetMyCourseTonightStoreForTests,
  __subscribeMyCourseTonightForTests,
  getMyCourseTonightSnapshot,
  refreshMyCourseTonight,
} from './myCourseTonightStore';

describe('myCourseTonightStore', () => {
  beforeEach(() => {
    __resetMyCourseTonightStoreForTests();
    courseStakes.mockReset();
    courseWatches.mockReset();
    courseWatches.mockResolvedValue({ watches: [] });
  });

  afterEach(() => {
    __resetMyCourseTonightStoreForTests();
  });

  it('coalesces concurrent refresh into one follow-up fetch', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    courseStakes.mockImplementation(() =>
      gate.then(() => ({
        stakes: [{ gameId: 'g1', slug: 'town', title: 'T', status: 'open', myPoints: 12 }],
      })),
    );

    const first = refreshMyCourseTonight('manual');
    const second = refreshMyCourseTonight('event');
    release();
    await first;
    await second;

    expect(courseStakes).toHaveBeenCalledTimes(2);
    expect(getMyCourseTonightSnapshot().stakes[0]?.gameId).toBe('g1');
  });

  it('skips a mount refresh when the snapshot is still fresh', async () => {
    courseStakes.mockResolvedValue({ stakes: [] });
    await refreshMyCourseTonight('manual');
    courseStakes.mockClear();
    await refreshMyCourseTonight('mount');
    expect(courseStakes).not.toHaveBeenCalled();
    await refreshMyCourseTonight('event');
    expect(courseStakes).toHaveBeenCalledTimes(1);
  });

  it('tears down bootstrap when the last subscriber unsubscribes', () => {
    expect(__isMyCourseTonightBootstrappedForTests()).toBe(false);
    const stopA = __subscribeMyCourseTonightForTests(() => undefined);
    const stopB = __subscribeMyCourseTonightForTests(() => undefined);
    expect(__isMyCourseTonightBootstrappedForTests()).toBe(true);
    stopA();
    expect(__isMyCourseTonightBootstrappedForTests()).toBe(true);
    stopB();
    expect(__isMyCourseTonightBootstrappedForTests()).toBe(false);
  });
});
