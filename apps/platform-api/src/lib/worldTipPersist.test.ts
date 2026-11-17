/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import { isWorldTipConflict, nextWorldTipVersion } from './worldTipPersist.js';

describe('nextWorldTipVersion', () => {
  it('advances past both the stored tip and the spec version', () => {
    expect(nextWorldTipVersion(3, 1)).toBe(4);
    expect(nextWorldTipVersion(3, 10)).toBe(10);
    expect(nextWorldTipVersion(0, 0)).toBe(1);
  });
});

describe('isWorldTipConflict', () => {
  it('only matches the restore/patch conflict sentinel', () => {
    expect(isWorldTipConflict(new Error('world_tip_conflict'))).toBe(true);
    expect(isWorldTipConflict(new Error('not enough points'))).toBe(false);
    expect(isWorldTipConflict('world_tip_conflict')).toBe(false);
  });
});
