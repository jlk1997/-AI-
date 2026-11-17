/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type Phaser from 'phaser';

import type { Entity } from '../core/Entity.js';
import { Behavior } from './IBehavior.js';

export interface EightWayMovementOptions {
  readonly speed: number;
  readonly keys?: {
    up: string;
    down: string;
    left: string;
    right: string;
  };
}

const DEFAULT_KEYS = { up: 'W', down: 'S', left: 'A', right: 'D' } as const;

/**
 * Player-controlled 8-way movement using Phaser keyboard.
 *
 * Falls back gracefully when the scene has no input.keyboard (server / tests).
 */
export class EightWayMovement extends Behavior {
  override readonly key = 'eightWayMovement';
  private readonly speed: number;
  private readonly keymap: { up: string; down: string; left: string; right: string };

  constructor(opts: EightWayMovementOptions) {
    super();
    this.speed = opts.speed;
    this.keymap = opts.keys ?? DEFAULT_KEYS;
  }

  override update(entity: Entity, dt: number): void {
    const sprite = entity.sprite as
      | (Phaser.GameObjects.GameObject & { x: number; y: number })
      | null;
    if (!sprite) return;
    const kb = entity.scene.input.keyboard;
    if (!kb) return;
    let dx = 0;
    let dy = 0;
    if (kb.checkDown(kb.addKey(this.keymap.up))) dy -= 1;
    if (kb.checkDown(kb.addKey(this.keymap.down))) dy += 1;
    if (kb.checkDown(kb.addKey(this.keymap.left))) dx -= 1;
    if (kb.checkDown(kb.addKey(this.keymap.right))) dx += 1;
    if (dx === 0 && dy === 0) return;
    const norm = Math.hypot(dx, dy) || 1;
    sprite.x += (dx / norm) * this.speed * dt;
    sprite.y += (dy / norm) * this.speed * dt;
  }
}
