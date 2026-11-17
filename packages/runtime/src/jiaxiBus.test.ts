/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import { applyJiaxiMessage } from './jiaxiBus.js';

function fakeRegistry(init: Record<string, unknown> = {}) {
  const bag = { ...init };
  return {
    get: (k: string) => bag[k],
    set: (k: string, v: unknown) => {
      bag[k] = v;
    },
    bag,
  };
}

describe('applyJiaxiMessage', () => {
  it('folds board extra-move and match extra-swap onto registry', () => {
    const reg = fakeRegistry();
    applyJiaxiMessage(reg as never, {
      type: 'opengame:jiaxi',
      cardId: 'extra_move',
      effect: 'board_extra_move',
      label: '多走一步',
    });
    applyJiaxiMessage(reg as never, {
      type: 'opengame:jiaxi',
      cardId: 'extra_swap',
      effect: 'match_extra_swap',
      label: '再换一次',
    });
    expect(reg.bag.jiaxiBoardExtraMove).toBe(1);
    expect(reg.bag.jiaxiMatchExtraSwap).toBe(1);
    expect(reg.bag.jiaxiLastLabel).toBe('再换一次');
  });

  it('doubles score mul instead of adding a generic harder flag', () => {
    const reg = fakeRegistry();
    applyJiaxiMessage(reg as never, { type: 'opengame:jiaxi', effect: 'score_double' });
    expect(reg.bag.jiaxiScoreMul).toBe(2);
    expect(reg.bag.jiaxiHarder ?? 0).toBe(0);
  });

  it('sets betray and spices a named fishing loop onto systems lucky', () => {
    const reg = fakeRegistry();
    applyJiaxiMessage(reg as never, { type: 'opengame:jiaxi', effect: 'npc_betray' });
    applyJiaxiMessage(reg as never, {
      type: 'opengame:jiaxi',
      effect: 'named_loop_spice',
      loopId: 'fishing',
    });
    expect(reg.bag.jiaxiNpcBetray).toBe(true);
    expect(reg.bag.jiaxiLoopSpice).toEqual(['fishing']);
    expect(reg.bag.jiaxiSystemsLucky).toBe(1);
  });
});
