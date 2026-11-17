/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Capability Scene sources. Presentation only — rules live in module-board /
 * module-cards / module-emitter. Not finished-game templates.
 */

function juiceHelpers(): string {
  return `
function playJuice(scene: Phaser.Scene, key: 'sfx_coin' | 'sfx_win' | 'sfx_lose', vol = 0.45): void {
  try {
    PlatformSceneHelper.playSfx(scene, key, vol);
  } catch { /* autoplay */ }
}
function consumeJiaxi(scene: Phaser.Scene, key: string): boolean {
  const n = Number(scene.registry.get(key) ?? 0);
  if (n <= 0) return false;
  scene.registry.set(key, n - 1);
  return true;
}
function jiaxiMul(scene: Phaser.Scene): number {
  const m = Number(scene.registry.get('jiaxiScoreMul') ?? 1);
  return m > 0 ? m : 1;
}
`.trim();
}

export function match3SceneSource(): string {
  return `/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Match-3 carrier — juice + adjacent swap. Rules: Match3Rules.
 */
import Phaser from 'phaser';
import { PlatformSceneHelper } from '@opengame/module-platform';
import { Match3Rules, type Cell } from '@opengame/module-board';

${juiceHelpers()}

const ORIGIN_X = 48;
const ORIGIN_Y = 48;
const COLORS = [0xef4444, 0x22c55e, 0x3b82f6, 0xeab308, 0xa855f7, 0xf97316];

export class Match3Scene extends Phaser.Scene {
  private board = Match3Rules.create(8, 8, 3);
  private selected: Cell | null = null;
  private g!: Phaser.GameObjects.Graphics;
  private status!: Phaser.GameObjects.Text;
  private cell = 44;

  constructor() {
    super({ key: 'Match3Scene' });
  }

  preload(): void {
    PlatformSceneHelper.preloadGameAudio(this);
    PlatformSceneHelper.preloadGameArt(this);
  }

  create(): void {
    PlatformSceneHelper.ensureBgm(this, 0.28);
    PlatformSceneHelper.installPauseMenu(this);
    if (!PlatformSceneHelper.addParallaxBackground(this, 'og_bg')) {
      this.cameras.main.setBackgroundColor(0x1e1b4b);
    }
    this.g = this.add.graphics();
    this.status = this.add
      .text(12, 8, '', { fontFamily: 'sans-serif', fontSize: '16px', color: '#e0e7ff' })
      .setScrollFactor(0);
    this.registry.set('score', 0);
    this.registry.set('won', false);
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.onTap(p.worldX, p.worldY));
    this.redraw();
  }

  private cellAt(x: number, y: number): Cell | null {
    const col = Math.floor((x - ORIGIN_X) / this.cell);
    const row = Math.floor((y - ORIGIN_Y) / this.cell);
    if (col < 0 || row < 0 || col >= this.board.cols || row >= this.board.rows) return null;
    return { col, row };
  }

  private onTap(x: number, y: number): void {
    const cell = this.cellAt(x, y);
    if (!cell) return;
    if (!this.selected) {
      this.selected = cell;
      this.redraw();
      return;
    }
    const next = Match3Rules.applySwap(this.board, this.selected, cell);
    if (next !== this.board) {
      this.board = next;
      this.registry.set('score', next.score * jiaxiMul(this));
      playJuice(this, 'sfx_coin', 0.35);
      if (Number(this.registry.get('score')) >= 24) {
        this.registry.set('won', true);
        playJuice(this, 'sfx_win', 0.55);
      }
    } else if (consumeJiaxi(this, 'jiaxiMatchExtraSwap')) {
      const cells = this.board.cells.map((row, r) =>
        row.map((v, c) => {
          if (r === this.selected!.row && c === this.selected!.col) return this.board.cells[cell.row]![cell.col]!;
          if (r === cell.row && c === cell.col) return this.board.cells[this.selected!.row]![this.selected!.col]!;
          return v;
        }),
      );
      this.board = { ...this.board, cells };
      playJuice(this, 'sfx_coin', 0.25);
    }
    this.selected = null;
    this.redraw();
  }

  private redraw(): void {
    this.g.clear();
    for (let r = 0; r < this.board.rows; r += 1) {
      for (let c = 0; c < this.board.cols; c += 1) {
        const x = ORIGIN_X + c * this.cell;
        const y = ORIGIN_Y + r * this.cell;
        const kind = this.board.cells[r]![c] ?? 1;
        this.g.fillStyle(COLORS[(kind - 1) % COLORS.length]!, 1);
        this.g.fillRoundedRect(x + 2, y + 2, this.cell - 4, this.cell - 4, 6);
      }
    }
    if (this.selected) {
      this.g.lineStyle(2, 0xf8fafc, 1);
      this.g.strokeRect(
        ORIGIN_X + this.selected.col * this.cell,
        ORIGIN_Y + this.selected.row * this.cell,
        this.cell,
        this.cell,
      );
    }
    this.status.setText(
      this.registry.get('won')
        ? '三连消除 · 过关'
        : \`交换相邻格 · \${this.board.score}\`,
    );
  }
}
`;
}

