/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  detectArcadeVariant,
  ensureGridArcadeKernel,
} from './gridArcadeKernels.js';
import {
  writeJuiceBaseline,
  issuesFromJuiceBaseline,
  scanJuiceScenes,
} from './juiceBaseline.js';

describe('gridArcadeKernels', () => {
  it('detects snake/flappy/2048', () => {
    expect(detectArcadeVariant('做个贪吃蛇')).toBe('snake');
    expect(detectArcadeVariant('flappy bird tap')).toBe('flappy');
    expect(detectArcadeVariant('2048 合并数字')).toBe('g2048');
  });

  it('detects 中国象棋 and English chess as board_turn, not generic SPACE', () => {
    expect(detectArcadeVariant('做个中国象棋，双人本地，点选，将死')).toBe(
      'board_turn',
    );
    expect(detectArcadeVariant('make a chess game')).toBe('board_turn');
    expect(detectArcadeVariant('五子棋')).toBe('board_turn');
  });

  it('seeds snake juice kernel files', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-arcade-'));
    const seeded = await ensureGridArcadeKernel(dir, '做一个贪吃蛇');
    expect(seeded.variant).toBe('snake');
    expect(
      fs.existsSync(path.join(dir, 'src', 'scenes', 'SnakeArcadeScene.ts')),
    ).toBe(true);
    expect(fs.existsSync(path.join(dir, 'src', 'main.ts'))).toBe(true);
    const src = fs.readFileSync(
      path.join(dir, 'src', 'scenes', 'SnakeArcadeScene.ts'),
      'utf8',
    );
    expect(src).toContain('PlatformSceneHelper');
    expect(src).toContain('preloadGameArt');
    expect(src).toContain('sfx_coin');
    const game = JSON.parse(
      fs.readFileSync(path.join(dir, 'public', 'game.json'), 'utf8'),
    ) as { assets: Array<{ id: string }> };
    expect(game.assets.some((a) => a.id === 'player')).toBe(true);
    expect(game.assets.some((a) => a.id === 'background')).toBe(true);
  });

  it('seeds a board-turn carrier without ARCADE_KERNEL or SPACE shell', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-board-'));
    const seeded = await ensureGridArcadeKernel(
      dir,
      '做个中国象棋，双人本地，点选，将死',
    );
    expect(seeded.variant).toBe('board_turn');
    expect(seeded.className).toBe('BoardTurnScene');
    expect(fs.existsSync(path.join(dir, 'src', 'scenes', 'BoardTurnScene.ts'))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(dir, 'src', 'scenes', 'GridArcadeScene.ts'))).toBe(
      false,
    );
    expect(fs.existsSync(path.join(dir, 'public', 'BOARD_KERNEL.json'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'public', 'ARCADE_KERNEL.json'))).toBe(false);
    const src = fs.readFileSync(
      path.join(dir, 'src', 'scenes', 'BoardTurnScene.ts'),
      'utf8',
    );
    expect(src).toContain('@opengame/module-board');
    expect(src).toContain('legalMoves');
    expect(src).toContain("rulesForBoardKind('xiangqi')");
    expect(src).not.toContain('SPACE to score');
    const game = JSON.parse(
      fs.readFileSync(path.join(dir, 'public', 'game.json'), 'utf8'),
    ) as { skills?: unknown[]; initialSceneId?: string };
    expect(game.skills ?? []).toEqual([]);
    expect(game.initialSceneId).toBe('BoardTurnScene');
    const main = fs.readFileSync(path.join(dir, 'src', 'main.ts'), 'utf8');
    expect(main).toContain('BoardTurnScene');
  });

  it('seeds Match3Scene instead of a SPACE arcade shell', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-match3-'));
    const seeded = await ensureGridArcadeKernel(dir, '做一个消消乐，三消计分');
    expect(seeded.variant).toBe('match3');
    expect(seeded.className).toBe('Match3Scene');
    expect(fs.existsSync(path.join(dir, 'src', 'scenes', 'Match3Scene.ts'))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(dir, 'src', 'scenes', 'GridArcadeScene.ts'))).toBe(
      false,
    );
    expect(fs.existsSync(path.join(dir, 'public', 'MATCH_KERNEL.json'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'public', 'ARCADE_KERNEL.json'))).toBe(false);
    const src = fs.readFileSync(
      path.join(dir, 'src', 'scenes', 'Match3Scene.ts'),
      'utf8',
    );
    expect(src).toContain('Match3Rules');
    expect(src).not.toContain('SPACE to score');
  });

  it('seeds from MechanicSpec.arcadeVariant even if the leftover prompt is noisy', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-spec-seed-'));
    const seeded = await ensureGridArcadeKernel(dir, '随便写点字还有贪吃蛇', {
      arcadeVariant: 'board_turn',
      boardKind: 'xiangqi',
    });
    expect(seeded.variant).toBe('board_turn');
    expect(fs.existsSync(path.join(dir, 'public', 'BOARD_KERNEL.json'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'public', 'ARCADE_KERNEL.json'))).toBe(false);
  });

  it('does not turn snake into a board carrier', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-snake-safe-'));
    const seeded = await ensureGridArcadeKernel(dir, '做一个贪吃蛇');
    expect(seeded.variant).toBe('snake');
    expect(fs.existsSync(path.join(dir, 'src', 'scenes', 'SnakeArcadeScene.ts'))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(dir, 'public', 'BOARD_KERNEL.json'))).toBe(false);
  });
});

describe('juiceBaseline', () => {
  it('flags regression when juice scene is stripped', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-juice-'));
    const scenes = path.join(dir, 'src', 'scenes');
    fs.mkdirSync(scenes, { recursive: true });
    fs.writeFileSync(
      path.join(scenes, 'Level1Scene.ts'),
      `import { PlatformSceneHelper } from '@opengame/module-platform';
export class Level1Scene { create(){ PlatformSceneHelper.playSfx(this as never,'sfx_win'); } }`,
      'utf8',
    );
    const baseline = await writeJuiceBaseline(dir);
    expect(baseline?.scenes).toContain('Level1Scene.ts');
    expect(await scanJuiceScenes(dir)).toHaveLength(1);
    fs.writeFileSync(
      path.join(scenes, 'Level1Scene.ts'),
      'export class Level1Scene { create(){ /* stripped */ } }',
      'utf8',
    );
    const issues = await issuesFromJuiceBaseline(dir);
    expect(issues.some((i) => i.includes('Juice 硬锁'))).toBe(true);
  });
});
