/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * grid_logic carriers: arcade kernels (Snake / Flappy / 2048) or board-turn
 * (xiangqi / chess / gomoku). Archetype is a physics hint, not a product SKU.
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

import { boardTurnSceneSource } from './boardTurnKernel.js';
import { match3SceneSource } from './capabilityKernels.js';
import { detectBoardKind, readMechanicSpec } from './mechanicSpec.js';

export type ArcadeVariant =
  | 'snake'
  | 'flappy'
  | 'g2048'
  | 'board_turn'
  | 'match3'
  | 'generic';

export function detectArcadeVariant(prompt: string): ArcadeVariant {
  const p = prompt.trim();
  if (detectBoardKind(p)) return 'board_turn';
  if (/消消乐|三消|match[\s-]?3/i.test(p)) return 'match3';
  if (/flappy|飞鸟|小鸟|拍翅膀|管道|tap\s*to\s*flap/i.test(p)) return 'flappy';
  if (/2048|二〇四八|合并数字|slide\s*tile/i.test(p)) return 'g2048';
  if (/snake|贪吃蛇|蛇身|吃食物/i.test(p)) return 'snake';
  return 'generic';
}

function juiceHelpers(): string {
  return `
function playJuice(scene: Phaser.Scene, key: 'sfx_coin' | 'sfx_win' | 'sfx_lose', vol = 0.45): void {
  try {
    PlatformSceneHelper.playSfx(scene, key, vol);
  } catch { /* autoplay */ }
}
`.trim();
}

function snakeSceneSource(): string {
  return `/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */
import Phaser from 'phaser';
import { PlatformSceneHelper } from '@opengame/module-platform';

${juiceHelpers()}

const CELL = 24;
const COLS = 25;
const ROWS = 20;

export class SnakeArcadeScene extends Phaser.Scene {
  private body: Array<{ x: number; y: number }> = [];
  private dir = { x: 1, y: 0 };
  private nextDir = { x: 1, y: 0 };
  private food = { x: 10, y: 10 };
  private stepMs = 120;
  private accum = 0;
  private g!: Phaser.GameObjects.Graphics;
  private dead = false;
  private score = 0;

  constructor() {
    super({ key: 'SnakeArcadeScene' });
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
    this.body = [{ x: 8, y: 10 }, { x: 7, y: 10 }, { x: 6, y: 10 }];
    this.spawnFood();
    this.registry.set('score', 0);
    this.registry.set('won', false);
    this.stepMs = Number(this.registry.get('jiaxiHarder') ?? 0) > 0 ? 90 : 120;
    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => this.onKey(e.key));
    this.add
      .text(12, 8, 'Snake · arrows · SPACE restart', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#94a3b8',
      })
      .setScrollFactor(0);
  }

  update(_t: number, delta: number): void {
    if (this.dead) return;
    this.accum += delta;
    if (this.accum < this.stepMs) return;
    this.accum = 0;
    this.dir = this.nextDir;
    const head = {
      x: this.body[0]!.x + this.dir.x,
      y: this.body[0]!.y + this.dir.y,
    };
    if (head.x < 0 || head.y < 0 || head.x >= COLS || head.y >= ROWS) {
      this.die();
      return;
    }
    if (this.body.some((s) => s.x === head.x && s.y === head.y)) {
      this.die();
      return;
    }
    this.body.unshift(head);
    if (head.x === this.food.x && head.y === this.food.y) {
      const mul = Number(this.registry.get('jiaxiScoreMul') ?? 1) || 1;
      this.score += mul;
      this.registry.set('score', this.score);
      playJuice(this, 'sfx_coin', 0.4);
      PlatformSceneHelper.burst(this, head.x * CELL, head.y * CELL, 0xf472b6, 8);
      this.spawnFood();
      if (this.score >= 12) {
        this.registry.set('won', true);
        playJuice(this, 'sfx_win', 0.55);
      }
    } else {
      this.body.pop();
    }
    this.draw();
  }

  private onKey(key: string): void {
    if (this.dead && (key === ' ' || key === 'Enter')) {
      this.scene.restart();
      return;
    }
    const flip = Boolean(this.registry.get('jiaxiGravityFlip'));
    if (key === 'ArrowUp' && this.dir.y === 0) this.nextDir = { x: 0, y: flip ? 1 : -1 };
    if (key === 'ArrowDown' && this.dir.y === 0) this.nextDir = { x: 0, y: flip ? -1 : 1 };
    if (key === 'ArrowLeft' && this.dir.x === 0) this.nextDir = { x: -1, y: 0 };
    if (key === 'ArrowRight' && this.dir.x === 0) this.nextDir = { x: 1, y: 0 };
  }

  private spawnFood(): void {
    do {
      this.food = {
        x: Phaser.Math.Between(0, COLS - 1),
        y: Phaser.Math.Between(0, ROWS - 1),
      };
    } while (this.body.some((s) => s.x === this.food.x && s.y === this.food.y));
  }

  private draw(): void {
    this.g.clear();
    const useItem = this.textures.exists('item');
    const usePlayer = this.textures.exists('player');
    for (const s of this.body) {
      if (usePlayer) {
        this.g.fillStyle(0x22c55e, 0.15);
        this.g.fillRect(s.x * CELL + 40, s.y * CELL + 40, CELL - 2, CELL - 2);
      } else {
        this.g.fillStyle(0x22c55e, 1);
        this.g.fillRect(s.x * CELL + 40, s.y * CELL + 40, CELL - 2, CELL - 2);
      }
    }
    if (useItem) {
      // food marker — tinted rect under item feel
      this.g.fillStyle(0xf472b6, 0.9);
    } else {
      this.g.fillStyle(0xf472b6, 1);
    }
    this.g.fillRect(
      this.food.x * CELL + 40,
      this.food.y * CELL + 40,
      CELL - 2,
      CELL - 2,
    );
  }

  private die(): void {
    this.dead = true;
    playJuice(this, 'sfx_lose', 0.55);
    PlatformSceneHelper.shake(this, 160, 0.01);
  }
}
`;
}