export function cardsHandSceneSource(): string {
  return `/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Card-hand carrier — juice + draw/play. Rules: module-cards.
 */
import Phaser from 'phaser';
import { PlatformSceneHelper } from '@opengame/module-platform';
import { createStarterDeck, draw, playCard, type CardHandState } from '@opengame/module-cards';

${juiceHelpers()}

export class CardsHandScene extends Phaser.Scene {
  private state: CardHandState = draw(createStarterDeck(), 5);
  private labels: Phaser.GameObjects.GameObject[] = [];
  private status!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: 'CardsHandScene' });
  }

  preload(): void {
    PlatformSceneHelper.preloadGameAudio(this);
    PlatformSceneHelper.preloadGameArt(this);
  }

  create(): void {
    PlatformSceneHelper.ensureBgm(this, 0.28);
    PlatformSceneHelper.installPauseMenu(this);
    if (!PlatformSceneHelper.addParallaxBackground(this, 'og_bg')) {
      this.cameras.main.setBackgroundColor(0x1c1917);
    }
    this.status = this.add
      .text(12, 8, '', { fontFamily: 'sans-serif', fontSize: '16px', color: '#fef3c7' })
      .setScrollFactor(0);
    this.registry.set('score', 0);
    this.registry.set('won', false);
    this.drawJiaxi();
    this.game.events.on('opengame:jiaxi', () => this.drawJiaxi());
    this.redraw();
  }

  private drawJiaxi(): void {
    while (consumeJiaxi(this, 'jiaxiCardsExtraDraw')) {
      this.state = draw(this.state, 1);
    }
  }

  private playAt(index: number): void {
    const card = this.state.hand[index];
    if (!card) return;
    this.state = playCard(this.state, card.id);
    this.registry.set('score', this.state.discard.length);
    playJuice(this, 'sfx_coin', 0.35);
    if (this.state.discard.length >= 3) {
      this.registry.set('won', true);
      playJuice(this, 'sfx_win', 0.55);
    } else if (this.state.hand.length === 0) {
      this.state = draw(this.state, 3);
    }
    this.redraw();
  }

  private redraw(): void {
    for (const t of this.labels) t.destroy();
    this.labels = [];
    this.state.hand.forEach((card, i) => {
      const x = 80 + i * 140;
      const y = 320;
      const box = this.add
        .rectangle(x, y, 120, 160, 0x44403c)
        .setStrokeStyle(2, 0xfacc15)
        .setInteractive({ useHandCursor: true });
      box.on('pointerup', () => this.playAt(i));
      const label = this.add
        .text(x, y, \`\${card.name}\\ncost \${card.cost}\`, {
          fontFamily: 'sans-serif',
          fontSize: '16px',
          color: '#fefce8',
          align: 'center',
        })
        .setOrigin(0.5);
      this.labels.push(box);
      this.labels.push(label);
    });
    this.status.setText(
      this.registry.get('won')
        ? '出牌循环 · 过关'
        : \`手牌 \${this.state.hand.length} · 点牌打出 · 弃牌 \${this.state.discard.length}\`,
    );
  }
}
`;
}

