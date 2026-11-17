/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Visitor 加戏 cards follow MechanicSpec loops — never a four-card SKU,
 * never a generation product. World spend stays on the 巷议 rail.
 */

export type JiaxiCardOffer = {
  readonly id: string;
  readonly label: string;
  readonly effect: string;
  readonly points: number;
  readonly loopId?: string;
};

export type MechanicHint = {
  readonly modules?: readonly string[];
  readonly loops?: readonly { readonly id: string; readonly label: string; readonly source?: string }[];
  readonly arcadeVariant?: string;
  readonly boardKind?: string;
  readonly space?: string;
  readonly extraScenes?: readonly string[];
};

const UNIVERSAL: readonly JiaxiCardOffer[] = [
  { id: 'harder', label: '加难', effect: 'next_wave_harder', points: 8 },
];

function has(hint: MechanicHint | null | undefined, mod: string): boolean {
  return Boolean(hint?.modules?.includes(mod));
}

function loopIds(hint: MechanicHint | null | undefined): readonly string[] {
  return hint?.loops?.map((l) => l.id) ?? [];
}

/** Cards a visitor may throw into this hosted run. Empty for towns. */
export function jiaxiDeckForMechanic(
  hint?: MechanicHint | null,
  options?: { readonly world?: boolean },
): JiaxiCardOffer[] {
  if (options?.world) return [];
  const deck: JiaxiCardOffer[] = [...UNIVERSAL];
  const ids = loopIds(hint);
  const space = hint?.space;
  const arcade = hint?.arcadeVariant;

  if (space === 'side' || arcade === 'flappy' || arcade === 'snake') {
    deck.push({ id: 'gravity', label: '反重力', effect: 'gravity_flip', points: 10 });
  }
  if (arcade === 'snake' || arcade === 'g2048' || arcade === 'flappy' || arcade === 'match3') {
    deck.push({ id: 'double', label: '双倍分', effect: 'score_double', points: 8 });
  }
  if (has(hint, 'dialogue') || has(hint, 'world')) {
    deck.push({ id: 'betray', label: '反水', effect: 'npc_betray', points: 8 });
  }
  if (has(hint, 'board') || hint?.boardKind) {
    deck.push({ id: 'handicap', label: '让子', effect: 'board_handicap', points: 10 });
    deck.push({ id: 'extra_move', label: '多走一步', effect: 'board_extra_move', points: 12 });
  }
  if (has(hint, 'match') || arcade === 'match3' || ids.includes('match3')) {
    deck.push({ id: 'extra_swap', label: '再换一次', effect: 'match_extra_swap', points: 8 });
  }
  if (has(hint, 'cards') || ids.includes('cards')) {
    deck.push({ id: 'extra_draw', label: '多抽一张', effect: 'cards_extra_draw', points: 8 });
  }
  if (has(hint, 'emitter') || ids.includes('danmaku')) {
    deck.push({ id: 'denser', label: '更密弹幕', effect: 'emitter_denser', points: 10 });
  }
  if (has(hint, 'systems') || ids.includes('fishing') || ids.includes('shop')) {
    deck.push({
      id: 'lucky_cast',
      label: ids.includes('shop') && !ids.includes('fishing') ? '好市' : '好运抛竿',
      effect: 'systems_lucky',
      points: 8,
      loopId: ids.includes('fishing') ? 'fishing' : 'shop',
    });
  }
  if (has(hint, 'td') || ids.includes('tower')) {
    deck.push({ id: 'early_wave', label: '提前一波', effect: 'td_early_wave', points: 10 });
  }
  const custom = hint?.loops?.find((l) => l.source === 'custom');
  if (custom) {
    deck.push({
      id: `spice:${custom.id}`,
      label: `加码${custom.label}`.slice(0, 8),
      effect: 'named_loop_spice',
      points: 12,
      loopId: custom.id,
    });
  }
  const seen = new Set<string>();
  return deck.filter((c) => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });
}

export function resolveJiaxiCard(
  deck: readonly JiaxiCardOffer[],
  cardId?: string | null,
): JiaxiCardOffer | undefined {
  if (cardId) {
    const hit = deck.find((c) => c.id === cardId);
    if (hit) return hit;
  }
  return deck[0];
}
