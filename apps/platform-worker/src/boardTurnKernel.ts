/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Board-turn carrier source. Scene only presents; rules come from
 * @opengame/module-board. Not a finished chess product.
 */

import type { BoardKind } from './mechanicSpec.js';

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
`.trim();
}

export function boardTurnSceneSource(kind: BoardKind): string {
  const tableHint =
    kind === 'xiangqi'
      ? '// XiangqiRules 9×10 将死 — import @opengame/module-board'
      : kind === 'gomoku'
        ? '// GomokuRules five — import @opengame/module-board'
        : kind === 'chess'
          ? '// ChessRules — import @opengame/module-board'
          : '// generic board — import @opengame/module-board';
  return `/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Board-turn carrier — juice + click/select/move + registry.won.
 * Rules come from @opengame/module-board. Replace only presentation, not SPACE scoring.
 */
import Phaser from 'phaser';
import { PlatformSceneHelper } from '@opengame/module-platform';
import {
  otherSide,
  pieceAt,
  rulesForBoardKind,
  type BoardState,
  type Cell,
} from '@opengame/module-board';

${juiceHelpers()}

${tableHint}
const RULES = rulesForBoardKind('${kind}');
const ORIGIN_X = 48;
const ORIGIN_Y = 36;

export class BoardTurnScene extends Phaser.Scene {
  private board = RULES.initial();
  private selected: Cell | null = null;
  private g!: Phaser.GameObjects.Graphics;
  private labels: Phaser.GameObjects.Text[] = [];
  private status!: Phaser.GameObjects.Text;
  private moves = 0;
  private cell = 36;

  constructor() {
    super({ key: 'BoardTurnScene' });
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
    this.cell = Math.max(
      22,
      Math.min(
        48,
        Math.floor(Math.min((920 - 80) / RULES.cols, (500 - 80) / RULES.rows)),
      ),
    );
    this.g = this.add.graphics();
    this.status = this.add
      .text(12, 8, '', {
        fontFamily: 'sans-serif',
        fontSize: '16px',
        color: '#fef3c7',
      })
      .setScrollFactor(0);
    this.registry.set('score', 0);
    this.registry.set('won', false);
    this.registry.set('turn', this.board.turn);
    this.applyJiaxiHandicap();
    this.game.events.on('opengame:jiaxi', () => this.applyJiaxiHandicap());
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.onTap(p.worldX, p.worldY));
    this.redraw();
  }

  private applyJiaxiHandicap(): void {
    while (consumeJiaxi(this, 'jiaxiBoardHandicap')) {
      const victim = otherSide(this.board.turn);
      const piece = [...this.board.pieces]
        .reverse()
        .find((p) => p.side === victim && !/general|king/i.test(p.kind));
      if (!piece) break;
      this.board = {
        ...this.board,
        pieces: this.board.pieces.filter((p) => p.id !== piece.id),
      };
    }
    this.redraw();
  }

  private cellAt(x: number, y: number): Cell | null {
    const col = Math.floor((x - ORIGIN_X) / this.cell);
    const row = Math.floor((y - ORIGIN_Y) / this.cell);
    if (col < 0 || row < 0 || col >= RULES.cols || row >= RULES.rows) return null;
    return { col, row };
  }

  private onTap(x: number, y: number): void {
    if (this.board.winner) return;
    const cell = this.cellAt(x, y);
    if (!cell) return;
    const legal = RULES.legalMoves(this.board, this.selected ?? undefined);
    const hit = legal.find((m) => m.to.col === cell.col && m.to.row === cell.row);
    if (this.selected && hit) {
      const prevTurn = this.board.turn;
      const next = RULES.applyMove(this.board, hit);
      if (next === this.board) return;
      this.board =
        !next.winner && next.turn !== prevTurn && consumeJiaxi(this, 'jiaxiBoardExtraMove')
          ? { ...next, turn: prevTurn }
          : next;
      this.selected = null;
      this.moves += 1;
      this.registry.set('score', this.moves);
      this.registry.set('turn', this.board.turn);
      playJuice(this, 'sfx_coin', 0.35);
      if (this.board.winner) {
        this.registry.set('won', true);
        playJuice(this, 'sfx_win', 0.55);
      }
      this.redraw();
      return;
    }
    const piece = pieceAt(this.board, cell.col, cell.row);
    if (piece && piece.side === this.board.turn) {
      this.selected = cell;
      this.redraw();
    } else if (!piece && RULES.id === 'gomoku') {
      const placed = RULES.applyMove(this.board, { to: cell });
      if (placed !== this.board) {
        const prevTurn = this.board.turn;
        this.board =
          !placed.winner && placed.turn !== prevTurn && consumeJiaxi(this, 'jiaxiBoardExtraMove')
            ? { ...placed, turn: prevTurn }
            : placed;
        this.moves += 1;
        this.registry.set('score', this.moves);
        this.registry.set('turn', this.board.turn);
        playJuice(this, 'sfx_coin', 0.35);
        if (this.board.winner) {
          this.registry.set('won', true);
          playJuice(this, 'sfx_win', 0.55);
        }
        this.redraw();
      }
    } else {
      this.selected = null;
      this.redraw();
    }
  }

  private redraw(): void {
    this.g.clear();
    for (const t of this.labels) t.destroy();
    this.labels = [];
    for (let r = 0; r < RULES.rows; r += 1) {
      for (let c = 0; c < RULES.cols; c += 1) {
        const x = ORIGIN_X + c * this.cell;
        const y = ORIGIN_Y + r * this.cell;
        const dark = (c + r) % 2 === 0;
        this.g.fillStyle(dark ? 0x44403c : 0x78716c, 1);
        this.g.fillRect(x, y, this.cell, this.cell);
      }
    }
    if (this.selected) {
      this.g.lineStyle(2, 0xfacc15, 1);
      this.g.strokeRect(
        ORIGIN_X + this.selected.col * this.cell,
        ORIGIN_Y + this.selected.row * this.cell,
        this.cell,
        this.cell,
      );
      for (const m of RULES.legalMoves(this.board, this.selected)) {
        this.g.fillStyle(0x22c55e, 0.28);
        this.g.fillRect(
          ORIGIN_X + m.to.col * this.cell,
          ORIGIN_Y + m.to.row * this.cell,
          this.cell,
          this.cell,
        );
      }
    }
    for (const p of this.board.pieces) {
      const cx = ORIGIN_X + p.col * this.cell + this.cell / 2;
      const cy = ORIGIN_Y + p.row * this.cell + this.cell / 2;
      this.g.fillStyle(p.side === 'red' ? 0xb91c1c : 0x111827, 1);
      this.g.fillCircle(cx, cy, this.cell * 0.36);
      const label = this.add
        .text(cx, cy, p.kind, {
          fontFamily: 'sans-serif',
          fontSize: \`\${Math.max(10, Math.floor(this.cell * 0.38))}px\`,
          color: '#fefce8',
        })
        .setOrigin(0.5);
      this.labels.push(label);
    }
    const w = this.board.winner;
    this.status.setText(
      w
        ? \`\${w === 'draw' ? '和棋' : w + ' 胜'} · 将死/五连即胜\`
        : \`\${this.board.turn} 走 · 点选 · \${RULES.id}\`,
    );
  }
}
`;
}
