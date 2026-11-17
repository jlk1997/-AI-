/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import { inferIntakeDefaults } from './designIntake';

describe('inferIntakeDefaults', () => {
  it('preselects grid_logic for 中国象棋 and English chess', () => {
    const cn = inferIntakeDefaults('做个中国象棋，双人本地，点选，将死');
    expect(cn.preferredArchetype).toBe('grid_logic');
    expect(cn.winFeel).toBe('clear_level');

    const en = inferIntakeDefaults('make a two-player chess game');
    expect(en.preferredArchetype).toBe('grid_logic');
    expect(en.winFeel).toBe('clear_level');
  });

  it('preselects top_down for 俯视探索 + 象棋, not an exclusive chess SKU', () => {
    const mixed = inferIntakeDefaults('俯视探索小镇，还能下中国象棋，有对话选项');
    expect(mixed.preferredArchetype).toBe('top_down');
    expect(mixed.winFeel).toBe('story_ending');
  });

  it('preselects top_down for 俯视探索 + 消消乐', () => {
    const mixed = inferIntakeDefaults('俯视探索小镇，还能玩消消乐');
    expect(mixed.preferredArchetype).toBe('top_down');
  });

  it('keeps snake as high-score grid', () => {
    const snake = inferIntakeDefaults('做一个贪吃蛇');
    expect(snake.preferredArchetype).toBe('grid_logic');
    expect(snake.winFeel).toBe('high_score');
  });
});
