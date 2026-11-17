/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  detectExtraScenesBootMismatch,
  detectFragileRestartAndDeath,
  healExtraScenesGameJsonWiring,
  parseExtraScenesFromMain,
} from './gameQualityArchetype.js';

describe('detectExtraScenesBootMismatch', () => {
  it('rejects DSL stub main when no customModule scenes', () => {
    const issues = detectExtraScenesBootMismatch({
      scenes: [
        {
          id: 'main',
          hud: { score: true },
          entities: [
            {
              id: 'title',
              sprite: { shape: 'rect', color: '#6366f1', width: 200, height: 60 },
            },
          ],
        },
      ],
    });
    expect(issues.some((i) => /customModule|占位/i.test(i))).toBe(true);
  });

  it('rejects initialSceneId that is not a customModule scene', () => {
    const issues = detectExtraScenesBootMismatch({
      initialSceneId: 'main',
      scenes: [
        { id: 'main', entities: [] },
        { id: 'TitleScene', customModule: 'TitleScene', entities: [] },
      ],
    });
    expect(issues.some((i) => /启动场景/.test(i))).toBe(true);
  });

  it('accepts TitleScene boot with customModule wiring', () => {
    const issues = detectExtraScenesBootMismatch({
      initialSceneId: 'TitleScene',
      scenes: [
        { id: 'TitleScene', customModule: 'TitleScene', entities: [] },
        { id: 'LevelScene', customModule: 'LevelScene', entities: [] },
      ],
    });
    expect(issues).toEqual([]);
  });
});

describe('healExtraScenesGameJsonWiring', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    for (const d of dirs.splice(0)) {
      await fsp.rm(d, { recursive: true, force: true });
    }
  });

  it('parses extraScenes class list from main.ts', () => {
    expect(
      parseExtraScenesFromMain(
        `await bootstrap({ source: './game.json', extraScenes: [TitleScene, WorldScene, VictoryScene] });`,
      ),
    ).toEqual(['TitleScene', 'WorldScene', 'VictoryScene']);
  });

  it('rewires region DSL stubs to match main.ts extraScenes (real failure shape)', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'og-extrascenes-'));
    dirs.push(root);
    await fsp.mkdir(path.join(root, 'src'), { recursive: true });
    await fsp.mkdir(path.join(root, 'public'), { recursive: true });
    await fsp.writeFile(
      path.join(root, 'src', 'main.ts'),
      `import { bootstrap } from '@opengame/runtime';
import { TitleScene } from './scenes/TitleScene';
import { WorldScene } from './scenes/WorldScene';
import { VictoryScene } from './scenes/VictoryScene';
await bootstrap({ source: './game.json', extraScenes: [TitleScene, WorldScene, VictoryScene] });
`,
      'utf8',
    );
    await fsp.writeFile(
      path.join(root, 'public', 'game.json'),
      `${JSON.stringify(
        {
          dslVersion: '1.0.0',
          meta: { title: 'RPG', canvas: { width: 960, height: 540 } },
          initialSceneId: 'town_square',
          scenes: [
            {
              id: 'town_square',
              entities: [
                {
                  id: 'npc_smith',
                  tags: ['npc'],
                  sprite: { x: 120, y: 200 },
                },
              ],
            },
            { id: 'forest', entities: [{ id: 'wolf', tags: ['enemy'], sprite: { x: 400, y: 300 } }] },
            { id: 'mine', entities: [] },
          ],
          assets: [{ id: 'player', kind: 'image', url: 'assets/player.png' }],
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    const result = await healExtraScenesGameJsonWiring(root);
    expect(result.healed).toBe(true);
    expect(result.scenes).toEqual(['TitleScene', 'WorldScene', 'VictoryScene']);
    expect(result.initialSceneId).toBe('TitleScene');

    const dsl = JSON.parse(
      await fsp.readFile(path.join(root, 'public', 'game.json'), 'utf8'),
    ) as {
      initialSceneId: string;
      worldStartRegionId?: string;
      scenes: Array<{
        id: string;
        customModule?: string;
        layoutOnly?: boolean;
        entities?: unknown[];
      }>;
      assets: unknown[];
    };
    expect(dsl.initialSceneId).toBe('TitleScene');
    expect(dsl.worldStartRegionId).toBe('town_square');
    expect(dsl.scenes.slice(0, 3).map((s) => s.id)).toEqual([
      'TitleScene',
      'WorldScene',
      'VictoryScene',
    ]);
    expect(dsl.scenes.slice(0, 3).every((s) => s.customModule === s.id)).toBe(
      true,
    );
    const town = dsl.scenes.find((s) => s.id === 'town_square');
    expect(town?.layoutOnly).toBe(true);
    expect(town?.entities).toHaveLength(1);
    expect(dsl.scenes.find((s) => s.id === 'forest')?.layoutOnly).toBe(true);
    expect(dsl.assets).toHaveLength(1);
    expect(detectExtraScenesBootMismatch(dsl as never)).toEqual([]);

    const again = await healExtraScenesGameJsonWiring(root);
    expect(again.healed).toBe(false);
    const townAgain = JSON.parse(
      await fsp.readFile(path.join(root, 'public', 'game.json'), 'utf8'),
    ).scenes.find((s: { id: string }) => s.id === 'town_square');
    expect(townAgain.entities).toHaveLength(1);
  });
});

describe('detectFragileRestartAndDeath', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    for (const d of dirs.splice(0)) {
      await fsp.rm(d, { recursive: true, force: true });
    }
  });

  it('flags keydown-only GameOver restart without reload/keyup', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'og-restart-'));
    dirs.push(root);
    const scenes = path.join(root, 'src', 'scenes');
    await fsp.mkdir(scenes, { recursive: true });
    await fsp.writeFile(
      path.join(scenes, 'GameOverScene.ts'),
      `
      export class GameOverScene {
        create() {
          const restart = () => this.scene.start('TitleScene');
          this.input.keyboard?.once('keydown-R', restart);
          this.input.keyboard?.once('keydown-SPACE', restart);
        }
      }
      `,
      'utf8',
    );
    const issues = await detectFragileRestartAndDeath(root);
    expect(issues.some((i) => /keydown|keyup|reload/i.test(i))).toBe(true);
  });

  it('accepts hard reload restart', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'og-restart-ok-'));
    dirs.push(root);
    const scenes = path.join(root, 'src', 'scenes');
    await fsp.mkdir(scenes, { recursive: true });
    await fsp.writeFile(
      path.join(scenes, 'GameOverScene.ts'),
      `
      export class GameOverScene {
        create() {
          const restart = () => window.location.reload();
          this.input.keyboard?.once('keyup-R', restart);
        }
      }
      `,
      'utf8',
    );
    const issues = await detectFragileRestartAndDeath(root);
    expect(issues).toEqual([]);
  });
});