function flappySceneSource(): string {
  return `/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */
import Phaser from 'phaser';
import { PlatformSceneHelper } from '@opengame/module-platform';

${juiceHelpers()}

export class FlappyArcadeScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle;
  private velocity = 0;
  private readonly gravity = 1200;
  private readonly flap = -380;
  private pipes!: Phaser.GameObjects.Group;
  private spawnTimer = 0;
  private score = 0;
  private dead = false;

  constructor() {
    super({ key: 'FlappyArcadeScene' });
  }

  preload(): void {
    PlatformSceneHelper.preloadGameAudio(this);
    PlatformSceneHelper.preloadGameArt(this);
  }

  create(): void {
    PlatformSceneHelper.ensureBgm(this, 0.3);
    PlatformSceneHelper.installPauseMenu(this);
    if (!PlatformSceneHelper.addParallaxBackground(this, 'og_bg')) {
      this.cameras.main.setBackgroundColor(0x0ea5e9);
    }
    this.player = PlatformSceneHelper.spriteOrRect(
      this,
      120,
      360,
      'player',
      36,
      36,
      0xfbbf24,
    ) as Phaser.GameObjects.Rectangle;
    this.physics.add.existing(this.player);
    PlatformSceneHelper.syncBodyToDisplay(this.player, 36, 36);
    this.pipes = this.add.group();
    this.registry.set('score', 0);
    this.registry.set('won', false);
    this.input.on('pointerdown', () => this.flapImpulse());
    this.input.keyboard?.on('keydown-SPACE', () => this.flapImpulse());
    this.add
      .text(12, 8, 'Flappy · click/SPACE · restart after death', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#e2e8f0',
      })
      .setScrollFactor(0);
  }

  update(_t: number, delta: number): void {
    if (this.dead) return;
    const dt = delta / 1000;
    this.velocity += this.gravity * dt;
    this.player.y += this.velocity * dt;
    if (this.player.y > this.cameras.main.height - 18 || this.player.y < 18) {
      this.die();
      return;
    }
    this.spawnTimer += delta;
    const interval = Number(this.registry.get('spawnIntervalMs') ?? 1600);
    if (this.spawnTimer > interval) {
      this.spawnTimer = 0;
      this.spawnPipe();
    }
    for (const pipe of this.pipes.getChildren() as Array<
      Phaser.GameObjects.Rectangle | Phaser.GameObjects.Image
    >) {
      pipe.x -= 180 * dt;
      if (pipe.x < -40) pipe.destroy();
      if (
        this.intersects(
          this.player,
          pipe as Phaser.GameObjects.Rectangle,
        )
      ) {
        this.die();
        return;
      }
    }
    this.score += dt * 10;
    const s = Math.floor(this.score);
    if (s !== Number(this.registry.get('score') ?? 0)) {
      this.registry.set('score', s);
      if (s > 0 && s % 5 === 0) playJuice(this, 'sfx_coin', 0.25);
    }
    if (s >= 30) {
      this.registry.set('won', true);
      playJuice(this, 'sfx_win', 0.55);
    }
  }

  private flapImpulse(): void {
    if (this.dead) {
      this.scene.restart();
      return;
    }
    this.velocity = this.flap;
    playJuice(this, 'sfx_coin', 0.2);
  }

  private spawnPipe(): void {
    const gap = 180;
    const cy = Phaser.Math.Between(160, this.cameras.main.height - 160);
    const mk = (x: number, y: number) => {
      if (this.textures.exists('enemy')) {
        const img = this.add.image(x, y, 'enemy').setDisplaySize(60, 400);
        this.pipes.add(img);
        return;
      }
      const rect = this.add.rectangle(x, y, 60, 400, 0x10b981);
      this.pipes.add(rect);
    };
    mk(this.cameras.main.width + 40, cy - gap / 2 - 200);
    mk(this.cameras.main.width + 40, cy + gap / 2 + 200);
  }

  private intersects(
    a: Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle,
    b: Phaser.GameObjects.Rectangle,
  ): boolean {
    const ab = a.getBounds();
    const bb = b.getBounds();
    return Phaser.Geom.Intersects.RectangleToRectangle(ab, bb);
  }

  private die(): void {
    this.dead = true;
    playJuice(this, 'sfx_lose', 0.55);
    PlatformSceneHelper.shake(this, 180, 0.012);
  }
}
`;
}

