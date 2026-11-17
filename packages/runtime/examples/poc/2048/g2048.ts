/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import Phaser from 'phaser';

import { HUD } from '@opengame/runtime';

const SIZE = 4;
const TILE = 100;
const PAD = 12;
const ORIGIN_X = 40;
const ORIGIN_Y = 100;

type Board = number[][];

const COLORS: Record<number, number> = {
  0: 0xcdc1b4,
  2: 0xeee4da,
  4: 0xede0c8,
  8: 0xf2b179,
  16: 0xf59563,
  32: 0xf67c5f,
  64: 0xf65e3b,
  128: 0xedcf72,
  256: 0xedcc61,
  512: 0xedc850,
  1024: 0xedc53f,
  2048: 0xedc22e,
};

export class TwentyFortyEightScene extends Phaser.Scene {
  private board: Board = [];
  private hud!: HUD;
  private g!: Phaser.GameObjects.Graphics;
  private texts: Phaser.GameObjects.Text[][] = [];
  private score = 0;
  private dead = false;

  constructor() {
    super({ key: '2048' });
  }

  create(): void {
    this.hud = new HUD(this);
    this.g = this.add.graphics();
    this.board = Array.from({ length: SIZE }, () => Array<number>(SIZE).fill(0));
    this.texts = Array.from({ length: SIZE }, (_, r) =>
      Array.from({ length: SIZE }, (_, c) =>
        this.add
          .text(
            ORIGIN_X + c * (TILE + PAD) + TILE / 2,
            ORIGIN_Y + r * (TILE + PAD) + TILE / 2,
            '',
            { fontFamily: 'monospace', fontSize: '32px', color: '#1f2937' },
          )
          .setOrigin(0.5),
      ),
    );
    this.spawn();
    this.spawn();
    this.draw();
    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => this.onKey(e.key));
  }

  private onKey(key: string): void {
    if (this.dead) {
      if (key === ' ' || key === 'Enter') this.scene.restart();
      return;
    }
    const before = JSON.stringify(this.board);
    if (key === 'ArrowLeft') this.move((row) => this.slide(row));
    else if (key === 'ArrowRight') this.move((row) => this.slide(row.slice().reverse()).reverse());
    else if (key === 'ArrowUp') this.transposeAndMove(false);
    else if (key === 'ArrowDown') this.transposeAndMove(true);
    else return;
    if (JSON.stringify(this.board) !== before) {
      this.spawn();
      this.draw();
      this.hud.setScore(this.score);
      if (!this.hasMoves()) this.die();
    }
  }

  private slide(row: number[]): number[] {
    const filtered = row.filter((v) => v !== 0);
    for (let i = 0; i < filtered.length - 1; i++) {
      if (filtered[i] === filtered[i + 1]) {
        filtered[i] = (filtered[i] ?? 0) * 2;
        this.score += filtered[i] ?? 0;
        filtered[i + 1] = 0;
      }
    }
    const merged = filtered.filter((v) => v !== 0);
    while (merged.length < SIZE) merged.push(0);
    return merged;
  }

  private move(fn: (row: number[]) => number[]): void {
    for (let r = 0; r < SIZE; r++) {
      this.board[r] = fn(this.board[r]!);
    }
  }

  private transposeAndMove(reverse: boolean): void {
    const t: Board = Array.from({ length: SIZE }, () => Array<number>(SIZE).fill(0));
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) t[c]![r] = this.board[r]![c]!;
    }
    this.board = t;
    this.move((row) => (reverse ? this.slide(row.slice().reverse()).reverse() : this.slide(row)));
    const back: Board = Array.from({ length: SIZE }, () => Array<number>(SIZE).fill(0));
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) back[c]![r] = this.board[r]![c]!;
    }
    this.board = back;
  }

  private spawn(): void {
    const empty: Array<{ r: number; c: number }> = [];
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) if (this.board[r]![c] === 0) empty.push({ r, c });
    }
    if (empty.length === 0) return;
    const pick = empty[Phaser.Math.Between(0, empty.length - 1)]!;
    this.board[pick.r]![pick.c] = Math.random() < 0.9 ? 2 : 4;
  }

  private hasMoves(): boolean {
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (this.board[r]![c] === 0) return true;
        if (c + 1 < SIZE && this.board[r]![c] === this.board[r]![c + 1]) return true;
        if (r + 1 < SIZE && this.board[r]![c] === this.board[r + 1]![c]) return true;
      }
    }
    return false;
  }

  private draw(): void {
    this.g.clear();
    this.g.fillStyle(0xbbada0, 1);
    this.g.fillRect(
      ORIGIN_X - PAD,
      ORIGIN_Y - PAD,
      SIZE * (TILE + PAD) + PAD,
      SIZE * (TILE + PAD) + PAD,
    );
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const v = this.board[r]![c]!;
        const color = COLORS[v] ?? 0x3c3a32;
        this.g.fillStyle(color, 1);
        this.g.fillRect(ORIGIN_X + c * (TILE + PAD), ORIGIN_Y + r * (TILE + PAD), TILE, TILE);
        this.texts[r]![c]!.setText(v === 0 ? '' : String(v));
      }
    }
  }

  private die(): void {
    this.dead = true;
    this.add
      .text(this.cameras.main.width / 2, this.cameras.main.height / 2, 'Game Over · Space to restart', {
        fontFamily: 'monospace',
        fontSize: '22px',
        color: '#1f2937',
        backgroundColor: '#faf8ef',
        padding: { x: 12, y: 8 },
      })
      .setOrigin(0.5);
  }
}
