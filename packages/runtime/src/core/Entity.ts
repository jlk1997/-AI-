/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type Phaser from 'phaser';

import type { IComponent } from './Component.js';

let nextEntityId = 1;

/**
 * An Entity is a thin handle that owns:
 *   - a numeric id
 *   - an optional Phaser display object (sprite / container / image)
 *   - a bag of Components keyed by `component.key`
 *
 * Entities never inherit Phaser classes directly so behaviors stay portable
 * across sprite / container / particle representations.
 */
export class Entity {
  readonly id: number;
  readonly tags: Set<string>;
  scene: Phaser.Scene;
  sprite: Phaser.GameObjects.GameObject | null;
  private readonly components: Map<string, IComponent>;
  private alive: boolean;

  constructor(scene: Phaser.Scene, tags: readonly string[] = []) {
    this.id = nextEntityId++;
    this.scene = scene;
    this.sprite = null;
    this.tags = new Set(tags);
    this.components = new Map();
    this.alive = true;
  }

  isAlive(): boolean {
    return this.alive;
  }

  attachSprite<T extends Phaser.GameObjects.GameObject>(sprite: T): T {
    this.sprite = sprite;
    return sprite;
  }

  add<T extends IComponent>(component: T): T {
    if (this.components.has(component.key)) {
      throw new Error(
        `Entity ${this.id} already has a component with key "${component.key}"`,
      );
    }
    this.components.set(component.key, component);
    component.attach?.(this);
    return component;
  }

  get<T extends IComponent>(key: string): T | null {
    const c = this.components.get(key);
    return (c as T | undefined) ?? null;
  }

  has(key: string): boolean {
    return this.components.has(key);
  }

  remove(key: string): boolean {
    const c = this.components.get(key);
    if (!c) {
      return false;
    }
    c.detach?.(this);
    this.components.delete(key);
    return true;
  }

  update(dt: number): void {
    if (!this.alive) {
      return;
    }
    for (const c of this.components.values()) {
      c.update?.(this, dt);
    }
  }

  destroy(): void {
    if (!this.alive) {
      return;
    }
    this.alive = false;
    for (const c of this.components.values()) {
      c.detach?.(this);
    }
    this.components.clear();
    if (this.sprite && typeof (this.sprite as { destroy?: () => void }).destroy === 'function') {
      (this.sprite as { destroy: () => void }).destroy();
    }
    this.sprite = null;
  }
}