function g2048SceneSource(): string {
  return `/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */
import Phaser from 'phaser';
import { PlatformSceneHelper } from '@opengame/module-platform';

${juiceHelpers()}

const SIZE = 4;
const TILE = 100;
const PAD = 12;
const OX = 40;
const OY = 80;

export class G2048ArcadeScene extends Phaser.Scene {
  private board: number[][] = [];
  private g!: Phaser.GameObjects.Graphics;
  private texts: Phaser.GameObjects.Text[][] = [];
  private score = 0;
  private dead = false;

  constructor() {
    super({ key: 'G2048ArcadeScene' });
  }

  preload(): void {
    PlatformSceneHelper.preloadGameAudio(this);
    PlatformSceneHelper.preloadGameArt(this);
  }

  create(): void {
    PlatformSceneHelper.ensureBgm(this, 0.25);
    PlatformSceneHelper.installPauseMenu(this);
    if (!PlatformSceneHelper.addParallaxBackground(this, 'og_bg')) {
      this.cameras.main.setBackgroundColor(0xfaf8ef);
    } else {
      // soft wash so tiles stay readable over cinematic bg
      this.add.rectangle(480, 270, 960, 540, 0xfaf8ef, 0.55).setScrollFactor(0);
    }
    this.g = this.add.graphics();
    this.board = Array.from({ length: SIZE }, () => Array<number>(SIZE).fill(0));
    this.texts = Array.from({ length: SIZE }, (_, r) =>
      Array.from({ length: SIZE }, (_, c) =>
        this.add
          .text(OX + c * (TILE + PAD) + TILE / 2, OY + r * (TILE + PAD) + TILE / 2, '', {
            fontFamily: 'monospace',
            fontSize: '28px',
            color: '#1f2937',
          })
          .setOrigin(0.5),
      ),
    );
    this.spawn();
    this.spawn();
    this.registry.set('score', 0);
    this.registry.set('won', false);
    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => this.onKey(e.key));
    this.add.text(12, 8, '2048 · arrows · SPACE restart', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#64748b',
    });
    this.draw();
  }

  private onKey(key: string): void {
    if (this.dead && (key === ' ' || key === 'Enter')) {
      this.scene.restart();
      return;
    }
    if (this.dead) return;
    const map: Record<string, string> = {
      ArrowLeft: 'L',
      ArrowRight: 'R',
      ArrowUp: 'U',
      ArrowDown: 'D',
    };
    const d = map[key];
    if (!d) return;
    if (this.slide(d)) {
      playJuice(this, 'sfx_coin', 0.3);
      this.spawn();
      this.registry.set('score', this.score);
      if (this.board.some((row) => row.some((v) => v >= 2048))) {
        this.registry.set('won', true);
        playJuice(this, 'sfx_win', 0.55);
        PlatformSceneHelper.burst(this, 240, 280, 0xedc22e, 16);
      } else if (!this.canMove()) {
        this.dead = true;
        playJuice(this, 'sfx_lose', 0.5);
      }
      this.draw();
    }
  }

  private spawn(): void {
    const empty: Array<{ r: number; c: number }> = [];
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (this.board[r]![c] === 0) empty.push({ r, c });
      }
    }
    if (!empty.length) return;
    const pick = empty[Phaser.Math.Between(0, empty.length - 1)]!;
    this.board[pick.r]![pick.c] = Math.random() < 0.9 ? 2 : 4;
  }

  private slide(dir: string): boolean {
    const before = JSON.stringify(this.board);
    const rot = dir === 'U' ? 3 : dir === 'D' ? 1 : dir === 'R' ? 2 : 0;
    for (let i = 0; i < rot; i++) this.rotateCW();
    for (let r = 0; r < SIZE; r++) {
      const line = this.board[r]!.filter((v) => v !== 0);
      const merged: number[] = [];
      for (let i = 0; i < line.length; i++) {
        if (i + 1 < line.length && line[i] === line[i + 1]) {
          const v = line[i]! * 2;
          merged.push(v);
          this.score += v;
          i++;
        } else {
          merged.push(line[i]!);
        }
      }
      while (merged.length < SIZE) merged.push(0);
      this.board[r] = merged;
    }
    for (let i = 0; i < (4 - rot) % 4; i++) this.rotateCW();
    return JSON.stringify(this.board) !== before;
  }

  private rotateCW(): void {
    const n = Array.from({ length: SIZE }, () => Array<number>(SIZE).fill(0));
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) n[c]![SIZE - 1 - r] = this.board[r]![c]!;
    }
    this.board = n;
  }

  private canMove(): boolean {
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
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const v = this.board[r]![c]!;
        const color =
          v === 0
            ? 0xcdc1b4
            : v <= 4
              ? 0xeee4da
              : v <= 16
                ? 0xf2b179
                : v <= 64
                  ? 0xf65e3b
                  : 0xedc22e;
        this.g.fillStyle(color, 1);
        this.g.fillRoundedRect(
          OX + c * (TILE + PAD),
          OY + r * (TILE + PAD),
          TILE,
          TILE,
          8,
        );
        this.texts[r]![c]!.setText(v ? String(v) : '');
      }
    }
  }
}
`;
}

