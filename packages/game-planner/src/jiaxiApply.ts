/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Fold a paid 加戏 card into registry flags the hosted Scene can consume.
 * Planning-only — Phaser lives in runtime / kernels.
 */

import type { JiaxiCardOffer } from './jiaxiDeck.js';

export type JiaxiFlags = {
  readonly scoreMul: number;
  readonly gravityFlip: boolean;
  readonly harder: number;
  readonly boardHandicap: number;
  readonly boardExtraMove: number;
  readonly matchExtraSwap: number;
  readonly cardsExtraDraw: number;
  readonly emitterDenser: number;
  readonly systemsLucky: number;
  readonly tdEarlyWave: number;
  readonly npcBetray: boolean;
  readonly loopSpice: readonly string[];
  readonly lastLabel: string;
  readonly lastEffect: string;
};

export const JIAXI_STACK_RATE = 1.5;

export function emptyJiaxiFlags(): JiaxiFlags {
  return {
    scoreMul: 1,
    gravityFlip: false,
    harder: 0,
    boardHandicap: 0,
    boardExtraMove: 0,
    matchExtraSwap: 0,
    cardsExtraDraw: 0,
    emitterDenser: 0,
    systemsLucky: 0,
    tdEarlyWave: 0,
    npcBetray: false,
    loopSpice: [],
    lastLabel: '',
    lastEffect: '',
  };
}

export function foldJiaxiCard(
  flags: JiaxiFlags,
  card: Pick<JiaxiCardOffer, 'effect' | 'label' | 'loopId'>,
): JiaxiFlags {
  const next = { ...flags, lastLabel: card.label, lastEffect: card.effect };
  switch (card.effect) {
    case 'score_double':
      return { ...next, scoreMul: Math.max(2, flags.scoreMul * 2) };
    case 'gravity_flip':
      return { ...next, gravityFlip: !flags.gravityFlip };
    case 'next_wave_harder':
      return { ...next, harder: flags.harder + 1 };
    case 'board_handicap':
      return { ...next, boardHandicap: flags.boardHandicap + 1 };
    case 'board_extra_move':
      return { ...next, boardExtraMove: flags.boardExtraMove + 1 };
    case 'match_extra_swap':
      return { ...next, matchExtraSwap: flags.matchExtraSwap + 1 };
    case 'cards_extra_draw':
      return { ...next, cardsExtraDraw: flags.cardsExtraDraw + 1 };
    case 'emitter_denser':
      return { ...next, emitterDenser: flags.emitterDenser + 1 };
    case 'systems_lucky':
      return { ...next, systemsLucky: flags.systemsLucky + 1 };
    case 'td_early_wave':
      return { ...next, tdEarlyWave: flags.tdEarlyWave + 1 };
    case 'npc_betray':
      return { ...next, npcBetray: !flags.npcBetray };
    case 'named_loop_spice': {
      const spice = card.loopId ? [...flags.loopSpice, card.loopId] : flags.loopSpice;
      const lucky =
        card.loopId === 'fishing' || card.loopId === 'shop'
          ? flags.systemsLucky + 1
          : flags.systemsLucky;
      return { ...next, loopSpice: spice, systemsLucky: lucky, harder: flags.harder + 1 };
    }
    default:
      return { ...next, harder: flags.harder + 1 };
  }
}

export function jiaxiFlagsToRegistry(flags: JiaxiFlags): Record<string, number | boolean | string | readonly string[]> {
  return {
    jiaxiScoreMul: flags.scoreMul,
    jiaxiGravityFlip: flags.gravityFlip,
    jiaxiHarder: flags.harder,
    jiaxiBoardHandicap: flags.boardHandicap,
    jiaxiBoardExtraMove: flags.boardExtraMove,
    jiaxiMatchExtraSwap: flags.matchExtraSwap,
    jiaxiCardsExtraDraw: flags.cardsExtraDraw,
    jiaxiEmitterDenser: flags.emitterDenser,
    jiaxiSystemsLucky: flags.systemsLucky,
    jiaxiTdEarlyWave: flags.tdEarlyWave,
    jiaxiNpcBetray: flags.npcBetray,
    jiaxiLoopSpice: flags.loopSpice,
    jiaxiLastLabel: flags.lastLabel,
    jiaxiLastEffect: flags.lastEffect,
  };
}

/** After-play / featured CTA: the loop-bound card, not a generic 加难. */
export function featuredJiaxiCard(
  deck: readonly JiaxiCardOffer[],
): JiaxiCardOffer | undefined {
  const order = [
    'extra_move',
    'extra_swap',
    'extra_draw',
    'denser',
    'lucky_cast',
    'early_wave',
    'handicap',
    'harder',
  ];
  for (const id of order) {
    const hit = deck.find((c) => c.id === id);
    if (hit) return hit;
  }
  return deck.find((c) => c.id.startsWith('spice:')) ?? deck[0];
}

export function quoteJiaxiStack(input: {
  readonly list: number;
  readonly firstJiaxi: boolean;
  readonly stackToday: number;
  readonly stackRate?: number;
}): { readonly list: number; readonly pay: number; readonly reason: 'newbie' | 'stack' | null } {
  const list = Math.max(0, Math.round(input.list));
  if (list <= 0) return { list: 0, pay: 0, reason: null };
  if (input.firstJiaxi) {
    return { list, pay: Math.max(1, Math.floor(list * 0.5)), reason: 'newbie' };
  }
  if (input.stackToday >= 1) {
    const rate = input.stackRate ?? JIAXI_STACK_RATE;
    return { list, pay: Math.max(1, Math.round(list * rate)), reason: 'stack' };
  }
  return { list, pay: list, reason: null };
}

/** Featured loop card + 加难, one checkout. Empty when the deck has no cards. */
export function jiaxiRunBundle(deck: readonly JiaxiCardOffer[]): JiaxiCardOffer[] {
  const lead = featuredJiaxiCard(deck);
  if (!lead) return [];
  const harder = deck.find((c) => c.id === 'harder');
  if (!harder || harder.id === lead.id) return [lead];
  return [lead, harder];
}

/** One quote on the summed list — first-checkout half or one stack tax, not two. */
export function quoteJiaxiBundle(input: {
  readonly lists: readonly number[];
  readonly firstJiaxi: boolean;
  readonly stackToday: number;
  readonly stackRate?: number;
}): { readonly list: number; readonly pay: number; readonly reason: 'newbie' | 'stack' | null } {
  const list = input.lists.reduce((sum, n) => sum + Math.max(0, Math.round(n)), 0);
  return quoteJiaxiStack({
    list,
    firstJiaxi: input.firstJiaxi,
    stackToday: input.stackToday,
    stackRate: input.stackRate,
  });
}
