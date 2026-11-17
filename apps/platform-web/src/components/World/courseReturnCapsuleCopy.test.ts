/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import { courseReturnCapsuleCopy } from './courseReturnCapsuleCopy';

describe('courseReturnCapsuleCopy', () => {
  it('prefers a single open-watch town name', () => {
    const copy = courseReturnCapsuleCopy({
      unseen: 0,
      activeStakes: [],
      liveWatches: [],
      watchOnly: [
        {
          gameId: 'g1',
          slug: 'town',
          title: '禾镇',
          course: {
            prompt: '题',
            status: 'open',
            pool: 12,
            canon: null,
            bettingClosesAt: '2026-08-24T12:00:00.000Z',
          },
        },
      ],
    });
    expect(copy.key).toBe('product.obs.course.returnCapsule.watchOpenOne');
    expect(copy.vars?.town).toBe('禾镇');
  });

  it('prefers settled results over open watches', () => {
    const copy = courseReturnCapsuleCopy({
      unseen: 0,
      activeStakes: [],
      liveWatches: [],
      watchOnly: [
        {
          gameId: 'g-open',
          slug: 'open',
          title: '开压镇',
          course: {
            prompt: '题',
            status: 'open',
            pool: 12,
            canon: null,
            bettingClosesAt: '2026-08-24T12:00:00.000Z',
          },
        },
        {
          gameId: 'g-set',
          slug: 'set',
          title: '出结果镇',
          course: {
            prompt: '旧题',
            status: 'settled',
            pool: 0,
            canon: '阿禾走了',
          },
        },
      ],
    });
    expect(copy.key).toBe('product.obs.course.returnCapsule.watchSettledOne');
    expect(copy.vars?.town).toBe('出结果镇');
  });

  it('falls back to outcome count when unseen', () => {
    const copy = courseReturnCapsuleCopy({
      unseen: 2,
      activeStakes: [],
      liveWatches: [],
      watchOnly: [],
    });
    expect(copy.key).toBe('product.obs.course.returnCapsule.outcomes');
    expect(copy.vars?.n).toBe('2');
  });
});
