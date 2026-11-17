/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import { createEmitter, emitRadial, hitTest, stepBullets } from './index.js';

describe('module-emitter', () => {
  it('emits a ring, steps, and reports a hit', () => {
    let state = createEmitter();
    state = emitRadial(state, 0, 0, 4, 10);
    expect(state.bullets).toHaveLength(4);
    state = stepBullets(state, 1, { minX: -100, minY: -100, maxX: 100, maxY: 100 });
    expect(state.bullets[0]?.x).toBeCloseTo(10);
    expect(hitTest(state.bullets, 10, 0, 0.2)).toBe(state.bullets[0]?.id ?? null);
    const gone = stepBullets(state, 20, {
      minX: -5,
      minY: -5,
      maxX: 5,
      maxY: 5,
    });
    expect(gone.bullets.every((b) => !b.alive)).toBe(true);
  });
});
