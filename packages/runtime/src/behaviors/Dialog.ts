/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type Phaser from 'phaser';

import type { Entity } from '../core/Entity.js';
import { UI_FONT, fontPx } from '../ui/fonts.js';
import { Behavior } from './IBehavior.js';

export interface DialogLine {
  readonly id?: string;
  readonly speaker?: string;
  readonly text: string;
  readonly choices?: ReadonlyArray<{
    readonly label: string;
    readonly nextId?: string;
  }>;
  readonly nextId?: string;
}

export interface DialogOptions {
  readonly lines: ReadonlyArray<DialogLine>;
  /** Auto-advance after N seconds; 0 = wait for click/tap. */
  readonly autoAdvanceMs?: number;
  readonly onComplete?: () => void;
}

/**
 * Bottom-aligned dialog box. Supports linear advance and choice→nextId jumps.
 */
export class Dialog extends Behavior {
  override readonly key = 'dialog';
  private readonly opts: DialogOptions;
  private idx: number;
  private box?: Phaser.GameObjects.Rectangle;
  private text?: Phaser.GameObjects.Text;
  private choiceTexts: Phaser.GameObjects.Text[] = [];
  private elapsedMs: number;
  private awaitingChoice = false;
  private idIndex = new Map<string, number>();

  constructor(opts: DialogOptions) {
    super();
    this.opts = opts;
    this.idx = 0;
    this.elapsedMs = 0;
    opts.lines.forEach((l, i) => {
      if (l.id) this.idIndex.set(l.id, i);
    });
  }

  override attach(entity: Entity): void {
    const scene = entity.scene;
    const cam = scene.cameras.main;
    const w = cam.width;
    const h = cam.height;
    this.box = scene.add
      .rectangle(w / 2, h - 80, w - 40, 120, 0x000000, 0.6)
      .setStrokeStyle(2, 0xffffff)
      .setScrollFactor(0)
      .setDepth(1000);
    this.text = scene.add
      .text(40, h - 130, '', {
        fontFamily: UI_FONT,
        fontSize: fontPx(19),
        color: '#ffffff',
        wordWrap: { width: w - 80 },
      })
      .setScrollFactor(0)
      .setDepth(1001);
    this.render(entity);
    scene.input.on('pointerdown', () => {
      if (this.awaitingChoice) return;
      this.advance(entity);
    });
  }

  override update(entity: Entity, dt: number): void {
    if (this.awaitingChoice || !this.opts.autoAdvanceMs) return;
    this.elapsedMs += dt * 1000;
    if (this.elapsedMs >= this.opts.autoAdvanceMs) {
      this.elapsedMs = 0;
      this.advance(entity);
    }
  }

  override detach(_entity: Entity): void {
    this.box?.destroy();
    this.text?.destroy();
    this.clearChoices();
  }

  private clearChoices(): void {
    for (const t of this.choiceTexts) t.destroy();
    this.choiceTexts = [];
    this.awaitingChoice = false;
  }

  private jumpToId(entity: Entity, id: string): void {
    const idx = this.idIndex.get(id);
    if (idx == null) {
      this.opts.onComplete?.();
      entity.destroy();
      return;
    }
    this.idx = idx;
    this.render(entity);
  }

  private advance(entity: Entity): void {
    const line = this.opts.lines[this.idx];
    if (line?.nextId) {
      this.jumpToId(entity, line.nextId);
      return;
    }
    this.idx += 1;
    if (this.idx >= this.opts.lines.length) {
      this.opts.onComplete?.();
      entity.destroy();
      return;
    }
    this.render(entity);
  }

  private render(entity: Entity): void {
    const line = this.opts.lines[this.idx];
    if (!line || !this.text) return;
    this.clearChoices();
    this.text.setText(
      line.speaker ? `[${line.speaker}] ${line.text}` : line.text,
    );
    const choices = line.choices ?? [];
    if (choices.length === 0) return;
    this.awaitingChoice = true;
    const scene = entity.scene;
    const cam = scene.cameras.main;
    choices.forEach((c, i) => {
      const t = scene.add
        .text(60, cam.height - 70 + i * 24, `${i + 1}. ${c.label}`, {
          fontFamily: UI_FONT,
          fontSize: fontPx(17),
          color: '#fef08a',
        })
        .setScrollFactor(0)
        .setDepth(1002)
        .setInteractive({ useHandCursor: true });
      t.on('pointerup', () => {
        if (c.nextId) this.jumpToId(entity, c.nextId);
        else this.advance(entity);
      });
      this.choiceTexts.push(t);
    });
  }
}