function genericArcadeSource(): string {
  return `/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */
import Phaser from 'phaser';
import { PlatformSceneHelper } from '@opengame/module-platform';

${juiceHelpers()}

/** Generic grid_logic juice shell — SPACE to score, reach winAt. */
export class GridArcadeScene extends Phaser.Scene {
  private score = 0;

  constructor() {
    super({ key: 'GridArcadeScene' });
  }

  preload(): void {
    PlatformSceneHelper.preloadGameAudio(this);
    PlatformSceneHelper.preloadGameArt(this);
  }

  create(): void {
    PlatformSceneHelper.ensureBgm(this, 0.3);
    PlatformSceneHelper.installPauseMenu(this);
    if (!PlatformSceneHelper.addParallaxBackground(this, 'og_bg')) {
      this.cameras.main.setBackgroundColor(0x111827);
    }
    this.registry.set('score', 0);
    this.registry.set('won', false);
    const winAt = Number(this.registry.get('winScore') ?? 10);
    PlatformSceneHelper.spriteOrRect(this, 480, 320, 'player', 64, 64, 0x38bdf8);
    this.add
      .text(480, 200, 'SPACE to score', {
        fontFamily: 'monospace',
        fontSize: '28px',
        color: '#e2e8f0',
      })
      .setOrigin(0.5);
    this.input.keyboard?.on('keydown-SPACE', () => {
      this.score += 1;
      this.registry.set('score', this.score);
      playJuice(this, 'sfx_coin', 0.4);
      PlatformSceneHelper.burst(this, 480, 270, 0x38bdf8, 8);
      if (this.score >= winAt) {
        this.registry.set('won', true);
        playJuice(this, 'sfx_win', 0.55);
      }
    });
  }
}
`;
}

