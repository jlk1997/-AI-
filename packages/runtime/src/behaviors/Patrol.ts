/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type Phaser from 'phaser';

import type { Entity } from '../core/Entity.js';
import { Behavior } from './IBehavior.js';

export interface PatrolOptions {
  readonly waypoints: ReadonlyArray<{ x: number; y: number }>;
  readonly speed: number;
  readonly tolerance?: number;
  readonly loop?: boolean;
}

/**
 * Move along a polyline. Stops at the last waypoint unless `loop: true`.
 * Works with any `GameObject` exposing `x` / `y` (sprites, images, containers).
 */
export class Patrol extends Behavior {
  override readonly key = 'patrol';
  private readonly waypoints: ReadonlyArray<{ x: number; y: number }>;
  private readonly speed: number;
  private readonly tolerance: number;
  private readonly loop: boolean;
  private idx: number;

  constructor(options: PatrolOptions) {
    super();
    if (options.waypoints.length === 0) {
      throw new Error('Patrol requires at least one waypoint');
    }
    this.waypoints = options.waypoints;
    this.speed = options.speed;
    this.tolerance = options.tolerance ?? 2;
    this.loop = options.loop ?? true;
    this.idx = 0;
  }

  override update(entity: Entity, dt: number): void {
    const target = this.waypoints[this.idx];
    if (!target) {
      return;
    }
    const sprite = entity.sprite as
      | (Phaser.GameObjects.GameObject & { x: number; y: number })
      | null;
    if (!sprite) {
      return;
    }
    const dx = target.x - sprite.x;
    const dy = target.y - sprite.y;
    const distSq = dx * dx + dy * dy;
    if (distSq <= this.tolerance * this.tolerance) {
      this.idx += 1;
      if (this.idx >= this.waypoints.length) {
        this.idx = this.loop ? 0 : this.waypoints.length - 1;
      }
      return;
    }
    const dist = Math.sqrt(distSq);
    const step = this.speed * dt;
    sprite.x += (dx / dist) * step;
    sprite.y += (dy / dist) * step;
  }
}
