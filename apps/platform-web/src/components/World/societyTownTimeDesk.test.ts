/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import { scrollOffsetToChild, townLampTitleKey } from './societyTownTimeDesk';

describe('town lamp copy', () => {
  it('names the ceremony from the last 镇时 sku', () => {
    expect(townLampTitleKey('day')).toBe('product.obs.lampDay');
    expect(townLampTitleKey('week')).toBe('product.obs.lampWeek');
    expect(townLampTitleKey('month')).toBe('product.obs.lampMonth');
  });

  it('scrolls a nested overflow parent so the light desk is not off-canvas', () => {
    expect(scrollOffsetToChild(80, 400, 520, 12)).toBe(188);
    expect(scrollOffsetToChild(0, 100, 80, 12)).toBe(0);
  });
});
