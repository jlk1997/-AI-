/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * World-side ensureDepth pads NPCs/regions. Game-side pads loop signals and
 * binds modules implied by named loops — never swaps chess for snake.
 */

import { MODULE_EXTRA_SCENES } from './catalog.js';
import { padThinLoops, uniqModules } from './loops.js';
import type { MechanicModule, MechanicSpec } from './types.js';

export interface GameDepthMetrics {
  readonly loops: number;
  readonly modules: number;
  readonly minSignals: number;
  readonly extraScenes: number;
}

export function measureGameDepth(spec: MechanicSpec): GameDepthMetrics {
  return {
    loops: spec.loops.length,
    modules: spec.modules.length,
    minSignals: spec.loops.reduce((n, l) => n + l.signals.length, 0),
    extraScenes: spec.extraScenes?.length ?? 0,
  };
}

function bindModule(spec: MechanicSpec, mod: MechanicModule): MechanicSpec {
  if (spec.modules.includes(mod)) return spec;
  return { ...spec, modules: [...spec.modules, mod] };
}

/** If a named loop is present, its capability package must be in modules[]. */
export function fulfillLoopModules(spec: MechanicSpec): MechanicSpec {
  let next = spec;
  for (const loop of spec.loops) {
    if (loop.id === 'fishing' || loop.id === 'shop') {
      next = bindModule(next, 'systems');
    }
    if (
      loop.id === 'boardTurn' ||
      loop.id === 'xiangqi' ||
      loop.id === 'gomoku' ||
      loop.id === 'chess'
    ) {
      next = bindModule(next, 'board');
    }
    if (loop.id === 'match3') next = bindModule(next, 'match');
    if (loop.id === 'cards') next = bindModule(next, 'cards');
    if (loop.id === 'danmaku') next = bindModule(next, 'emitter');
    if (loop.id === 'tower') next = bindModule(next, 'td');
    if (loop.id === 'dialogueChoice') next = bindModule(next, 'dialogue');
  }
  return next;
}

export function ensureGameDepth(spec: MechanicSpec): MechanicSpec {
  let next = fulfillLoopModules(padThinLoops(spec));
  const extra = [...(next.extraScenes ?? [])];
  for (const mod of next.modules) {
    const scene = MODULE_EXTRA_SCENES[mod];
    if (scene && !extra.includes(scene)) extra.push(scene);
  }
  return {
    ...next,
    modules: uniqModules(next.modules),
    extraScenes: extra,
    updatedAt: new Date().toISOString(),
  };
}
