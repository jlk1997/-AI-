/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type Phaser from 'phaser';

import { Entity } from './Entity.js';

/**
 * The World owns Entity lifetimes for one Phaser Scene. It is intentionally
 * small: no system pipelines, no event bus — those live one layer above as
 * regular Components / Behaviors.
 */
export class World {
  readonly scene: Phaser.Scene;
  private readonly entities: Map<number, Entity>;
  private readonly byTag: Map<string, Set<number>>;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.entities = new Map();
    this.byTag = new Map();
  }

  spawn(tags: readonly string[] = []): Entity {
    const entity = new Entity(this.scene, tags);
    this.entities.set(entity.id, entity);
    for (const tag of tags) {
      let set = this.byTag.get(tag);
      if (!set) {
        set = new Set();
        this.byTag.set(tag, set);
      }
      set.add(entity.id);
    }
    return entity;
  }

  get(id: number): Entity | null {
    return this.entities.get(id) ?? null;
  }

  withTag(tag: string): Entity[] {
    const ids = this.byTag.get(tag);
    if (!ids) {
      return [];
    }
    const out: Entity[] = [];
    for (const id of ids) {
      const e = this.entities.get(id);
      if (e && e.isAlive()) {
        out.push(e);
      }
    }
    return out;
  }

  all(): Entity[] {
    const out: Entity[] = [];
    for (const e of this.entities.values()) {
      if (e.isAlive()) {
        out.push(e);
      }
    }
    return out;
  }

  /** Call once per Phaser `update(time, delta)` tick. */
  update(dt: number): void {
    const stale: number[] = [];
    for (const e of this.entities.values()) {
      if (!e.isAlive()) {
        stale.push(e.id);
        continue;
      }
      e.update(dt);
    }
    for (const id of stale) {
      this.entities.delete(id);
      for (const set of this.byTag.values()) {
        set.delete(id);
      }
    }
  }

  destroyAll(): void {
    for (const e of this.entities.values()) {
      e.destroy();
    }
    this.entities.clear();
    this.byTag.clear();
  }
}
