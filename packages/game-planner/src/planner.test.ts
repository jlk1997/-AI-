/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import { applyGameOps, inferGameOpsFromPrompt, parseProposedGameOps, sanitizeGameOps } from './agentic.js';
import { detectBoardKind, isRedoPrompt } from './detect.js';
import { ensureGameDepth, measureGameDepth } from './ensureDepth.js';
import { inferGameIntent, mergeGameIntent } from './intent.js';
import { inferMechanicSpec, synthesizeMechanicSpec } from './synthesize.js';
import {
  featuredJiaxiCard,
  foldJiaxiCard,
  emptyJiaxiFlags,
  jiaxiRunBundle,
  quoteJiaxiBundle,
  quoteJiaxiStack,
} from './jiaxiApply.js';
import { jiaxiDeckForMechanic } from './jiaxiDeck.js';

describe('detectBoardKind', () => {
  it('maps 中国象棋 / 象棋 to xiangqi and English chess to chess', () => {
    expect(detectBoardKind('做个中国象棋，双人本地，点选，将死')).toBe('xiangqi');
    expect(detectBoardKind('象棋')).toBe('xiangqi');
    expect(detectBoardKind('make a chess game')).toBe('chess');
    expect(detectBoardKind('贪吃蛇')).toBeNull();
  });
});

describe('synthesizeMechanicSpec', () => {
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
    expect(spec.extraScenes).toContain('BoardTurnScene');
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

  it('keeps a custom 赶海 loop even when the prompt also names 象棋', () => {
    const spec = inferMechanicSpec('做一个可以赶海的中国象棋');
    expect(spec.boardKind).toBe('xiangqi');
    expect(spec.loops.some((l) => l.source === 'custom' && l.label.includes('赶海'))).toBe(
      true,
    );
  });

  it('composes overlapping modules for 俯视探索 + 象棋 + 对话', () => {
    const intent = inferGameIntent('俯视探索小镇，还能下中国象棋，有对话选项');
    expect(intent.mixed).toBe(true);
    expect(intent.archetypeHint).toBe('top_down');
    const spec = synthesizeMechanicSpec(intent);
    expect(spec.space).toBe('top_down');
    expect(spec.arcadeVariant).toBeUndefined();
    expect(spec.boardKind).toBe('xiangqi');
    expect(spec.modules).toEqual(
      expect.arrayContaining(['board', 'world', 'dialogue']),
    );
    expect(spec.extraScenes).toContain('BoardTurnScene');
    expect(measureGameDepth(spec).loops).toBeGreaterThanOrEqual(2);
  });

  it('binds match-3 as a capability, not a candy-crush template', () => {
    const spec = inferMechanicSpec('做一个消消乐，三消计分');
    expect(spec.modules).toContain('match');
    expect(spec.loops.some((l) => l.id === 'match3')).toBe(true);
    expect(spec.arcadeVariant).toBe('match3');
    expect(spec.extraScenes).toContain('Match3Scene');
  });

  it('composes walkable town + match-3 without swapping the world camera', () => {
    const spec = inferMechanicSpec('俯视探索小镇，还能玩消消乐');
    expect(spec.space).toBe('top_down');
    expect(spec.arcadeVariant).toBeUndefined();
    expect(spec.modules).toContain('match');
    expect(spec.extraScenes).toContain('Match3Scene');
  });
});

