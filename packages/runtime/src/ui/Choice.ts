/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import Phaser from 'phaser';

import { UI_FONT, fontPx } from './fonts.js';

export interface ChoiceOption {
  readonly label: string;
  readonly onSelect: () => void;
}

/** Lightweight vertical choice menu rendered as text buttons. */
export class ChoicePanel {
  private readonly scene: Phaser.Scene;
  private readonly container: Phaser.GameObjects.Container;

  constructor(
    scene: Phaser.Scene,
    options: ReadonlyArray<ChoiceOption>,
    x = 0,
    y = 0,
  ) {
    this.scene = scene;
    this.container = scene.add.container(x, y).setDepth(1500);
    options.forEach((opt, i) => {
      const txt = scene.add
        .text(0, i * 38, `> ${opt.label}`, {
          fontFamily: UI_FONT,
          fontSize: fontPx(21),
          color: '#a5f3fc',
          backgroundColor: '#0f172a',
          padding: { x: 12, y: 6 },
        })
        .setInteractive({ useHandCursor: true });
      txt.on('pointerover', () => txt.setColor('#fef08a'));
      txt.on('pointerout', () => txt.setColor('#a5f3fc'));
      txt.on('pointerdown', () => opt.onSelect());
      this.container.add(txt);
    });
  }

  setPosition(x: number, y: number): void {
    this.container.setPosition(x, y);
  }

  destroy(): void {
    this.container.destroy(true);
  }
}