export interface GridArcadeSeedResult {
  readonly variant: ArcadeVariant;
  readonly sceneKey: string;
  readonly className: string;
  readonly written: string[];
}

export function leftoverSpaceShell(workspace: string): boolean {
  const arcade = path.join(workspace, 'src', 'scenes', 'GridArcadeScene.ts');
  if (!fs.existsSync(arcade)) return false;
  try {
    return /SPACE to score/.test(fs.readFileSync(arcade, 'utf8'));
  } catch {
    return false;
  }
}

export function workspaceLooksLikeBoardTurn(workspace: string): boolean {
  if (fs.existsSync(path.join(workspace, 'public', 'BOARD_KERNEL.json'))) {
    return true;
  }
  const spec = readMechanicSpec(workspace);
  if (spec?.arcadeVariant === 'board_turn' || spec?.boardKind) return true;
  const scene = path.join(workspace, 'src', 'scenes', 'BoardTurnScene.ts');
  if (!fs.existsSync(scene)) return false;
  try {
    const src = fs.readFileSync(scene, 'utf8');
    return /@opengame\/module-board|legalMoves/.test(src);
  } catch {
    return false;
  }
}

/**
 * Seed a playable grid carrier: arcade kernel or board-turn Scene.
 * Board games write BOARD_KERNEL.json and never ARCADE_KERNEL.json.
 */
