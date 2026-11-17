/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { createDungeonWorld } from '@opengame/world-spec';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  formatWorldSeedForCoder,
  readWorldSeedRecord,
  runWorldGameSeedPhase,
} from './worldGameSeedPhase.js';

let workspace: string;

beforeEach(async () => {
  workspace = await fsp.mkdtemp(path.join(os.tmpdir(), 'og-world-seed-'));
  await fsp.mkdir(path.join(workspace, 'public'), { recursive: true });
});

afterEach(async () => {
  await fsp.rm(workspace, { recursive: true, force: true });
  delete process.env['PLATFORM_WORLD_SEED'];
  delete process.env['PLATFORM_WORLD_SEED_PREFILL_ON_ITERATION'];
});

async function readJson(rel: string): Promise<Record<string, unknown>> {
  return JSON.parse(
    await fsp.readFile(path.join(workspace, rel), 'utf8'),
  ) as Record<string, unknown>;
}

describe('runWorldGameSeedPhase', () => {
  it('prefills game.json, WORLD_SEED.json and the typed world module', async () => {
    const world = createDungeonWorld({ id: 'w_seed' });
    const result = await runWorldGameSeedPhase({
      workspace,
      world,
      isIteration: false,
    });

    expect(result.applied).toBe(true);
    expect(result.gamePrefilled).toBe(true);
    expect(result.files).toContain('public/game.json');
    expect(result.files).toContain('public/WORLD_SEED.json');
    expect(result.files).toContain('src/world/worldSeed.ts');

    const game = await readJson('public/game.json');
    expect(game['initialSceneId']).toBe('dungeon_hall');
    expect(Array.isArray(game['scenes'])).toBe(true);

    const record = await readWorldSeedRecord(workspace);
    expect(record?.gamePrefilled).toBe(true);
    expect(record?.lineage.regionIds).toEqual(
      world.space.regions.map((r) => r.id),
    );

    const module = await fsp.readFile(
      path.join(workspace, 'src', 'world', 'worldSeed.ts'),
      'utf8',
    );
    expect(module).toContain('export const WORLD_REGION_IDS');
    expect(module).toContain('dungeon_hall');
  });

  it('keeps MiniMax assets when overwriting game.json', async () => {
    await fsp.writeFile(
      path.join(workspace, 'public', 'game.json'),
      JSON.stringify({
        dslVersion: '1.0.0',
        meta: { title: 'stale' },
        scenes: [{ id: 'old', entities: [] }],
        assets: [{ id: 'player', kind: 'image', url: './assets/player.png' }],
        audioTracks: [{ id: 'bgm', assetId: 'bgm', role: 'bgm', loop: true }],
      }),
      'utf8',
    );

    await runWorldGameSeedPhase({
      workspace,
      world: createDungeonWorld({ id: 'w_assets' }),
      isIteration: false,
    });

    const game = await readJson('public/game.json');
    expect(game['assets']).toEqual([
      { id: 'player', kind: 'image', url: './assets/player.png' },
    ]);
    expect(game['audioTracks']).toHaveLength(1);
    expect(game['meta']).toMatchObject({ title: 'Forgotten Dungeon' });
  });

  it('does not overwrite a polished game on iteration', async () => {
    const polished = {
      dslVersion: '1.0.0',
      meta: { title: 'Hand polished' },
      scenes: [{ id: 'level_1', entities: [] }],
    };
    await fsp.writeFile(
      path.join(workspace, 'public', 'game.json'),
      JSON.stringify(polished),
      'utf8',
    );

    const result = await runWorldGameSeedPhase({
      workspace,
      world: createDungeonWorld({ id: 'w_iter' }),
      isIteration: true,
    });

    expect(result.applied).toBe(true);
    expect(result.gamePrefilled).toBe(false);
    expect(await readJson('public/game.json')).toEqual(polished);
    expect(fs.existsSync(path.join(workspace, 'public', 'WORLD_SEED.json'))).toBe(
      true,
    );
  });

  it('honours PLATFORM_WORLD_SEED=false', async () => {
    process.env['PLATFORM_WORLD_SEED'] = 'false';
    const result = await runWorldGameSeedPhase({
      workspace,
      world: createDungeonWorld({ id: 'w_off' }),
      isIteration: false,
    });
    expect(result.applied).toBe(false);
    expect(result.reason).toContain('PLATFORM_WORLD_SEED');
    expect(fs.existsSync(path.join(workspace, 'public', 'WORLD_SEED.json'))).toBe(
      false,
    );
  });

  it('tells the Coder to extend rather than rewrite', async () => {
    const result = await runWorldGameSeedPhase({
      workspace,
      world: createDungeonWorld({ id: 'w_prompt' }),
      isIteration: false,
      compile: { tunables: { enemySpeed: 70 }, tunablesSource: 'l2-test' },
    });
    const prompt = formatWorldSeedForCoder(result.seed!);
    expect(prompt).toContain('禁止拆掉');
    expect(prompt).toContain('增量补写');
    expect(prompt).toContain('dungeon_hall');
    expect(prompt).toContain('enemySpeed=70');
    expect(prompt).toContain('l2-test');
  });
});
