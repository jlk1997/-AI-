/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import Phaser from 'phaser';

import { HUD } from '@opengame/runtime';

/**
 * PoC: Flappy Bird-like. Demonstrates that the runtime + a single user
 * `Phaser.Scene` class is enough to ship a playable arcade game without any
 * archetype template. The Coder Agent's deliverable looks structurally like
 * this file.
 */
export class FlappyScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Rectangle;
  private velocity = 0;
  private readonly gravity = 1200;
  private readonly flap = -380;
  private pipes!: Phaser.GameObjects.Group;
  private spawnTimer = 0;
  private score = 0;
  private hud!: HUD;
  private dead = false;

  constructor() {
    super({ key: 'flappy' });
  }

  create(): void {
    this.player = this.add.rectangle(120, 360, 36, 36, 0xfbbf24);
    this.physics.add.existing(this.player);
    this.pipes = this.add.group();
    this.hud = new HUD(this);
    this.input.on('pointerdown', () => this.flapImpulse());
    this.input.keyboard?.on('keydown-SPACE', () => this.flapImpulse());
  }

  update(_time: number, delta: number): void {
    if (this.dead) return;
    const dt = delta / 1000;
    this.velocity += this.gravity * dt;
    this.player.y += this.velocity * dt;
    if (this.player.y > this.cameras.main.height - 18 || this.player.y < 18) {
      this.die();
      return;
    }
    this.spawnTimer += delta;
    if (this.spawnTimer > 1600) {
      this.spawnTimer = 0;
      this.spawnPipe();
    }
    for (const pipe of this.pipes.getChildren() as Phaser.GameObjects.Rectangle[]) {
      pipe.x -= 180 * dt;
      if (pipe.x < -40) {
        pipe.destroy();
      }
      if (this.intersects(this.player, pipe)) {
        this.die();
        return;
      }
    }
    this.score += dt * 10;
    this.hud.setScore(Math.floor(this.score));
  }

  private flapImpulse(): void {
    if (this.dead) {
      this.scene.restart();
      return;
    }
    this.velocity = this.flap;
  }

  private spawnPipe(): void {
    const gap = 180;
    const cy = Phaser.Math.Between(160, this.cameras.main.height - 160);
    const top = this.add.rectangle(this.cameras.main.width + 40, cy - gap / 2 - 200, 60, 400, 0x10b981);
    const bot = this.add.rectangle(this.cameras.main.width + 40, cy + gap / 2 + 200, 60, 400, 0x10b981);
    this.pipes.add(top);
    this.pipes.add(bot);
  }

  private intersects(a: Phaser.GameObjects.Rectangle, b: Phaser.GameObjects.Rectangle): boolean {
    return Phaser.Geom.Intersects.RectangleToRectangle(
      new Phaser.Geom.Rectangle(a.x - a.width / 2, a.y - a.height / 2, a.width, a.height),
      new Phaser.Geom.Rectangle(b.x - b.width / 2, b.y - b.height / 2, b.width, b.height),
    );
  }

  private die(): void {
    this.dead = true;
    this.add
      .text(this.cameras.main.width / 2, this.cameras.main.height / 2, 'Tap to restart', {
        fontFamily: 'monospace',
        fontSize: '24px',
        color: '#ffffff',
        backgroundColor: '#000000',
        padding: { x: 16, y: 8 },
      })
      .setOrigin(0.5);
  }
}
