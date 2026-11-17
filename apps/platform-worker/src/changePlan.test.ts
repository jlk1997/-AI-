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
  parseChangePlan,
  formatChangePlanForPrompt,
  applyChangePlanToGameArtifacts,
  ensureChangePlanSceneContracts,
  writeChangePlan,
} from './changePlan.js';

describe('changePlan', () => {
  it('parses harder + boss + cyberpunk style', () => {
    const plan = parseChangePlan({
      userPrompt: '更难一点，加一个Boss，画风换成赛博朋克',
      intent: 'iterate',
    });
    expect(plan.difficulty).toBe('harder');
    expect(plan.addBoss).toBe(true);
    expect(plan.artStyle).toMatch(/cyberpunk|赛博/i);
    expect(plan.forceAssetRegen).toBe(true);
    expect(formatChangePlanForPrompt(plan)).toContain('addBoss');
  });

  it('uses gameParams theme as artStyle', () => {
    const plan = parseChangePlan({
      userPrompt: '优化一下画面',
      gameParams: { theme: 'watercolor fantasy' },
      intent: 'iterate',
    });
    expect(plan.artStyle).toBe('watercolor fantasy');
    expect(plan.forceAssetRegen).toBe(true);
  });

  it('picked artStyleId beats the loose theme tag', () => {
    const plan = parseChangePlan({
      userPrompt: '继续做',
      gameParams: { theme: 'watercolor fantasy', artStyleId: 'ink_wash' },
      intent: 'iterate',
    });
    expect(plan.artStyle).toMatch(/ink-wash/i);
    expect(plan.forceAssetRegen).toBe(true);
  });

  it('applyChangePlanToGameArtifacts seeds boss + harder tunables', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-cp-'));
    const pub = path.join(dir, 'public');
    fs.mkdirSync(pub, { recursive: true });
    fs.writeFileSync(
      path.join(pub, 'game.json'),
      JSON.stringify({
        meta: { title: 'T' },
        scenes: [
          {
            id: 'main',
            entities: [
              { id: 'player', kind: 'player', tags: ['player'] },
              { id: 'e1', kind: 'enemy', tags: ['enemy'], attrs: { hp: 2 } },
            ],
          },
        ],
        tunables: { enemyCount: 3, spawnIntervalMs: 1000 },
      }),
      'utf8',
    );
    const plan = parseChangePlan({
      userPrompt: '更难并加一个 Boss',
      intent: 'iterate',
      imageHints: ['https://example.com/ref.png', 'neon cyber mood'],
    });
    await writeChangePlan(dir, plan);
    const { patches } = await applyChangePlanToGameArtifacts(dir, plan);
    expect(patches.length).toBeGreaterThan(0);
    const dsl = JSON.parse(
      fs.readFileSync(path.join(pub, 'game.json'), 'utf8'),
    ) as {
      scenes: Array<{ entities: Array<{ id: string; tags?: string[] }> }>;
      tunables: Record<string, number>;
    };
    expect(JSON.stringify(dsl)).toMatch(/boss/i);
    expect(dsl.tunables.enemyCount).toBeGreaterThanOrEqual(5);
    expect(fs.existsSync(path.join(pub, 'og_intent.json'))).toBe(true);
    const refs = JSON.parse(
      fs.readFileSync(path.join(pub, 'REFERENCE_IMAGES.json'), 'utf8'),
    ) as { urls?: string[]; hints?: string[] };
    expect(refs.urls?.[0]).toContain('example.com');
    expect(refs.hints?.join(' ')).toMatch(/neon|cyber/i);
  });

  it('ensureChangePlanSceneContracts injects boss into stripped Scene', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-sc-'));
    const pub = path.join(dir, 'public');
    const scenes = path.join(dir, 'src', 'scenes');
    fs.mkdirSync(pub, { recursive: true });
    fs.mkdirSync(scenes, { recursive: true });
    fs.writeFileSync(
      path.join(pub, 'game.json'),
      JSON.stringify({
        meta: { title: 'T' },
        scenes: [{ id: 'main', entities: [] }],
        tunables: {},
      }),
      'utf8',
    );
    fs.writeFileSync(
      path.join(scenes, 'Level1Scene.ts'),
      `import Phaser from 'phaser';
import { PlatformSceneHelper } from '@opengame/module-platform';
export class Level1Scene extends Phaser.Scene {
  constructor() { super('Level1Scene'); }
  preload(): void { PlatformSceneHelper.preloadGameAudio(this); }
  create(): void {
    this.cameras.main.setBackgroundColor('#000');
  }
}
`,
      'utf8',
    );
    const plan = parseChangePlan({
      userPrompt: '更难一点，加一个 Boss',
      intent: 'iterate',
    });
    const { patches } = await ensureChangePlanSceneContracts(dir, plan);
    expect(patches.some((p) => p.includes('boss'))).toBe(true);
    const src = fs.readFileSync(path.join(scenes, 'Level1Scene.ts'), 'utf8');
    expect(src).toMatch(/bossPresent|setData\('boss'\)/);
    expect(src).toMatch(/setData\('hp'/);
    expect(src).toMatch(/HARDER|difficultyTier/);
  });

  it('resolves target scene + addDialogue for narrative iterate', () => {
    const sceneIds = ['TitleScene', 'Level1Scene', 'Level2Scene', 'GameOverScene'];
    const coin = parseChangePlan({
      userPrompt: '第1关多一个金币',
      intent: 'iterate',
      sceneIds,
    });
    expect(coin.targetSceneId).toMatch(/Level1|level1/i);
    expect(coin.editLevel).toBe(true);
    expect(coin.preserveScenes.length).toBeGreaterThan(0);

    const hard = parseChangePlan({
      userPrompt: '更难一点',
      intent: 'iterate',
      sceneIds,
    });
    expect(hard.difficulty).toBe('harder');

    const title = parseChangePlan({
      userPrompt: 'Title 文案改一句',
      intent: 'iterate',
      sceneIds,
    });
    expect(title.targetSceneId).toMatch(/Title/i);

    const dlg = parseChangePlan({
      userPrompt: '给铁匠加一段对话和剧情选项',
      intent: 'iterate',
      sceneIds: ['TitleScene', 'ChapterScene', 'BattleScene'],
    });
    expect(dlg.addDialogue).toBe(true);
  });

  it('applyChangePlanToGameArtifacts seeds story JSON on addDialogue', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-dlg-'));
    const pub = path.join(dir, 'public');
    fs.mkdirSync(pub, { recursive: true });
    fs.writeFileSync(
      path.join(pub, 'game.json'),
      JSON.stringify({
        meta: { title: 'VN' },
        scenes: [{ id: 'ChapterScene', entities: [] }],
        dialogue: [],
      }),
      'utf8',
    );
    const plan = parseChangePlan({
      userPrompt: '加一段对话，给 Guide NPC',
      intent: 'iterate',
      sceneIds: ['TitleScene', 'ChapterScene'],
    });
    expect(plan.addDialogue).toBe(true);
    const { patches } = await applyChangePlanToGameArtifacts(dir, plan);
    expect(patches.some((p) => String(p).includes('story'))).toBe(true);
    const story = path.join(pub, 'story', 'chapter_01.json');
    expect(fs.existsSync(story)).toBe(true);
    const body = JSON.parse(fs.readFileSync(story, 'utf8')) as {
      entries: unknown[];
    };
    expect(body.entries.length).toBeGreaterThan(0);
  });
});