export async function ensureGridArcadeKernel(
  workspace: string,
  prompt: string,
  mechanic?: {
    readonly arcadeVariant?: ArcadeVariant | string;
    readonly boardKind?: string;
  } | null,
): Promise<GridArcadeSeedResult> {
  const variant = (
    mechanic?.arcadeVariant &&
    ['snake', 'flappy', 'g2048', 'board_turn', 'match3', 'generic'].includes(
      mechanic.arcadeVariant,
    )
      ? mechanic.arcadeVariant
      : detectArcadeVariant(prompt)
  ) as ArcadeVariant;
  if (variant === 'board_turn') {
    return seedBoardTurn(workspace, prompt, mechanic?.boardKind);
  }
  if (variant === 'match3') {
    return seedMatch3(workspace);
  }

  const map = {
    snake: {
      className: 'SnakeArcadeScene',
      sceneKey: 'SnakeArcadeScene',
      file: 'SnakeArcadeScene.ts',
      source: snakeSceneSource(),
      title: 'Snake Juice',
    },
    flappy: {
      className: 'FlappyArcadeScene',
      sceneKey: 'FlappyArcadeScene',
      file: 'FlappyArcadeScene.ts',
      source: flappySceneSource(),
      title: 'Flappy Juice',
    },
    g2048: {
      className: 'G2048ArcadeScene',
      sceneKey: 'G2048ArcadeScene',
      file: 'G2048ArcadeScene.ts',
      source: g2048SceneSource(),
      title: '2048 Juice',
    },
    generic: {
      className: 'GridArcadeScene',
      sceneKey: 'GridArcadeScene',
      file: 'GridArcadeScene.ts',
      source: genericArcadeSource(),
      title: 'Arcade Juice',
    },
  } as const;
  const spec = map[variant];
  const written: string[] = [];
  const scenesDir = path.join(workspace, 'src', 'scenes');
  await fsp.mkdir(scenesDir, { recursive: true });
  const scenePath = path.join(scenesDir, spec.file);
  if (!fs.existsSync(scenePath)) {
    await fsp.writeFile(scenePath, spec.source, 'utf8');
    written.push(`scenes/${spec.file}`);
  }

  const leftoverBoard = path.join(scenesDir, 'BoardTurnScene.ts');
  if (fs.existsSync(leftoverBoard)) {
    await fsp.unlink(leftoverBoard).catch(() => undefined);
  }

  const mainPath = path.join(workspace, 'src', 'main.ts');
  const main = `/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */
import { bootstrap } from '@opengame/runtime/bootstrap';
import { ${spec.className} } from './scenes/${spec.className}.js';

await bootstrap({
  source: './game.json',
  extraScenes: [${spec.className}],
});
`;
  await fsp.writeFile(mainPath, main, 'utf8');
  written.push('src/main.ts');

  const publicDir = path.join(workspace, 'public');
  await fsp.mkdir(publicDir, { recursive: true });
  const gamePath = path.join(publicDir, 'game.json');
  let dsl: Record<string, unknown> = {
    dslVersion: '1.0.0',
    meta: {
      title: spec.title,
      canvas: { width: 960, height: 540, background: '#0f172a' },
    },
    initialSceneId: spec.sceneKey,
    scenes: [{ id: spec.sceneKey, entities: [], hud: { score: true } }],
    skills: [
      {
        id: 'score_space',
        trigger: { kind: 'onKey', key: 'SPACE' },
        effects: [{ kind: 'addScore', payload: { delta: 1, winAt: 10 } }],
      },
    ],
    tunables: {
      enemyCount: 3,
      spawnIntervalMs: variant === 'flappy' ? 1600 : 900,
      difficultyTier: 2,
      winScore: variant === 'g2048' ? 2048 : 10,
    },
    assets: juiceAssetSlots(),
    audioTracks: juiceAudioTracks(),
  };
  if (fs.existsSync(gamePath)) {
    try {
      const prev = JSON.parse(await fsp.readFile(gamePath, 'utf8')) as Record<
        string,
        unknown
      >;
      dsl = {
        ...prev,
        initialSceneId: spec.sceneKey,
        meta: {
          ...((prev['meta'] as object) ?? {}),
          title:
            (prev['meta'] as { title?: string } | undefined)?.title ?? spec.title,
        },
      };
    } catch {
      /* use fresh */
    }
  }
  await fsp.writeFile(gamePath, JSON.stringify(dsl, null, 2), 'utf8');
  written.push('public/game.json');

  await fsp.writeFile(
    path.join(publicDir, 'ARCADE_KERNEL.json'),
    JSON.stringify(
      {
        schema: 'opengame-arcade-kernel-v1',
        variant,
        sceneKey: spec.sceneKey,
        className: spec.className,
        at: new Date().toISOString(),
      },
      null,
      2,
    ),
    'utf8',
  );
  written.push('public/ARCADE_KERNEL.json');
  const leftoverBoardKernel = path.join(publicDir, 'BOARD_KERNEL.json');
  if (fs.existsSync(leftoverBoardKernel)) {
    await fsp.unlink(leftoverBoardKernel).catch(() => undefined);
  }

  return {
    variant,
    sceneKey: spec.sceneKey,
    className: spec.className,
    written,
  };
}