export function emitterSceneSource(): string {
  return `/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Emitter carrier — juice + radial bullets. Rules: module-emitter.
 */
import Phaser from 'phaser';
import { PlatformSceneHelper } from '@opengame/module-platform';
import {
  createEmitter,
  emitRadial,
  hitTest,
  stepBullets,
  type EmitterState,
} from '@opengame/module-emitter';

${juiceHelpers()}

export class EmitterScene extends Phaser.Scene {
  private emitter: EmitterState = createEmitter();
  private player = { x: 480, y: 360 };
  private g!: Phaser.GameObjects.Graphics;
  private status!: Phaser.GameObjects.Text;
  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;
  private alive = 0;
  private dead = false;

  constructor() {
    super({ key: 'EmitterScene' });
  }

  preload(): void {
    PlatformSceneHelper.preloadGameAudio(this);
    PlatformSceneHelper.preloadGameArt(this);
  }

  create(): void {
    PlatformSceneHelper.ensureBgm(this, 0.28);
    PlatformSceneHelper.installPauseMenu(this);
    if (!PlatformSceneHelper.addParallaxBackground(this, 'og_bg')) {
      this.cameras.main.setBackgroundColor(0x0f172a);
    }
    this.g = this.add.graphics();
    this.status = this.add
      .text(12, 8, '', { fontFamily: 'sans-serif', fontSize: '16px', color: '#e2e8f0' })
      .setScrollFactor(0);
    this.cursors = this.input.keyboard?.createCursorKeys();
    this.registry.set('score', 0);
    this.registry.set('won', false);
    this.time.addEvent({
      delay: 900,
      loop: true,
      callback: () => {
        if (this.dead) return;
        const extra = Number(this.registry.get('jiaxiEmitterDenser') ?? 0);
        this.emitter = emitRadial(this.emitter, 480, 200, 10 + extra * 6, 120);
      },
    });
  }

  update(_t: number, delta: number): void {
    if (this.dead) return;
    const dt = delta / 1000;
    const speed = 220;
    if (this.cursors?.left?.isDown) this.player.x -= speed * dt;
    if (this.cursors?.right?.isDown) this.player.x += speed * dt;
    if (this.cursors?.up?.isDown) this.player.y -= speed * dt;
    if (this.cursors?.down?.isDown) this.player.y += speed * dt;
    this.player.x = Phaser.Math.Clamp(this.player.x, 24, 936);
    this.player.y = Phaser.Math.Clamp(this.player.y, 24, 516);
    this.emitter = stepBullets(this.emitter, dt, {
      minX: -20,
      minY: -20,
      maxX: 980,
      maxY: 560,
    });
    if (hitTest(this.emitter.bullets, this.player.x, this.player.y, 14)) {
      this.dead = true;
      playJuice(this, 'sfx_lose', 0.5);
      this.status.setText('弹幕命中');
      return;
    }
    this.alive += dt;
    this.registry.set('score', Math.floor(this.alive));
    if (this.alive >= 8) {
      this.registry.set('won', true);
      playJuice(this, 'sfx_win', 0.55);
      this.dead = true;
    }
    this.g.clear();
    this.g.fillStyle(0xfbbf24, 1);
    this.g.fillCircle(this.player.x, this.player.y, 12);
    this.g.fillStyle(0xf43f5e, 1);
    for (const b of this.emitter.bullets) {
      if (b.alive) this.g.fillCircle(b.x, b.y, 4);
    }
    this.status.setText(
      this.registry.get('won') ? '弹幕生存 · 过关' : \`方向键躲避 · \${Math.floor(this.alive)}s\`,
    );
  }
}
`;
}
