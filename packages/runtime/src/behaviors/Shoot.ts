/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type Phaser from 'phaser';

import type { Entity } from '../core/Entity.js';
import { Behavior } from './IBehavior.js';

export interface ShootOptions {
  /** Seconds between shots. */
  readonly cooldown: number;
  /** Tag of entities to aim at; pulls nearest from the World. */
  readonly targetTag: string;
  /** Projectile speed in px/s. */
  readonly projectileSpeed: number;
  /** Called when the projectile sprite needs to be created. */
  readonly spawnProjectile: (
    scene: Phaser.Scene,
    fromX: number,
    fromY: number,
  ) => Phaser.GameObjects.GameObject & { x: number; y: number };
  /** Max range; misses become no-ops if target is farther. */
  readonly range?: number;
}

interface Projectile {
  obj: Phaser.GameObjects.GameObject & { x: number; y: number };
  vx: number;
  vy: number;
  ttl: number;
}

export class Shoot extends Behavior {
  override readonly key = 'shoot';
  private readonly opts: ShootOptions;
  private elapsedSinceShot: number;
  private readonly projectiles: Projectile[];

  constructor(opts: ShootOptions) {
    super();
    this.opts = opts;
    this.elapsedSinceShot = opts.cooldown;
    this.projectiles = [];
  }

  override update(entity: Entity, dt: number): void {
    this.elapsedSinceShot += dt;
    this.advanceProjectiles(dt);

    const sprite = entity.sprite as
      | (Phaser.GameObjects.GameObject & { x: number; y: number })
      | null;
    if (!sprite || this.elapsedSinceShot < this.opts.cooldown) {
      return;
    }
    const world = (
      entity.scene as Phaser.Scene & { __ogWorld?: { withTag: (t: string) => Entity[] } }
    ).__ogWorld;
    if (!world) {
      return;
    }
    const targets = world.withTag(this.opts.targetTag);
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
    if (!best) return;
    const range = this.opts.range ?? Number.POSITIVE_INFINITY;
    const dist = Math.sqrt(best.d2);
    if (dist > range) return;
    const proj = this.opts.spawnProjectile(entity.scene, sprite.x, sprite.y);
    this.projectiles.push({
      obj: proj,
      vx: ((best.x - sprite.x) / dist) * this.opts.projectileSpeed,
      vy: ((best.y - sprite.y) / dist) * this.opts.projectileSpeed,
      ttl: 4,
    });
    this.elapsedSinceShot = 0;
  }

  private advanceProjectiles(dt: number): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i]!;
      p.obj.x += p.vx * dt;
      p.obj.y += p.vy * dt;
      p.ttl -= dt;
      if (p.ttl <= 0) {
        const obj = p.obj as unknown as { destroy?: () => void };
        if (typeof obj.destroy === 'function') {
          obj.destroy();
        }
        this.projectiles.splice(i, 1);
      }
    }
  }

  override detach(_entity: Entity): void {
    for (const p of this.projectiles) {
      const obj = p.obj as unknown as { destroy?: () => void };
      obj.destroy?.();
    }
    this.projectiles.length = 0;
  }
}
