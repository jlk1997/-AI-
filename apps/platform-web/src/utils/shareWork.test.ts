/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment jsdom
 */

import { describe, expect, it } from 'vitest';

import { canShareTownDays, shareableToPoster, townDaysHeadline, townDaysLived } from './shareWork.js';

describe('shareableToPoster', () => {
  it('puts remix proof on the poster when someone already changed a line', () => {
    expect(
      shareableToPoster({
        slug: 'tiny-town',
        title: 'Tiny Town',
        description: 'hello',
        remixCount: 2,
      }, 'zh-CN').description,
    ).toBe('已被改 2 次');
    expect(
      shareableToPoster({
        slug: 'tiny-town',
        title: 'Tiny Town',
        description: 'hello',
        remixCount: 0,
      }).description,
    ).toBe('hello');
  });

  it('only offers a days-went-by poster after a full sim day', () => {
    expect(townDaysLived(23)).toBe(0);
    expect(townDaysLived(48)).toBe(2);
    expect(canShareTownDays(23)).toBe(false);
    expect(canShareTownDays(30)).toBe(true);
    expect(townDaysHeadline('杏花镇', 50, 'zh-CN').title).toBe('杏花镇 又过了 2 天');
    expect(townDaysHeadline('Apricot Town', 50, 'en').title).toBe(
      'Apricot Town lived another 2 days',
    );
  });
});
