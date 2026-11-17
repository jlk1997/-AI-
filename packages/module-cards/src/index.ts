/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Card-hand capability. Scene presents; this module owns draw/play/discard.
 */

export type Card = {
  readonly id: string;
  readonly name: string;
  readonly cost: number;
};

export type CardHandState = {
  readonly deck: readonly Card[];
  readonly hand: readonly Card[];
  readonly discard: readonly Card[];
};

export function createStarterDeck(names?: readonly string[]): CardHandState {
  const labels = names ?? ['Strike', 'Strike', 'Guard', 'Guard', 'Focus', 'Burst'];
  const deck = labels.map((name, i) => ({
    id: `c${i}`,
    name,
    cost: name === 'Burst' ? 2 : 1,
  }));
  return { deck, hand: [], discard: [] };
}

export function draw(state: CardHandState, n = 1): CardHandState {
  let deck = [...state.deck];
  let discard = [...state.discard];
  const hand = [...state.hand];
  for (let i = 0; i < n; i += 1) {
    if (deck.length === 0) {
      deck = discard;
      discard = [];
    }
    const card = deck.shift();
    if (!card) break;
    hand.push(card);
  }
  return { deck, hand, discard };
}

export function playCard(state: CardHandState, cardId: string): CardHandState {
  const idx = state.hand.findIndex((c) => c.id === cardId);
  if (idx < 0) return state;
  const card = state.hand[idx]!;
  return {
    deck: state.deck,
    hand: state.hand.filter((_, i) => i !== idx),
    discard: [...state.discard, card],
  };
}

export function discardCard(state: CardHandState, cardId: string): CardHandState {
  return playCard(state, cardId);
}
