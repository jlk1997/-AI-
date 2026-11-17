/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type Phaser from 'phaser';

import type { Entity } from '../core/Entity.js';
import { Behavior } from './IBehavior.js';

export interface ChaseOptions {
  readonly targetTag: string;
  readonly speed: number;
  /** Stop closing in when within this distance (default 0). */
  readonly minDistance?: number;
  /** Give up if beyond this distance (default Infinity). */
  readonly maxDistance?: number;
}

export class Chase extends Behavior {
  override readonly key = 'chase';
  private readonly opts: ChaseOptions;

  constructor(opts: ChaseOptions) {
    super();
    this.opts = opts;
  }

  override update(entity: Entity, dt: number): void {
    const sprite = entity.sprite as
      | (Phaser.GameObjects.GameObject & { x: number; y: number })
      | null;
    if (!sprite) {
      return;
    }
    const world = (
      entity.scene as Phaser.Scene & { __ogWorld?: { withTag: (t: string) => Entity[] } }
    ).__ogWorld;
    if (!world) {
      return;
    }
    const targets = world.withTag(this.opts.targetTag);
    if (targets.length === 0) {
      return;
    }
    let best: { x: number; y: number; d2: number } | null = null;
    for (const t of targets) {
      const ts = t.sprite as { x: number; y: number } | null;
      if (!ts) continue;
      const dx = ts.x - sprite.x;
      const dy = ts.y - sprite.y;
      const d2 = dx * dx + dy * dy;
      if (!best || d2 < best.d2) {
        best = { x: ts.x, y: ts.y, d2 };
      }
    }
    if (!best) {
      return;
    }
    const dist = Math.sqrt(best.d2);
    const minD = this.opts.minDistance ?? 0;
    const maxD = this.opts.maxDistance ?? Number.POSITIVE_INFINITY;
    if (dist <= minD || dist > maxD) {
      return;
    }
    const dx = best.x - sprite.x;
    const dy = best.y - sprite.y;
    const step = this.opts.speed * dt;
    sprite.x += (dx / dist) * step;
    sprite.y += (dy / dist) * step;
  }
}
