/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Entity } from './Entity.js';

/**
 * A Component is a small, side-effect-free piece of data + lifecycle hooks
 * attached to an Entity. The runtime guarantees:
 *   - `attach` is called exactly once per Entity, after the Entity is added to a World.
 *   - `update(dt)` runs once per Phaser scene update tick while the Entity is alive.
 *   - `detach` runs when the Entity is destroyed or the Component is removed.
 *
 * Implementations must remain Phaser-agnostic where possible; Phaser objects
 * are reached via `entity.sprite` or `entity.scene`.
 */
export interface IComponent {
  readonly key: string;
  attach?(entity: Entity): void;
  update?(entity: Entity, dt: number): void;
  detach?(entity: Entity): void;
}

/**
 * Convenience base that fills in the boring bits so DSL-derived components
 * stay terse.
 */
export abstract class Component implements IComponent {
  abstract readonly key: string;
  attach(_entity: Entity): void {
    /* no-op */
  }
  update(_entity: Entity, _dt: number): void {
    /* no-op */
  }
  detach(_entity: Entity): void {
    /* no-op */
  }
}
