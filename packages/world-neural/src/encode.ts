/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Fixed-size encoding of WorldSpec slices for neural dynamics.
 * STATE_DIM / ACTION_DIM keep models interchangeable across open-source trainers.
 */

import type { WorldSpec } from '@opengame/world-spec';

export const STATE_DIM = 64;
export const ACTION_DIM = 16;

export type WorldActionKind =
  | 'noop'
  | 'move_n'
  | 'move_s'
  | 'move_e'
  | 'move_w'
  | 'talk'
  | 'wait'
  | 'tick'
  | 'give_ore'
  | 'use_portal';

export const ACTION_INDEX: Record<WorldActionKind, number> = {
  noop: 0,
  move_n: 1,
  move_s: 2,
  move_e: 3,
  move_w: 4,
  talk: 5,
  wait: 6,
  tick: 7,
  give_ore: 8,
  use_portal: 9,
};

function hashBucket(s: string, buckets: number): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % buckets;
}

/** Encode a compact world observation into Float64Array of length STATE_DIM. */
export function encodeWorldState(world: WorldSpec): Float64Array {
  const v = new Float64Array(STATE_DIM);
  v[0] = (world.timeHours % 24) / 24;
  v[1] = Math.min(1, world.meta.version / 100);
  v[2] = Math.min(1, world.space.regions.length / 8);
  v[3] = Math.min(1, world.entities.length / 32);
  v[4] = Math.min(1, world.narrative.quests.length / 8);

  const player = world.entities.find((e) => e.kind === 'player');
  if (player) {
    const region = world.space.regions.find((r) => r.id === player.regionId);
    const w = region?.width ?? 32;
    const h = region?.height ?? 24;
    v[5] = player.pos.x / Math.max(1, w);
    v[6] = player.pos.y / Math.max(1, h);
    v[7] = hashBucket(player.regionId, 16) / 16;
    v[8] = Math.min(1, player.inventory.length / 8);
  }

  // Flag bag → 16 buckets
  const flags = Object.entries(world.narrative.flags);
  for (const [k, val] of flags) {
    const b = 9 + hashBucket(k, 16);
    if (val) v[b] = Math.min(1, v[b] + 0.5);
  }

  // Quest statuses → 16 slots
  world.narrative.quests.slice(0, 8).forEach((q, i) => {
    const base = 25 + i * 2;
    const statusMap: Record<string, number> = {
      locked: 0.1,
      available: 0.3,
      active: 0.6,
      completed: 1,
      failed: 0,
    };
    v[base] = statusMap[q.status] ?? 0;
    v[base + 1] = hashBucket(q.id, 32) / 32;
  });

  // NPC density per hashed region
  for (const e of world.entities.filter((x) => x.kind === 'npc')) {
    const b = 41 + hashBucket(e.regionId, 8);
    v[b] = Math.min(1, v[b] + 0.2);
  }

  // Relation strength mean
  if (world.relations.length > 0) {
    const mean =
      world.relations.reduce((s, r) => s + r.strength, 0) /
      world.relations.length;
    v[49] = (mean + 1) / 2;
  }

  v[50] = world.presentation.mode === 'three3d' ? 1 : 0;
  return v;
}

export function encodeAction(kind: WorldActionKind): Float64Array {
  const v = new Float64Array(ACTION_DIM);
  const idx = ACTION_INDEX[kind] ?? 0;
  v[idx] = 1;
  return v;
}

export function concatStateAction(
  state: Float64Array,
  action: Float64Array,
): Float64Array {
  const out = new Float64Array(STATE_DIM + ACTION_DIM);
  out.set(state, 0);
  out.set(action, STATE_DIM);
  return out;
}

export interface TrajectoryStep {
  readonly obs: number[];
  readonly action: WorldActionKind;
  readonly actionVec: number[];
  readonly nextObs: number[];
  readonly reward: number;
  readonly events: string[];
  readonly meta?: Record<string, unknown>;
}

export function mse(a: Float64Array, b: Float64Array): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = a[i]! - b[i]!;
    s += d * d;
  }
  return s / Math.max(1, n);
}
