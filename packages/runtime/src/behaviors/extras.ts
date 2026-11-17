/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type Phaser from 'phaser';

import type { Entity } from '../core/Entity.js';
import { Behavior } from './IBehavior.js';

/** Linear velocity behavior — handy for projectiles / scrolling platforms. */
export interface VelocityOptions {
  readonly vx: number;
  readonly vy: number;
}
export class Velocity extends Behavior {
  override readonly key = 'velocity';
  constructor(private readonly opts: VelocityOptions) {
    super();
  }
  override update(entity: Entity, dt: number): void {
    const s = entity.sprite as { x: number; y: number } | null;
    if (!s) return;
    s.x += this.opts.vx * dt;
    s.y += this.opts.vy * dt;
  }
}

/** Self-destroy after `ttlSec`. */
export interface LifetimeOptions {
  readonly ttlSec: number;
}
export class Lifetime extends Behavior {
  override readonly key = 'lifetime';
  private elapsed = 0;
  constructor(private readonly opts: LifetimeOptions) {
    super();
  }
  override update(entity: Entity, dt: number): void {
    this.elapsed += dt;
    if (this.elapsed >= this.opts.ttlSec) entity.destroy();
  }
}

/** Periodically spawn child entities — used by waves / bullet patterns. */
export interface SpawnerOptions {
  readonly intervalSec: number;
  readonly maxAlive?: number;
  readonly tag: string;
  readonly factory: (
    scene: Phaser.Scene,
    x: number,
    y: number,
  ) => Phaser.GameObjects.GameObject & { x: number; y: number };
}
export class Spawner extends Behavior {
  override readonly key = 'spawner';
  private accum = 0;
  constructor(private readonly opts: SpawnerOptions) {
    super();
  }
  override update(entity: Entity, dt: number): void {
    this.accum += dt;
    if (this.accum < this.opts.intervalSec) return;
    this.accum = 0;
    const world = (entity.scene as Phaser.Scene & { __ogWorld?: { withTag: (t: string) => Entity[]; spawn: (tags: string[]) => Entity } }).__ogWorld;
    if (!world) return;
    if (this.opts.maxAlive !== undefined && world.withTag(this.opts.tag).length >= this.opts.maxAlive) {
      return;
    }
    const s = entity.sprite as { x: number; y: number } | null;
    if (!s) return;
    const child = world.spawn([this.opts.tag]);
    child.attachSprite(this.opts.factory(entity.scene, s.x, s.y));
  }
}

/** Floor + ceiling clamp — good for arcade / platformer constraints. */
export interface BoundsOptions {
  readonly minX?: number;
  readonly maxX?: number;
  readonly minY?: number;
  readonly maxY?: number;
  readonly onExit?: 'wrap' | 'clamp' | 'destroy';
}
export class Bounds extends Behavior {
  override readonly key = 'bounds';
  constructor(private readonly opts: BoundsOptions) {
    super();
  }
  override update(entity: Entity, _dt: number): void {
    const s = entity.sprite as { x: number; y: number } | null;
    if (!s) return;
    const o = this.opts;
    const policy = o.onExit ?? 'clamp';
    const violated =
      (o.minX !== undefined && s.x < o.minX) ||
      (o.maxX !== undefined && s.x > o.maxX) ||
      (o.minY !== undefined && s.y < o.minY) ||
      (o.maxY !== undefined && s.y > o.maxY);
    if (!violated) return;
    if (policy === 'destroy') {
      entity.destroy();
      return;
    }
    if (policy === 'wrap') {
      const w = (o.maxX ?? 0) - (o.minX ?? 0);
      const h = (o.maxY ?? 0) - (o.minY ?? 0);
      if (o.minX !== undefined && o.maxX !== undefined) {
        if (s.x < o.minX) s.x += w;
        if (s.x > o.maxX) s.x -= w;
      }
      if (o.minY !== undefined && o.maxY !== undefined) {
        if (s.y < o.minY) s.y += h;
        if (s.y > o.maxY) s.y -= h;
      }
      return;
    }
    if (o.minX !== undefined && s.x < o.minX) s.x = o.minX;
    if (o.maxX !== undefined && s.x > o.maxX) s.x = o.maxX;
    if (o.minY !== undefined && s.y < o.minY) s.y = o.minY;
    if (o.maxY !== undefined && s.y > o.maxY) s.y = o.maxY;
  }
}

/** Pointer drag-and-drop on the entity sprite. */
export class Draggable extends Behavior {
  override readonly key = 'draggable';
  override attach(entity: Entity): void {
    const s = entity.sprite as
      | (Phaser.GameObjects.GameObject & { setInteractive?: () => unknown })
      | null;
    if (!s || typeof s.setInteractive !== 'function') return;
    s.setInteractive();
    entity.scene.input.setDraggable(s as Phaser.GameObjects.GameObject);
    entity.scene.input.on(
      'drag',
      (
        _ptr: Phaser.Input.Pointer,
        obj: Phaser.GameObjects.GameObject & { x: number; y: number },
        x: number,
        y: number,
      ) => {
        if (obj === s) {
          obj.x = x;
          obj.y = y;
        }
      },
    );
  }
}

/** Snap to a grid each tick — for puzzle / match games. */
export interface GridSnapOptions {
  readonly cellSize: number;
  readonly originX?: number;
  readonly originY?: number;
}
export class GridSnap extends Behavior {
  override readonly key = 'gridSnap';
  constructor(private readonly opts: GridSnapOptions) {
    super();
  }
  override update(entity: Entity, _dt: number): void {
    const s = entity.sprite as { x: number; y: number } | null;
    if (!s) return;
    const ox = this.opts.originX ?? 0;
    const oy = this.opts.originY ?? 0;
    s.x = ox + Math.round((s.x - ox) / this.opts.cellSize) * this.opts.cellSize;
    s.y = oy + Math.round((s.y - oy) / this.opts.cellSize) * this.opts.cellSize;
  }
}
