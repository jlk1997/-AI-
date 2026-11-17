/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import Phaser from 'phaser';

import { World } from './World.js';

/**
 * Optional base scene that wires a `World` into Phaser's lifecycle. Generated
 * games are free to extend `Phaser.Scene` directly and instantiate a `World`
 * manually — this class is purely a convenience.
 */
export class RuntimeScene extends Phaser.Scene {
  protected world!: World;

  create(): void {
    this.world = new World(this);
    this.onReady();
  }

  override update(_time: number, delta: number): void {
    this.world?.update(delta / 1000);
    this.onTick(delta / 1000);
  }

  /** Override to spawn initial entities. */
  protected onReady(): void {
    /* no-op */
  }

  /** Override to run per-frame logic outside the entity loop. */
  protected onTick(_dt: number): void {
    /* no-op */
  }

  getWorld(): World {
    return this.world;
  }
}
