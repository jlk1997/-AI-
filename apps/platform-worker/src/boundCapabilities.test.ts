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
  ensureBoundCapabilities,
  mergeExtraSceneIntoMain,
} from './boundCapabilities.js';

describe('mergeExtraSceneIntoMain', () => {
  it('adds BoardTurnScene without dropping World/Title', () => {
    const src = `import { bootstrap } from '@opengame/runtime';
import { TitleScene } from './scenes/TitleScene';
import { WorldScene } from './scenes/WorldScene';

await bootstrap({
  source: './game.json',
  extraScenes: [TitleScene, WorldScene],
});
`;
    const next = mergeExtraSceneIntoMain(
      src,
      'BoardTurnScene',
      './scenes/BoardTurnScene',
    );
    expect(next).toContain('TitleScene');
    expect(next).toContain('WorldScene');
    expect(next).toContain('BoardTurnScene');
    expect(next).toMatch(/extraScenes:\s*\[[^\]]*BoardTurnScene/);
    expect(next).toContain("from './scenes/BoardTurnScene'");
  });

  it('is idempotent when the scene is already registered', () => {
    const src = `import { BoardTurnScene } from './scenes/BoardTurnScene';
await bootstrap({ extraScenes: [BoardTurnScene] });
`;
    expect(mergeExtraSceneIntoMain(src, 'BoardTurnScene', './scenes/BoardTurnScene')).toBe(
      src,
    );
  });
});

describe('ensureBoundCapabilities', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    for (const d of dirs.splice(0)) {
      await fsp.rm(d, { recursive: true, force: true });
    }
  });

  it('writes BoardTurnScene onto a town workspace without deleting World', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'og-bound-'));
    dirs.push(root);
    await fsp.mkdir(path.join(root, 'src', 'scenes'), { recursive: true });
    await fsp.mkdir(path.join(root, 'public'), { recursive: true });
    await fsp.writeFile(
      path.join(root, 'src', 'scenes', 'WorldScene.ts'),
      'export class WorldScene {}\n',
      'utf8',
    );
    await fsp.writeFile(
      path.join(root, 'src', 'main.ts'),
      `import { WorldScene } from './scenes/WorldScene';
await bootstrap({ source: './game.json', extraScenes: [WorldScene] });
`,
      'utf8',
    );
    await fsp.writeFile(
      path.join(root, 'public', 'game.json'),
      JSON.stringify({
        dslVersion: '1.0.0',
        initialSceneId: 'WorldScene',
        scenes: [{ id: 'WorldScene', customModule: 'WorldScene', entities: [] }],
      }),
      'utf8',
    );
    const written = await ensureBoundCapabilities(root, {
      modules: ['platform', 'world', 'board'],
      boardKind: 'xiangqi',
      extraScenes: ['BoardTurnScene'],
    });
    expect(written.written.some((f) => f.includes('BoardTurnScene'))).toBe(true);
    const main = await fsp.readFile(path.join(root, 'src', 'main.ts'), 'utf8');
    expect(main).toContain('WorldScene');
    expect(main).toContain('BoardTurnScene');
    expect(await fsp.readFile(path.join(root, 'src', 'scenes', 'WorldScene.ts'), 'utf8')).toContain(
      'WorldScene',
    );
    const cap = JSON.parse(
      await fsp.readFile(path.join(root, 'public', 'CAPABILITY.json'), 'utf8'),
    ) as { modules: string[] };
    expect(cap.modules).toContain('board');
    expect(
      await fsp.readFile(path.join(root, 'public', 'JIAXI.json'), 'utf8'),
    ).toContain('extra_move');
  });

  it('writes Match3Scene onto a town workspace without deleting World', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'og-bound-m3-'));
    dirs.push(root);
    await fsp.mkdir(path.join(root, 'src', 'scenes'), { recursive: true });
    await fsp.mkdir(path.join(root, 'public'), { recursive: true });
    await fsp.writeFile(
      path.join(root, 'src', 'scenes', 'WorldScene.ts'),
      'export class WorldScene {}\n',
      'utf8',
    );
    await fsp.writeFile(
      path.join(root, 'src', 'main.ts'),
      `import { WorldScene } from './scenes/WorldScene';
await bootstrap({ source: './game.json', extraScenes: [WorldScene] });
`,
      'utf8',
    );
    await ensureBoundCapabilities(root, {
      modules: ['platform', 'world', 'match'],
      extraScenes: ['Match3Scene'],
    });
    const main = await fsp.readFile(path.join(root, 'src', 'main.ts'), 'utf8');
    expect(main).toContain('WorldScene');
    expect(main).toContain('Match3Scene');
    expect(
      await fsp.readFile(path.join(root, 'src', 'scenes', 'Match3Scene.ts'), 'utf8'),
    ).toContain('Match3Rules');
  });

  it('writes Match3Scene onto a town workspace without deleting World', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'og-bound-m3-'));
    dirs.push(root);
    await fsp.mkdir(path.join(root, 'src', 'scenes'), { recursive: true });
    await fsp.mkdir(path.join(root, 'public'), { recursive: true });
    await fsp.writeFile(
      path.join(root, 'src', 'scenes', 'WorldScene.ts'),
      'export class WorldScene {}\n',
      'utf8',
    );
    await fsp.writeFile(
      path.join(root, 'src', 'main.ts'),
      `import { WorldScene } from './scenes/WorldScene';
await bootstrap({ source: './game.json', extraScenes: [WorldScene] });
`,
      'utf8',
    );
    await ensureBoundCapabilities(root, {
      modules: ['platform', 'world', 'match'],
      extraScenes: ['Match3Scene'],
    });
    const main = await fsp.readFile(path.join(root, 'src', 'main.ts'), 'utf8');
    expect(main).toContain('WorldScene');
    expect(main).toContain('Match3Scene');
    const src = await fsp.readFile(
      path.join(root, 'src', 'scenes', 'Match3Scene.ts'),
      'utf8',
    );
    expect(src).toContain('Match3Rules');
  });

  it('merges an existing extra Scene into main without rewriting the boot list', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'og-bound-shop-'));
    dirs.push(root);
    await fsp.mkdir(path.join(root, 'src', 'scenes'), { recursive: true });
    await fsp.mkdir(path.join(root, 'public'), { recursive: true });
    await fsp.writeFile(
      path.join(root, 'src', 'scenes', 'WorldScene.ts'),
      'export class WorldScene {}\n',
      'utf8',
    );
    await fsp.writeFile(
      path.join(root, 'src', 'scenes', 'ShopScene.ts'),
      'export class ShopScene {}\n',
      'utf8',
    );
    await fsp.writeFile(
      path.join(root, 'src', 'main.ts'),
      `import { WorldScene } from './scenes/WorldScene';
await bootstrap({ source: './game.json', extraScenes: [WorldScene] });
`,
      'utf8',
    );
    await fsp.writeFile(
      path.join(root, 'public', 'game.json'),
      JSON.stringify({
        dslVersion: '1.0.0',
        initialSceneId: 'WorldScene',
        scenes: [{ id: 'WorldScene', customModule: 'WorldScene', entities: [] }],
      }),
      'utf8',
    );
    await ensureBoundCapabilities(root, {
      modules: ['platform', 'world', 'systems'],
      extraScenes: ['ShopScene'],
    });
    const main = await fsp.readFile(path.join(root, 'src', 'main.ts'), 'utf8');
    expect(main).toContain('WorldScene');
    expect(main).toContain('ShopScene');
  });
});