describe('GameOps', () => {
  it('adds a fishing loop without swapping the chess carrier', () => {
    const spec = inferMechanicSpec('做个中国象棋');
    const ops = inferGameOpsFromPrompt('加上钓鱼循环');
    const next = applyGameOps(spec, ops);
    expect(next.arcadeVariant).toBe('board_turn');
    expect(next.boardKind).toBe('xiangqi');
    expect(next.loops.some((l) => l.id === 'fishing')).toBe(true);
  });

  it('does not retarget space unless 重做', () => {
    expect(isRedoPrompt('加上钓鱼循环')).toBe(false);
    const spec = inferMechanicSpec('做个中国象棋');
    const casual = inferGameOpsFromPrompt('改成俯视探索', spec);
    expect(casual.some((o) => o.op === 'retarget_space')).toBe(false);
  });

  it('merges follow-up intent without dropping chess', () => {
    const base = inferGameIntent('做个中国象棋');
    const next = inferGameIntent('加上钓鱼循环');
    const merged = mergeGameIntent(base, next);
    expect(merged.boardKind).toBe('xiangqi');
    expect(merged.archetypeHint).toBe('grid_logic');
    expect(merged.loopSeeds.some((l) => l.id === 'fishing')).toBe(true);
  });

  it('binds systems when a fishing loop is present but modules omitted it', () => {
    const spec = inferMechanicSpec('做个中国象棋');
    const thin = {
      ...spec,
      loops: [
        ...spec.loops,
        {
          id: 'fishing' as const,
          label: '钓鱼',
          signals: ['fish'],
          source: 'lexicon' as const,
        },
      ],
      modules: spec.modules.filter((m) => m !== 'systems'),
    };
    expect(ensureGameDepth(thin).modules).toContain('systems');
    expect(ensureGameDepth(thin).arcadeVariant).toBe('board_turn');
  });

  it('prices 加戏 cards from loops, not a four-card SKU', () => {
    const chess = jiaxiDeckForMechanic(inferMechanicSpec('做个中国象棋'));
    expect(chess.map((c) => c.id)).toEqual(
      expect.arrayContaining(['harder', 'handicap', 'extra_move']),
    );
    expect(chess.some((c) => c.id === 'gravity')).toBe(false);
    const snake = jiaxiDeckForMechanic(inferMechanicSpec('做一个贪吃蛇'));
    expect(snake.some((c) => c.id === 'gravity')).toBe(true);
    expect(snake.some((c) => c.id === 'handicap')).toBe(false);
    const match = jiaxiDeckForMechanic(inferMechanicSpec('做一个消消乐'));
    expect(match.some((c) => c.id === 'extra_swap')).toBe(true);
    expect(jiaxiDeckForMechanic(undefined, { world: true })).toEqual([]);
  });

  it('folds paid cards onto flags and quotes stack / run-bundle as one checkout', () => {
    const chess = jiaxiDeckForMechanic(inferMechanicSpec('做个中国象棋'));
    expect(featuredJiaxiCard(chess)?.id).toBe('extra_move');
    expect(jiaxiRunBundle(chess).map((c) => c.id)).toEqual(['extra_move', 'harder']);
    const folded = foldJiaxiCard(emptyJiaxiFlags(), {
      effect: 'board_extra_move',
      label: '多走一步',
    });
    expect(folded.boardExtraMove).toBe(1);
    expect(folded.harder).toBe(0);
    expect(quoteJiaxiStack({ list: 8, firstJiaxi: true, stackToday: 2 })).toEqual({
      list: 8,
      pay: 4,
      reason: 'newbie',
    });
    expect(quoteJiaxiStack({ list: 8, firstJiaxi: false, stackToday: 1 })).toEqual({
      list: 8,
      pay: 12,
      reason: 'stack',
    });
    expect(
      quoteJiaxiBundle({ lists: [12, 8], firstJiaxi: false, stackToday: 0 }),
    ).toEqual({ list: 20, pay: 20, reason: null });
    expect(
      quoteJiaxiBundle({ lists: [12, 8], firstJiaxi: false, stackToday: 1 }),
    ).toEqual({ list: 20, pay: 30, reason: 'stack' });
  });

  it('drops retarget ops unless 重做, and parses LLM GameOps JSON', () => {
    const sneaky = sanitizeGameOps(
      [{ op: 'retarget_space', space: 'side' }],
      { redo: false },
    );
    expect(sneaky).toEqual([]);
    const parsed = parseProposedGameOps(
      '```json\n[{"op":"bind_module","module":"match"},{"op":"bind_module","module":"nope"}]\n```',
    );
    expect(parsed.some((o) => o.op === 'bind_module' && o.module === 'match')).toBe(
      true,
    );
    expect(sanitizeGameOps(parsed, { redo: false }).every((o) => o.op !== 'retarget_space')).toBe(
      true,
    );
  });
});
