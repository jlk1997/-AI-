/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Host parent posts `opengame:jiaxi` after a paid card. Registry flags are
 * the Scene contract — kernels consume them; generated games may ignore.
 */

import type Phaser from 'phaser';

export type JiaxiMessage = {
  readonly type?: string;
  readonly cardId?: string;
  readonly effect?: string;
  readonly label?: string;
  readonly loopId?: string;
};

function asMessage(data: unknown): JiaxiMessage | null {
  if (!data || typeof data !== 'object') return null;
  const row = data as JiaxiMessage;
  if (row.type !== 'opengame:jiaxi') return null;
  if (typeof row.effect !== 'string' && typeof row.cardId !== 'string') return null;
  return row;
}

function bump(reg: Phaser.Data.DataManager, key: string, by = 1): number {
  const next = Number(reg.get(key) ?? 0) + by;
  reg.set(key, next);
  return next;
}

/** Fold one paid card onto the shared game registry. */
export function applyJiaxiMessage(
  registry: Phaser.Data.DataManager,
  msg: JiaxiMessage,
): Record<string, unknown> {
  const effect = msg.effect ?? msg.cardId ?? 'next_wave_harder';
  registry.set('jiaxiLastLabel', msg.label ?? effect);
  registry.set('jiaxiLastEffect', effect);
  switch (effect) {
    case 'score_double':
      registry.set('jiaxiScoreMul', Math.max(2, Number(registry.get('jiaxiScoreMul') ?? 1) * 2));
      break;
    case 'gravity_flip':
      registry.set('jiaxiGravityFlip', !registry.get('jiaxiGravityFlip'));
      break;
    case 'board_handicap':
      bump(registry, 'jiaxiBoardHandicap');
      break;
    case 'board_extra_move':
      bump(registry, 'jiaxiBoardExtraMove');
      break;
    case 'match_extra_swap':
      bump(registry, 'jiaxiMatchExtraSwap');
      break;
    case 'cards_extra_draw':
      bump(registry, 'jiaxiCardsExtraDraw');
      break;
    case 'emitter_denser':
      bump(registry, 'jiaxiEmitterDenser');
      break;
    case 'systems_lucky':
      bump(registry, 'jiaxiSystemsLucky');
      break;
    case 'td_early_wave':
      bump(registry, 'jiaxiTdEarlyWave');
      break;
    case 'npc_betray':
      registry.set('jiaxiNpcBetray', !registry.get('jiaxiNpcBetray'));
      break;
    case 'named_loop_spice': {
      const prev = (registry.get('jiaxiLoopSpice') as string[] | undefined) ?? [];
      if (msg.loopId) registry.set('jiaxiLoopSpice', [...prev, msg.loopId]);
      if (msg.loopId === 'fishing' || msg.loopId === 'shop') {
        bump(registry, 'jiaxiSystemsLucky');
      }
      bump(registry, 'jiaxiHarder');
      break;
    }
    default:
      bump(registry, 'jiaxiHarder');
      break;
  }
  const applied = {
    cardId: msg.cardId,
    effect,
    label: msg.label,
    scoreMul: Number(registry.get('jiaxiScoreMul') ?? 1),
    harder: Number(registry.get('jiaxiHarder') ?? 0),
    boardExtraMove: Number(registry.get('jiaxiBoardExtraMove') ?? 0),
    matchExtraSwap: Number(registry.get('jiaxiMatchExtraSwap') ?? 0),
    systemsLucky: Number(registry.get('jiaxiSystemsLucky') ?? 0),
    tdEarlyWave: Number(registry.get('jiaxiTdEarlyWave') ?? 0),
    npcBetray: Boolean(registry.get('jiaxiNpcBetray')),
  };
  registry.set('jiaxiApplied', applied);
  return applied;
}

export function installJiaxiBus(game: Phaser.Game): void {
  if (typeof window === 'undefined') return;
  const marked = game as Phaser.Game & { __ogJiaxiBus?: boolean };
  if (marked.__ogJiaxiBus) return;
  marked.__ogJiaxiBus = true;
  const onMessage = (event: MessageEvent): void => {
    const msg = asMessage(event.data);
    if (!msg) return;
    const applied = applyJiaxiMessage(game.registry, msg);
    game.events.emit('opengame:jiaxi', applied);
  };
  window.addEventListener('message', onMessage);
  game.events.once('destroy', () => {
    window.removeEventListener('message', onMessage);
    marked.__ogJiaxiBus = false;
  });
}