async function seedBoardTurn(
  workspace: string,
  prompt: string,
  boardKind?: string,
): Promise<GridArcadeSeedResult> {
  const kind = (boardKind as ReturnType<typeof detectBoardKind>) ??
    detectBoardKind(prompt) ??
    'generic';
  const className = 'BoardTurnScene';
  const sceneKey = 'BoardTurnScene';
  const written: string[] = [];
  const scenesDir = path.join(workspace, 'src', 'scenes');
  await fsp.mkdir(scenesDir, { recursive: true });
  await fsp.writeFile(
    path.join(scenesDir, 'BoardTurnScene.ts'),
    boardTurnSceneSource(kind),
    'utf8',
  );
  written.push('scenes/BoardTurnScene.ts');

  const leftoverSpace = path.join(scenesDir, 'GridArcadeScene.ts');
  if (fs.existsSync(leftoverSpace)) {
    await fsp.unlink(leftoverSpace).catch(() => undefined);
  }

  const main = `/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */
import { bootstrap } from '@opengame/runtime/bootstrap';
import { BoardTurnScene } from './scenes/BoardTurnScene.js';

await bootstrap({
  source: './game.json',
  extraScenes: [BoardTurnScene],
});
`;
  await fsp.writeFile(path.join(workspace, 'src', 'main.ts'), main, 'utf8');
  written.push('src/main.ts');

  const publicDir = path.join(workspace, 'public');
  await fsp.mkdir(publicDir, { recursive: true });
  const gamePath = path.join(publicDir, 'game.json');
  let dsl: Record<string, unknown> = {
    dslVersion: '1.0.0',
    meta: {
      title: kind === 'xiangqi' ? '中国象棋' : kind === 'chess' ? 'Chess' : 'Board',
      canvas: { width: 960, height: 540, background: '#1c1917' },
    },
    initialSceneId: sceneKey,
    scenes: [{ id: sceneKey, entities: [], hud: { score: true } }],
    tunables: {
      enemyCount: 0,
      spawnIntervalMs: 0,
      difficultyTier: 1,
      winScore: 0,
    },
    assets: juiceAssetSlots(),
    audioTracks: juiceAudioTracks(),
  };
  if (fs.existsSync(gamePath)) {
    try {
      const prev = JSON.parse(await fsp.readFile(gamePath, 'utf8')) as Record<
        string,
        unknown
      >;
      const { skills: _dropSkills, ...rest } = prev;
      dsl = {
        ...rest,
        initialSceneId: sceneKey,
        scenes: [{ id: sceneKey, entities: [], hud: { score: true } }],
        meta: {
          ...((prev['meta'] as object) ?? {}),
          title:
            (prev['meta'] as { title?: string } | undefined)?.title ??
            (dsl.meta as { title: string }).title,
        },
      };
      delete dsl['skills'];
    } catch {
      /* use fresh */
    }
  }
  await fsp.writeFile(gamePath, JSON.stringify(dsl, null, 2), 'utf8');
  written.push('public/game.json');

  await fsp.writeFile(
    path.join(publicDir, 'BOARD_KERNEL.json'),
    JSON.stringify(
      {
        schema: 'opengame-board-kernel-v1',
        kind,
        sceneKey,
        className,
        at: new Date().toISOString(),
      },
      null,
      2,
    ),
    'utf8',
  );
  written.push('public/BOARD_KERNEL.json');
  const leftoverArcade = path.join(publicDir, 'ARCADE_KERNEL.json');
  if (fs.existsSync(leftoverArcade)) {
    await fsp.unlink(leftoverArcade).catch(() => undefined);
  }

  return { variant: 'board_turn', sceneKey, className, written };
}

