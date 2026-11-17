/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { createDungeonWorld } from '@opengame/world-spec';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runWorldGameSeedPhase } from './worldGameSeedPhase.js';
import { runWorldLineageGate } from './worldLineageGate.js';

let workspace: string;

beforeEach(async () => {
  workspace = await fsp.mkdtemp(path.join(os.tmpdir(), 'og-lineage-'));
  await fsp.mkdir(path.join(workspace, 'public'), { recursive: true });
});

afterEach(async () => {
  await fsp.rm(workspace, { recursive: true, force: true });
  delete process.env['PLATFORM_WORLD_LINEAGE_GATE'];
});

async function seed(): Promise<void> {
  await runWorldGameSeedPhase({
    workspace,
    world: createDungeonWorld({ id: 'w_lineage' }),
    isIteration: false,
  });
}

async function readGame(): Promise<Record<string, unknown>> {
  return JSON.parse(
    await fsp.readFile(path.join(workspace, 'public', 'game.json'), 'utf8'),
  ) as Record<string, unknown>;
}

async function writeGame(dsl: Record<string, unknown>): Promise<void> {
  await fsp.writeFile(
    path.join(workspace, 'public', 'game.json'),
    JSON.stringify(dsl, null, 2),
    'utf8',
  );
}

describe('runWorldLineageGate', () => {
  it('passes on the freshly compiled world and writes the report', async () => {
    await seed();
    const result = await runWorldLineageGate(workspace);

    expect(result.enforced).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.scenes.missing).toEqual([]);
    expect(result.quests.missing).toEqual([]);
    expect(result.portals.ratio).toBe(1);

    const report = JSON.parse(
      await fsp.readFile(path.join(workspace, 'public', 'WORLD_LINEAGE.json'), 'utf8'),
    ) as { ok: boolean; worldTitle: string };
    expect(report.ok).toBe(true);
    expect(report.worldTitle).toBe('Forgotten Dungeon');
  });

  it('fails when the agent drops a region scene', async () => {
    await seed();
    const game = await readGame();
    const scenes = (game['scenes'] as Array<Record<string, unknown>>).filter(
      (s) => s['id'] !== 'boss_lair',
    );
    await writeGame({ ...game, scenes });

    const result = await runWorldLineageGate(workspace);
    expect(result.ok).toBe(false);
    expect(result.scenes.missing).toContain('boss_lair');
    expect(result.issues.join('\n')).toContain('boss_lair');
  });

  it('fails when quest ids disappear', async () => {
    await seed();
    const game = await readGame();
    // Dialogue holds the quest log; rule skills reference quest ids too.
    await writeGame({ ...game, dialogue: [], skills: [] });

    const result = await runWorldLineageGate(workspace);
    expect(result.ok).toBe(false);
    expect(result.quests.missing).toContain('q_claim_key');
  });

  it('accepts quest ids that moved into TypeScript scenes', async () => {
    await seed();
    const game = await readGame();
    await writeGame({ ...game, dialogue: [], skills: [] });
    await fsp.mkdir(path.join(workspace, 'src', 'scenes'), { recursive: true });
    await fsp.writeFile(
      path.join(workspace, 'src', 'scenes', 'QuestScene.ts'),
      `export const ACTIVE_QUEST = 'q_claim_key';\n`,
      'utf8',
    );

    const result = await runWorldLineageGate(workspace);
    expect(result.quests.missing).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('skips projects without a compiled world', async () => {
    await writeGame({
      dslVersion: '1.0.0',
      meta: { title: 'plain game' },
      scenes: [{ id: 'level_1', entities: [] }],
    });
    const result = await runWorldLineageGate(workspace);
    expect(result.enforced).toBe(false);
    expect(result.ok).toBe(true);
  });

  it('can be turned off by env', async () => {
    await seed();
    process.env['PLATFORM_WORLD_LINEAGE_GATE'] = 'false';
    const result = await runWorldLineageGate(workspace);
    expect(result.enforced).toBe(false);
    expect(result.reason).toContain('PLATFORM_WORLD_LINEAGE_GATE');
  });
});
