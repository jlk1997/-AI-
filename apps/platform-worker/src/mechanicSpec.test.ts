/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import {
  detectBoardKind,
  formatMechanicSpecForCoder,
  inferMechanicSpec,
} from './mechanicSpec.js';

describe('detectBoardKind', () => {
  it('maps 中国象棋 / 象棋 to xiangqi and English chess to chess', () => {
    expect(detectBoardKind('做个中国象棋，双人本地，点选，将死')).toBe('xiangqi');
    expect(detectBoardKind('象棋')).toBe('xiangqi');
    expect(detectBoardKind('xiangqi')).toBe('xiangqi');
    expect(detectBoardKind('make a chess game')).toBe('chess');
    expect(detectBoardKind('国际象棋')).toBe('chess');
    expect(detectBoardKind('五子棋')).toBe('gomoku');
    expect(detectBoardKind('贪吃蛇')).toBeNull();
  });
});

describe('inferMechanicSpec', () => {
  it('composes a board-turn spec for 中国象棋', () => {
    const spec = inferMechanicSpec('做个中国象棋，双人本地，点选，将死');
    expect(spec.space).toBe('grid');
    expect(spec.time).toBe('turn');
    expect(spec.input).toBe('cell-select');
    expect(spec.win).toBe('checkmate');
    expect(spec.boardKind).toBe('xiangqi');
    expect(spec.arcadeVariant).toBe('board_turn');
    expect(spec.modules).toContain('board');
    expect(spec.loops.map((l) => l.id)).toEqual(
      expect.arrayContaining(['boardTurn', 'xiangqi']),
    );
    expect(formatMechanicSpecForCoder(spec)).toContain('module-board');
  });

  it('keeps snake as an arcade carrier, not a board', () => {
    const spec = inferMechanicSpec('做一个贪吃蛇');
    expect(spec.arcadeVariant).toBe('snake');
    expect(spec.boardKind).toBeUndefined();
    expect(spec.modules).not.toContain('board');
  });

  it('records a custom named loop when the lexicon has no word', () => {
    const spec = inferMechanicSpec('做一个可以赶海的游戏');
    expect(spec.loops.some((l) => l.source === 'custom' && l.label.includes('赶海'))).toBe(
      true,
    );
  });

  it('keeps 赶海 as a named loop even when the prompt also asks for 象棋', () => {
    const spec = inferMechanicSpec('做一个可以赶海的中国象棋');
    expect(spec.boardKind).toBe('xiangqi');
    expect(spec.loops.some((l) => l.source === 'custom' && l.label.includes('赶海'))).toBe(
      true,
    );
  });

  it('composes overlapping modules for 俯视探索 + 象棋 + 对话', () => {
    const spec = inferMechanicSpec('俯视探索小镇，还能下中国象棋，有对话选项');
    expect(spec.space).toBe('top_down');
    expect(spec.boardKind).toBe('xiangqi');
    expect(spec.arcadeVariant).toBeUndefined();
    expect(spec.modules).toEqual(expect.arrayContaining(['board', 'world', 'dialogue']));
    expect(spec.extraScenes).toContain('BoardTurnScene');
  });

  it('binds Match3Scene for 消消乐', () => {
    const spec = inferMechanicSpec('做一个消消乐，三消计分');
    expect(spec.modules).toContain('match');
    expect(spec.extraScenes).toContain('Match3Scene');
    expect(spec.arcadeVariant).toBe('match3');
  });
});
