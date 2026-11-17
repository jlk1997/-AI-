/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import {
  applyGameOps,
  formatGameOpsForCoder,
  inferGameOpsFromPrompt,
} from './gameOps.js';
import { inferMechanicSpec } from './mechanicSpec.js';

describe('GameOps', () => {
  it('adds a fishing loop without swapping the chess carrier', () => {
    const spec = inferMechanicSpec('做个中国象棋');
    const ops = inferGameOpsFromPrompt('加上钓鱼循环');
    expect(ops.some((o) => o.op === 'add_loop')).toBe(true);
    const next = applyGameOps(spec, ops);
    expect(next.arcadeVariant).toBe('board_turn');
    expect(next.boardKind).toBe('xiangqi');
    expect(next.loops.some((l) => l.id === 'fishing')).toBe(true);
    expect(next.modules).toContain('systems');
    expect(formatGameOpsForCoder(ops)).toContain('add_loop fishing');
  });

  it('adds a generic named loop without changing space/time unless 重做', () => {
    const spec = inferMechanicSpec('做个中国象棋');
    const ops = inferGameOpsFromPrompt('加一个赶海循环', spec);
    expect(ops.some((o) => o.op === 'add_loop' && o.loop.label.includes('赶海'))).toBe(
      true,
    );
    expect(ops.some((o) => o.op === 'retarget_space')).toBe(false);
    const next = applyGameOps(spec, ops);
    expect(next.space).toBe('grid');
    expect(next.arcadeVariant).toBe('board_turn');
  });

  it('retargets space only when the user asks to redo', () => {
    const spec = inferMechanicSpec('做个中国象棋');
    const casual = inferGameOpsFromPrompt('改成俯视探索', spec);
    expect(casual.some((o) => o.op === 'retarget_space')).toBe(false);
    const redo = inferGameOpsFromPrompt('重做成俯视探索', spec);
    expect(redo.some((o) => o.op === 'retarget_space' && o.space === 'top_down')).toBe(
      true,
    );
  });

  it('binds match-3 as a capability when the user adds 消消乐', () => {
    const spec = inferMechanicSpec('做一个平台跳跃');
    const ops = inferGameOpsFromPrompt('加上消消乐');
    expect(ops.some((o) => o.op === 'bind_module' && o.module === 'match')).toBe(true);
    const next = applyGameOps(spec, ops);
    expect(next.loops.some((l) => l.id === 'match3')).toBe(true);
    expect(next.extraScenes).toContain('Match3Scene');
    expect(next.space).toBe('side');
  });

  it('records extraScenes from add_scene', () => {
    const spec = inferMechanicSpec('做一个平台跳跃');
    const next = applyGameOps(spec, [
      { op: 'add_scene', sceneKey: 'ShopScene' },
    ]);
    expect(next.extraScenes).toContain('ShopScene');
  });
});
