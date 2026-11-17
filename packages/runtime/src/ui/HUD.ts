/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type Phaser from 'phaser';

import { UI_FONT, fontPx } from './fonts.js';

/**
 * Camera-pinned score / lives HUD with a soft panel (engine shell feel).
 */
export class HUD {
  private readonly scene: Phaser.Scene;
  private readonly panel: Phaser.GameObjects.Rectangle;
  private readonly scoreText: Phaser.GameObjects.Text;
  private readonly livesText: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.panel = scene.add
      .rectangle(108, 40, 200, 64, 0x020617, 0.55)
      .setStrokeStyle(1, 0x334155, 0.9)
      .setScrollFactor(0)
      .setDepth(1999)
      .setOrigin(0.5);
    this.scoreText = scene.add
      .text(24, 18, 'Score  0', {
        fontFamily: UI_FONT,
        fontSize: fontPx(22),
        color: '#f8fafc',
      })
      .setScrollFactor(0)
      .setDepth(2000);
    this.livesText = scene.add
      .text(24, 46, '', {
        fontFamily: UI_FONT,
        fontSize: fontPx(16),
        color: '#fde68a',
      })
      .setScrollFactor(0)
      .setDepth(2000);
  }

  setScore(value: number): void {
    this.scoreText.setText(`Score  ${value}`);
  }

  setLives(value: number): void {
    this.livesText.setText(value > 0 ? `Lives  ${value}` : '');
    this.panel.setDisplaySize(200, value > 0 ? 72 : 56);
  }

  destroy(): void {
    this.panel.destroy();
    this.scoreText.destroy();
    this.livesText.destroy();
  }
}
