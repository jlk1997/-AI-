/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import {
  inferGameIntent,
  isRedoPrompt,
  synthesizeMechanicSpec,
} from './gameIntent.js';
import { padThinLoops } from './mechanicSpec.js';

describe('GameIntent', () => {
  it('extracts chess intent before a spec is synthesized', () => {
    const intent = inferGameIntent('做个中国象棋，双人本地，点选，将死');
    expect(intent.boardKind).toBe('xiangqi');
    expect(intent.arcadeHint).toBe('board_turn');
    expect(intent.loopSeeds.map((l) => l.id)).toEqual(
      expect.arrayContaining(['boardTurn', 'xiangqi']),
    );
    const spec = synthesizeMechanicSpec(intent, { archetype: 'grid_logic' });
    expect(spec.input).toBe('cell-select');
    expect(spec.modules).toContain('board');
    expect(spec.loops.every((l) => l.signals.length >= 2 || l.hint)).toBe(true);
  });

  it('composes overlapping modules for 俯视探索 + 象棋 + 对话', () => {
    const intent = inferGameIntent('俯视探索小镇，还能下中国象棋，有对话选项');
    expect(intent.mixed).toBe(true);
    const spec = synthesizeMechanicSpec(intent);
    expect(spec.space).toBe('top_down');
    expect(spec.arcadeVariant).toBeUndefined();
    expect(spec.modules).toEqual(
      expect.arrayContaining(['board', 'world', 'dialogue']),
    );
    expect(spec.extraScenes).toContain('BoardTurnScene');
  });

  it('does not treat 重做 as a default for ordinary follow-ups', () => {
    expect(isRedoPrompt('加上钓鱼循环')).toBe(false);
    expect(isRedoPrompt('重做成横版跳跃')).toBe(true);
  });
});

describe('padThinLoops', () => {
  it('keeps the custom phrase as the acceptance signal instead of swapping the carrier', () => {
    const spec = synthesizeMechanicSpec(inferGameIntent('做一个可以赶海的游戏'));
    const padded = padThinLoops(spec);
    expect(padded.arcadeVariant ?? spec.arcadeVariant).toBe(spec.arcadeVariant);
    const custom = padded.loops.find((l) => l.source === 'custom');
    expect(custom?.signals[0]).toMatch(/赶海/);
    expect(custom?.hint).toBeTruthy();
    expect(custom?.signals.some((s) => /won/.test(s))).toBe(false);
  });
});
