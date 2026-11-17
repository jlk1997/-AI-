/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import { createStarterDeck, discardCard, draw, playCard } from './index.js';

describe('module-cards', () => {
  it('draws, plays, and discards without inventing a finished game', () => {
    let state = createStarterDeck(['A', 'B', 'C']);
    state = draw(state, 2);
    expect(state.hand.map((c) => c.name)).toEqual(['A', 'B']);
    expect(state.deck).toHaveLength(1);
    const played = state.hand[0]!.id;
    state = playCard(state, played);
    expect(state.hand).toHaveLength(1);
    expect(state.discard).toHaveLength(1);
    state = discardCard(state, state.hand[0]!.id);
    expect(state.hand).toHaveLength(0);
    expect(state.discard).toHaveLength(2);
  });
});