async function seedMatch3(workspace: string): Promise<GridArcadeSeedResult> {
  const className = 'Match3Scene';
  const sceneKey = 'Match3Scene';
  const written: string[] = [];
  const scenesDir = path.join(workspace, 'src', 'scenes');
  await fsp.mkdir(scenesDir, { recursive: true });
  await fsp.writeFile(path.join(scenesDir, 'Match3Scene.ts'), match3SceneSource(), 'utf8');
  written.push('scenes/Match3Scene.ts');

  const leftoverSpace = path.join(scenesDir, 'GridArcadeScene.ts');
  if (fs.existsSync(leftoverSpace)) {
    await fsp.unlink(leftoverSpace).catch(() => undefined);
  }

  const main = `/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */
import { bootstrap } from '@opengame/runtime/bootstrap';
import { Match3Scene } from './scenes/Match3Scene.js';

await bootstrap({
  source: './game.json',
  extraScenes: [Match3Scene],
});
`;
  await fsp.writeFile(path.join(workspace, 'src', 'main.ts'), main, 'utf8');
  written.push('src/main.ts');

  const publicDir = path.join(workspace, 'public');
  await fsp.mkdir(publicDir, { recursive: true });
  const gamePath = path.join(publicDir, 'game.json');
  let dsl: Record<string, unknown> = {
    dslVersion: '1.0.0',
    meta: {
      title: 'Match-3',
      canvas: { width: 960, height: 540, background: '#1e1b4b' },
    },
    initialSceneId: sceneKey,
    scenes: [{ id: sceneKey, entities: [], hud: { score: true } }],
    tunables: {
      enemyCount: 0,
      spawnIntervalMs: 0,
      difficultyTier: 1,
      winScore: 24,
    },
    assets: juiceAssetSlots(),
    audioTracks: juiceAudioTracks(),
  };
  if (fs.existsSync(gamePath)) {
    try {
      const prev = JSON.parse(await fsp.readFile(gamePath, 'utf8')) as Record<
        string,
        unknown
      >;
      const { skills: _dropSkills, ...rest } = prev;
      dsl = {
        ...rest,
        initialSceneId: sceneKey,
        scenes: [{ id: sceneKey, entities: [], hud: { score: true } }],
        meta: {
          ...((prev['meta'] as object) ?? {}),
          title:
            (prev['meta'] as { title?: string } | undefined)?.title ?? 'Match-3',
        },
      };
      delete dsl['skills'];
    } catch {
      /* use fresh */
    }
  }
  await fsp.writeFile(gamePath, JSON.stringify(dsl, null, 2), 'utf8');
  written.push('public/game.json');

  await fsp.writeFile(
    path.join(publicDir, 'MATCH_KERNEL.json'),
    JSON.stringify(
      {
        schema: 'opengame-match-kernel-v1',
        sceneKey,
        className,
        at: new Date().toISOString(),
      },
      null,
      2,
    ),
    'utf8',
  );
  written.push('public/MATCH_KERNEL.json');
  const leftoverArcade = path.join(publicDir, 'ARCADE_KERNEL.json');
  if (fs.existsSync(leftoverArcade)) {
    await fsp.unlink(leftoverArcade).catch(() => undefined);
  }

  return { variant: 'match3', sceneKey, className, written };
}

function juiceAssetSlots(): Array<Record<string, unknown>> {
  return [
    { id: 'player', kind: 'image', url: './assets/player.png' },
    { id: 'player_run', kind: 'image', url: './assets/player_run.png' },
    { id: 'background', kind: 'image', url: './assets/background.png' },
    { id: 'enemy', kind: 'image', url: './assets/enemy.png' },
    { id: 'item', kind: 'image', url: './assets/item.png' },
    { id: 'bgm', kind: 'audio', url: './assets/bgm.mp3' },
    { id: 'sfx_win', kind: 'audio', url: './assets/sfx_win.mp3' },
    { id: 'sfx_lose', kind: 'audio', url: './assets/sfx_lose.mp3' },
    { id: 'sfx_coin', kind: 'audio', url: './assets/sfx_win.mp3' },
  ];
}

function juiceAudioTracks(): Array<Record<string, unknown>> {
  return [
    { assetId: 'bgm', role: 'bgm', loop: true, volume: 0.4 },
    { assetId: 'sfx_win', role: 'sfx', loop: false },
    { assetId: 'sfx_lose', role: 'sfx', loop: false },
    { assetId: 'sfx_coin', role: 'sfx', loop: false },
  ];
}
