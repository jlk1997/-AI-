/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type Phaser from 'phaser';

import type { Entity } from '../core/Entity.js';
import type { World } from '../core/World.js';
import { Behavior } from './IBehavior.js';

interface Positioned {
  x: number;
  y: number;
}

function spriteOf(entity: Entity): Positioned | null {
  return (entity.sprite as Positioned | null) ?? null;
}

function worldOf(entity: Entity): World | null {
  const holder = entity.scene as Phaser.Scene & { __ogWorld?: World };
  return holder.__ogWorld ?? null;
}

/** Nearest tagged entity distance, or `null` when no tagged sprite exists. */
function nearestTaggedDistance(
  entity: Entity,
  self: Positioned,
  tag: string,
): number | null {
  const world = worldOf(entity);
  if (!world) return null;
  let best: number | null = null;
  for (const other of world.withTag(tag)) {
    const pos = spriteOf(other);
    if (!pos) continue;
    const d = Math.hypot(pos.x - self.x, pos.y - self.y);
    if (best === null || d < best) best = d;
  }
  return best;
}

export interface SceneTransitionOptions {
  /** Phaser scene key to start when the tagged entity walks in. */
  readonly targetSceneId: string;
  readonly targetTag?: string;
  readonly range?: number;
  readonly label?: string;
}

/**
 * Portal / door: starts another scene when a tagged entity (the player by
 * default) reaches this entity. Arms only after the target has once been
 * *outside* `range`, so a player spawning on the arrival portal cannot
 * ping-pong between two scenes.
 */
export class SceneTransition extends Behavior {
  override readonly key = 'sceneTransition';
  private readonly opts: SceneTransitionOptions;
  private armed = false;
  private fired = false;

  constructor(opts: SceneTransitionOptions) {
    super();
    this.opts = opts;
  }

  override update(entity: Entity, _dt: number): void {
    if (this.fired) return;
    const target = String(this.opts.targetSceneId ?? '');
    if (!target) return;
    const self = spriteOf(entity);
    if (!self) return;
    const dist = nearestTaggedDistance(
      entity,
      self,
      this.opts.targetTag ?? 'player',
    );
    if (dist === null) return;
    const range = this.opts.range ?? 36;
    if (dist > range) {
      this.armed = true;
      return;
    }
    if (!this.armed) return;
    const manager = entity.scene.scene;
    if (!manager || typeof manager.get !== 'function' || !manager.get(target)) {
      // Target scene not registered — stay put instead of hard-failing.
      return;
    }
    this.fired = true;
    entity.scene.events.emit('og:travel', {
      to: target,
      label: this.opts.label ?? '',
    });
    manager.start(target);
  }
}

export interface CollectOnTouchOptions {
  readonly byTag?: string;
  readonly range?: number;
  readonly score?: number;
  /** Emit `og:win` once the score reaches this value (0 disables). */
  readonly winAt?: number;
  /** Registry key set to `true` on pickup — lets scenes gate quest logic. */
  readonly flag?: string;
}

/**
 * Pickup: destroys this entity when a tagged entity touches it, adds score and
 * raises `og:win` at `winAt`. This is the collect-to-win loop the World Spec
 * compiler emits for `entities[kind=item]`.
 */
export class CollectOnTouch extends Behavior {
  override readonly key = 'collectOnTouch';
  private readonly opts: CollectOnTouchOptions;
  private taken = false;

  constructor(opts: CollectOnTouchOptions) {
    super();
    this.opts = opts;
  }

