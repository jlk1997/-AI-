/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type Phaser from 'phaser';

export interface WorldSceneConfig {
  readonly mapWidth: number;
  readonly mapHeight: number;
  readonly playerSpeed?: number;
}

/** Minimal helper for top-down Level scenes — Agent extends with tilemaps/enemies. */
export class WorldSceneHelper {
  constructor(
    private readonly scene: Phaser.Scene,
    private readonly config: WorldSceneConfig,
  ) {}

  clampToWorld(sprite: Phaser.Types.Physics.Arcade.GameObjectWithBody): void {
    const body = sprite.body as Phaser.Physics.Arcade.Body | null;
    if (!body) return;
    body.setCollideWorldBounds(true);
    this.scene.physics.world.setBounds(0, 0, this.config.mapWidth, this.config.mapHeight);
  }

  get playerSpeed(): number {
    return this.config.playerSpeed ?? 160;
  }
}
