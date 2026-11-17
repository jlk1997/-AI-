/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import Phaser from 'phaser';

import { HUD } from '@opengame/runtime';

const CELL = 24;
const COLS = 25;
const ROWS = 25;

type Dir = { x: number; y: number };

export class SnakeScene extends Phaser.Scene {
  private snake: Array<{ x: number; y: number }> = [];
  private dir: Dir = { x: 1, y: 0 };
  private next: Dir = { x: 1, y: 0 };
  private food: { x: number; y: number } = { x: 10, y: 10 };
  private stepMs = 110;
  private accum = 0;
  private hud!: HUD;
  private g!: Phaser.GameObjects.Graphics;
  private dead = false;

  constructor() {
    super({ key: 'snake' });
  }

  create(): void {
    this.hud = new HUD(this);
    this.g = this.add.graphics();
    this.snake = [
      { x: 12, y: 12 },
      { x: 11, y: 12 },
      { x: 10, y: 12 },
    ];
    this.spawnFood();
    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => this.onKey(e.key));
  }

  update(_time: number, delta: number): void {
    if (this.dead) return;
    this.accum += delta;
    if (this.accum < this.stepMs) return;
    this.accum = 0;
    this.dir = this.next;
    const head = { x: this.snake[0]!.x + this.dir.x, y: this.snake[0]!.y + this.dir.y };
    if (head.x < 0 || head.y < 0 || head.x >= COLS || head.y >= ROWS) return this.die();
    if (this.snake.some((s) => s.x === head.x && s.y === head.y)) return this.die();
    this.snake.unshift(head);
    if (head.x === this.food.x && head.y === this.food.y) {
      this.spawnFood();
      this.hud.setScore(this.snake.length - 3);
    } else {
      this.snake.pop();
    }
    this.draw();
  }

  private onKey(key: string): void {
    if (this.dead && (key === ' ' || key === 'Enter')) {
      this.scene.restart();
      return;
    }
    if (key === 'ArrowUp' && this.dir.y === 0) this.next = { x: 0, y: -1 };
    if (key === 'ArrowDown' && this.dir.y === 0) this.next = { x: 0, y: 1 };
    if (key === 'ArrowLeft' && this.dir.x === 0) this.next = { x: -1, y: 0 };
    if (key === 'ArrowRight' && this.dir.x === 0) this.next = { x: 1, y: 0 };
  }

  private draw(): void {
    this.g.clear();
    this.g.fillStyle(0x22c55e, 1);
    for (const s of this.snake) {
      this.g.fillRect(s.x * CELL, s.y * CELL, CELL - 2, CELL - 2);
    }
    this.g.fillStyle(0xf472b6, 1);
    this.g.fillRect(this.food.x * CELL, this.food.y * CELL, CELL - 2, CELL - 2);
  }

  private spawnFood(): void {
    let x: number;
    let y: number;
    do {
      x = Phaser.Math.Between(0, COLS - 1);
      y = Phaser.Math.Between(0, ROWS - 1);
    } while (this.snake.some((s) => s.x === x && s.y === y));
    this.food = { x, y };
  }

  private die(): void {
    this.dead = true;
    this.add
      .text(this.cameras.main.width / 2, this.cameras.main.height / 2, 'Game Over · Space to restart', {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#fff',
        backgroundColor: '#0f172a',
        padding: { x: 12, y: 8 },
      })
      .setOrigin(0.5);
  }
}