  override update(entity: Entity, _dt: number): void {
    if (this.taken) return;
    const self = spriteOf(entity);
    if (!self) return;
    const dist = nearestTaggedDistance(
      entity,
      self,
      this.opts.byTag ?? 'player',
    );
    if (dist === null || dist > (this.opts.range ?? 26)) return;
    this.taken = true;
    const scene = entity.scene;
    const delta = Number(this.opts.score ?? 10);
    const next = Number(scene.registry.get('score') ?? 0) + delta;
    scene.registry.set('score', next);
    scene.events.emit('og:score', next);
    if (this.opts.flag) scene.registry.set(this.opts.flag, true);
    this.playPickupSfx(scene);
    const winAt = Number(this.opts.winAt ?? 0);
    if (winAt > 0 && next >= winAt && !scene.registry.get('won')) {
      scene.registry.set('won', true);
      scene.events.emit('og:win', { score: next, winAt });
    }
    entity.destroy();
  }

  private playPickupSfx(scene: Phaser.Scene): void {
    try {
      const cache = scene.cache.audio;
      if (cache.exists('sfx_coin')) {
        scene.sound.play('sfx_coin', { volume: 0.4 });
      } else if (cache.exists('sfx_win')) {
        scene.sound.play('sfx_win', { volume: 0.26 });
      }
    } catch {
      // autoplay policy / asset not loaded
    }
  }
}

export interface DamageOnTouchOptions {
  /** Who takes the hit (default `player`). */
  readonly targetTag?: string;
  readonly range?: number;
  /** HP subtracted per contact (default 1). */
  readonly amount?: number;
  /** Milliseconds between hits from this entity (default 700). */
  readonly cooldownMs?: number;
  /**
   * Seed registry `hp` from this value when the scene has not set one yet —
   * matches the World Spec player's `state.hp` so lose conditions work without
   * extra Agent code.
   */
  readonly initialHp?: number;
  /** Emit `og:lose` when HP reaches 0 (default true). */
  readonly loseAtZero?: boolean;
}

/**
 * Contact hazard: drains registry HP when a tagged entity walks into range.
 * Paired with `Chase` on world-compiled enemies so L2 `enemyHpScale` /
 * `contactDamage` tunables change real fail states instead of dead metadata.
 */
export class DamageOnTouch extends Behavior {
  override readonly key = 'damageOnTouch';
  private readonly opts: DamageOnTouchOptions;
  private nextHitAt = 0;

  constructor(opts: DamageOnTouchOptions) {
    super();
    this.opts = opts;
  }

  override update(entity: Entity, _dt: number): void {
    const self = spriteOf(entity);
    if (!self) return;
    const dist = nearestTaggedDistance(
      entity,
      self,
      this.opts.targetTag ?? 'player',
    );
    if (dist === null || dist > (this.opts.range ?? 28)) return;
    const now = Date.now();
    if (now < this.nextHitAt) return;
    this.nextHitAt = now + (this.opts.cooldownMs ?? 700);

    const scene = entity.scene;
    if (scene.registry.get('won') || scene.registry.get('lost')) return;

    let hp = scene.registry.get('hp');
    if (typeof hp !== 'number' || !Number.isFinite(hp)) {
      const seed =
        typeof this.opts.initialHp === 'number' && Number.isFinite(this.opts.initialHp)
          ? this.opts.initialHp
          : Number(scene.registry.get('maxHp') ?? 12);
      hp = Math.max(1, Math.round(seed));
      scene.registry.set('hp', hp);
      if (scene.registry.get('maxHp') == null) {
        scene.registry.set('maxHp', hp);
      }
    }

    const amount = Math.max(1, Math.round(Number(this.opts.amount ?? 1)));
    const next = Math.max(0, Number(hp) - amount);
    scene.registry.set('hp', next);
    scene.events.emit('og:hp', { hp: next, amount, source: entity.id });

    if (next <= 0 && this.opts.loseAtZero !== false && !scene.registry.get('lost')) {
      scene.registry.set('lost', true);
      scene.events.emit('og:lose', { reason: 'hp', source: entity.id });
      try {
        if (scene.cache.audio.exists('sfx_lose')) {
          scene.sound.play('sfx_lose', { volume: 0.5 });
        }
      } catch {
        // autoplay / missing
      }
    }
  }
}
