/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import { inferMechanicSpec } from './mechanicSpec.js';
import { smokeProbePlan } from './playabilitySmoke.js';

describe('smokeProbePlan', () => {
  it('picks cell-select for 象棋 and keys for snake', () => {
    const chess = smokeProbePlan(inferMechanicSpec('做个中国象棋'));
    expect(chess.mode).toBe('cell-select');
    expect(chess.rejectSpaceShell).toBe(true);
    expect(chess.denseBoard).toBe(true);

    const snake = smokeProbePlan(inferMechanicSpec('做一个贪吃蛇'));
    expect(snake.mode).toBe('keys');
    expect(snake.rejectSpaceShell).toBe(false);
  });

  it('picks place for tower defense', () => {
    const td = smokeProbePlan(inferMechanicSpec('经典塔防，三波敌人'));
    expect(td.mode).toBe('place');
  });

  it('uses keys for mixed 俯视探索 + 象棋, not a dense chess-only probe', () => {
    const mixed = smokeProbePlan(
      inferMechanicSpec('俯视探索小镇，还能下中国象棋，有对话选项'),
    );
    expect(mixed.mode).toBe('keys');
    expect(mixed.rejectSpaceShell).toBe(true);
    expect(mixed.denseBoard).toBe(false);
  });

  it('clicks cells for match-3 without treating it as a SPACE shell', () => {
    const match = smokeProbePlan(inferMechanicSpec('做一个消消乐，三消计分'));
    expect(match.mode).toBe('cell-select');
    expect(match.rejectSpaceShell).toBe(true);
    expect(match.denseBoard).toBe(false);
  });
});
