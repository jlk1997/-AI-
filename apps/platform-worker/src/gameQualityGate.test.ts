/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

import { runGameQualityGate } from './gameQualityGate.js';

/** Large enough to pass real-asset authenticity probes in unit tests. */
function richPng(): Buffer {
  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const body = Buffer.alloc(4000);
  for (let i = 0; i < body.length; i++) body[i] = (i * 41 + 7) & 0xff;
  return Buffer.concat([header, body]);
}
function richAudio(): Buffer {
  return Buffer.alloc(12_000, 3);
}

describe('gameQualityGate', () => {
  it('rejects movement-only stub', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-qa-'));
    fs.mkdirSync(path.join(dir, 'public'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'public', 'game.json'),
      JSON.stringify({
        dslVersion: '1.0.0',
        meta: { title: 'Stub' },
        scenes: [
          {
            id: 'main',
            entities: [
              {
                id: 'box',
                sprite: { x: 100, y: 100, shape: 'rect' },
                behaviors: [{ kind: 'eightWayMovement' }],
              },
            ],
          },
        ],
      }),
      'utf8',
    );
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'src', 'main.ts'),
      `import { bootstrap } from '@opengame/runtime/bootstrap';\nawait bootstrap({ source: './game.json' });\n`,
      'utf8',
    );
    const result = await runGameQualityGate(dir, 'relaxed');
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.includes('玩法'))).toBe(true);
  });

  it('accepts game with skills', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-qa-'));
    fs.mkdirSync(path.join(dir, 'public'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'public', 'game.json'),
      JSON.stringify({
        dslVersion: '1.0.0',
        meta: { title: 'Real' },
        scenes: [{ id: 'main', entities: [{ id: 'p', sprite: { x: 0, y: 0 } }], hud: { score: true } }],
        skills: [
          {
            id: 'score',
            trigger: { kind: 'onKey', key: 'SPACE' },
            effects: [{ kind: 'addScore', payload: { delta: 1 } }],
          },
        ],
      }),
      'utf8',
    );
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'src', 'main.ts'),
      `import { bootstrap } from '@opengame/runtime/bootstrap';\nawait bootstrap({ source: './game.json' });\n`,
      'utf8',
    );
    const result = await runGameQualityGate(dir, 'relaxed');
    expect(result.ok).toBe(true);
  });

  it('rejects RPG stub with unimplemented gameFlow and missing scenes', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-qa-rpg-'));
    fs.mkdirSync(path.join(dir, 'public'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'public', 'game.json'),
      JSON.stringify({
        dslVersion: '1.1.0',
        meta: { title: 'RPG' },
        gameFlow: { start: 'prologue', chapters: ['forest', 'boss'] },
        scenes: [
          {
            id: 'prologue',
            entities: [{ id: 'hero', sprite: { x: 0, y: 0 } }],
            dialogueKey: 'prologue',
          },
        ],
      }),
      'utf8',
    );
    fs.writeFileSync(
      path.join(dir, 'src', 'main.ts'),
      `import { bootstrap } from '@opengame/runtime/bootstrap';\nawait bootstrap({ source: './game.json', extraScenes: [] });\n`,
      'utf8',
    );
    const result = await runGameQualityGate(dir, 'relaxed', { archetype: 'ui_heavy' });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.includes('gameFlow') || i.includes('Scene'))).toBe(true);
  });

  it('accepts ui_heavy with extraScenes and scene files', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-qa-ui-'));
    fs.mkdirSync(path.join(dir, 'public', 'story'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'src', 'scenes'), { recursive: true });
    for (const name of ['TitleScene', 'ChapterScene', 'BattleScene', 'EndingScene']) {
      fs.writeFileSync(
        path.join(dir, 'src', 'scenes', `${name}.ts`),
        name === 'ChapterScene'
          ? `import { DialogueManager } from '@opengame/module-dialogue';
import { GameUiKit } from '@opengame/module-platform';
import { readBibleFromCache } from '../content/ContentDirector';
export class ChapterScene extends Phaser.Scene {
  constructor(){super('ChapterScene');}
  create(){
    GameUiKit.addDialoguePanel(this);
    readBibleFromCache(this.cache);
    const d = new DialogueManager(this);
    d.loadFromStoryJson({ entries: [] });
    const leaveChapter = () => this.scene.start('EndingScene');
    this.input.keyboard?.on('keydown-S', () => leaveChapter());
    this.add.text(100, 36, 'Skip · S');
    this.scene.start('EndingScene');
  }
}
`
          : name === 'EndingScene'
            ? `export class EndingScene extends Phaser.Scene {
  constructor(){super('EndingScene');}
  preload(){ this.load.json('og_story_bible', './STORY_BIBLE.json'); }
  create(){
    const bible = this.cache.json.get('og_story_bible') as { endings?: unknown[] };
    const endings = bible?.endings ?? [];
    const endingMeta = endings[0];
    this.add.text(10, 10, String(endingMeta ?? 'end'));
  }
}
`
            : `export class ${name} extends Phaser.Scene { constructor(){super('${name}');} create(){ this.scene.start('EndingScene'); } }\n`,
        'utf8',
      );
    }
    fs.writeFileSync(
      path.join(dir, 'public', 'STORY_BIBLE.json'),
      JSON.stringify({
        npcs: [
          { id: 'a', name: '阿青' },
          { id: 'b', name: '铁匠' },
        ],
        quests: [{ id: 'q1', title: '入镇', status: 'active' }],
        endings: [
          { id: 'ending_a', title: '结局甲', body: '守约归来' },
          { id: 'ending_b', title: '结局乙', body: '旁支夜路' },
        ],
        flags: { got_scroll: false },
        winCondition: 'ending_flag',
        chapters: [{ id: 'chapter_01', title: '一', file: 'story/chapter_01.json' }],
      }),
      'utf8',
    );
    fs.writeFileSync(
      path.join(dir, 'public', 'CONTENT_GRAPH.json'),
      JSON.stringify({
        schema: 'opengame-content-graph-v1',
        nodes: [{ id: 'content:root', layer: 'content', kind: 'story_bible', title: 'RPG' }],
        edges: [],
      }),
      'utf8',
    );
    fs.writeFileSync(
      path.join(dir, 'public', 'story', 'chapter_01.json'),
      JSON.stringify({
        entries: [
          { id: '1', type: 'text', speaker: 'a', text: '你好', nextId: '2' },
          { id: '2', type: 'text', speaker: 'b', text: '欢迎', nextId: '3' },
          {
            id: '3',
            type: 'choice',
            prompt: '去哪？',
            options: [
              { label: '铁匠铺', nextId: 'end_a' },
              { label: '寺门', nextId: 'end_b' },
            ],
          },
          { id: 'end_a', type: 'text', text: '去铁匠', nextId: null },
          { id: 'end_b', type: 'text', text: '去寺门', nextId: null },
        ],
      }),
      'utf8',
    );
    fs.writeFileSync(
      path.join(dir, 'public', 'game.json'),
      JSON.stringify({
        dslVersion: '1.1.0',
        meta: { title: 'RPG' },
        initialSceneId: 'TitleScene',
        scenes: [
          { id: 'TitleScene', customModule: 'TitleScene', entities: [] },
          { id: 'ChapterScene', customModule: 'ChapterScene', entities: [] },
          { id: 'BattleScene', customModule: 'BattleScene', entities: [] },
          { id: 'EndingScene', customModule: 'EndingScene', entities: [] },
        ],
        dialogue: [{ group: 'intro', text: 'Hello' }],
      }),
      'utf8',
    );
    fs.writeFileSync(
      path.join(dir, 'src', 'main.ts'),
      `import { bootstrap } from '@opengame/runtime/bootstrap';\nimport { TitleScene } from './scenes/TitleScene';\nimport { ChapterScene } from './scenes/ChapterScene';\nimport { BattleScene } from './scenes/BattleScene';\nimport { EndingScene } from './scenes/EndingScene';\nawait bootstrap({ source: './game.json', extraScenes: [TitleScene, ChapterScene, BattleScene, EndingScene] });\n`,
      'utf8',
    );
    const result = await runGameQualityGate(dir, 'relaxed', { archetype: 'ui_heavy' });
    expect(result.ok).toBe(true);
  });

  it('accepts legacy Phaser custom Level scene without DSL rule signals', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-qa-phaser-'));
    fs.mkdirSync(path.join(dir, 'public'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'src', 'scenes'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'public', 'game.json'),
      JSON.stringify({
        dslVersion: '1.0.0',
        meta: { title: 'Phaser' },
        scenes: [{ id: 'main', entities: [{ id: 'p', sprite: { x: 0, y: 0 } }] }],
      }),
      'utf8',
    );
    fs.writeFileSync(
      path.join(dir, 'src', 'main.ts'),
      `import Phaser from 'phaser';\nimport { Level1Scene } from './scenes/Level1Scene';\nnew Phaser.Game({ scene: [Level1Scene] });\n`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(dir, 'src', 'scenes', 'Level1Scene.ts'),
      `export class Level1Scene extends Phaser.Scene {}\n`,
      'utf8',
    );
    const result = await runGameQualityGate(dir, 'relaxed');
    expect(result.ok).toBe(true);
  });

  it('beyond-baseline rejects image asset missing on disk', async () => {
    const prev = process.env['PLATFORM_QUALITY_BEYOND_BASELINE'];
    process.env['PLATFORM_QUALITY_BEYOND_BASELINE'] = 'true';
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-qa-art-'));
    fs.mkdirSync(path.join(dir, 'public'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'public', 'game.json'),
      JSON.stringify({
        dslVersion: '1.0.0',
        meta: { title: 'Art' },
        scenes: [
          {
            id: 'main',
            entities: [{ id: 'p', sprite: { x: 0, y: 0 } }],
            hud: { score: true },
          },
        ],
        skills: [
          {
            id: 'score',
            trigger: { kind: 'onKey', key: 'SPACE' },
            effects: [{ kind: 'addScore', payload: { delta: 1 } }],
          },
        ],
        assets: [
          { id: 'hero', kind: 'image', url: './assets/missing-hero.png' },
        ],
      }),
      'utf8',
    );
    fs.writeFileSync(
      path.join(dir, 'src', 'main.ts'),
      `import { bootstrap } from '@opengame/runtime/bootstrap';\nawait bootstrap({ source: './game.json' });\n`,
      'utf8',
    );
    try {
      const result = await runGameQualityGate(dir, 'relaxed');
      expect(result.ok).toBe(false);
      expect(result.issues.some((i) => i.includes('missing on disk'))).toBe(
        true,
      );
    } finally {
      if (prev === undefined) delete process.env['PLATFORM_QUALITY_BEYOND_BASELINE'];
      else process.env['PLATFORM_QUALITY_BEYOND_BASELINE'] = prev;
    }
  });

  it('strict rejects audio asset missing on disk', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-qa-audio-'));
    fs.mkdirSync(path.join(dir, 'public', 'assets'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    fs.writeFileSync(path.join(dir, 'public', 'assets', 'hero.png'), png);
    fs.writeFileSync(path.join(dir, 'public', 'assets', 'bg.png'), png);
    fs.writeFileSync(
      path.join(dir, 'public', 'game.json'),
      JSON.stringify({
        dslVersion: '1.0.0',
        meta: { title: 'Audio' },
        scenes: [
          {
            id: 'main',
            entities: [{ id: 'p', sprite: { x: 0, y: 0 } }],
            hud: { score: true },
          },
        ],
        skills: [
          {
            id: 'score',
            trigger: { kind: 'onKey', key: 'SPACE' },
            effects: [{ kind: 'addScore', payload: { delta: 1 } }],
          },
        ],
        assets: [
          { id: 'hero', kind: 'image', url: './assets/hero.png' },
          { id: 'bg', kind: 'image', url: './assets/bg.png' },
          { id: 'bgm', kind: 'audio', url: './assets/missing-bgm.mp3' },
        ],
      }),
      'utf8',
    );
    fs.writeFileSync(
      path.join(dir, 'src', 'main.ts'),
      `import { bootstrap } from '@opengame/runtime/bootstrap';\nawait bootstrap({ source: './game.json' });\n`,
      'utf8',
    );
    const result = await runGameQualityGate(dir, 'strict');
    expect(result.ok).toBe(false);
    expect(
      result.issues.some(
        (i) => i.includes('audio') && i.includes('missing on disk'),
      ),
    ).toBe(true);
  });

  it('beyond-baseline rejects non-grid without win path even with skills', async () => {
    const prev = process.env['PLATFORM_QUALITY_BEYOND_BASELINE'];
    process.env['PLATFORM_QUALITY_BEYOND_BASELINE'] = 'true';
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-qa-nowin-'));
    fs.mkdirSync(path.join(dir, 'public', 'assets'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'src', 'scenes'), { recursive: true });
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    fs.writeFileSync(path.join(dir, 'public', 'assets', 'hero.png'), png);
    fs.writeFileSync(path.join(dir, 'public', 'assets', 'bg.png'), png);
    fs.writeFileSync(path.join(dir, 'public', 'assets', 'bgm.mp3'), Buffer.from([0]));
    fs.writeFileSync(path.join(dir, 'public', 'assets', 'sfx_win.mp3'), Buffer.from([0]));
    fs.writeFileSync(
      path.join(dir, 'public', 'game.json'),
      JSON.stringify({
        dslVersion: '1.0.0',
        meta: { title: 'NoWin' },
        scenes: [
          {
            id: 'main',
            entities: [{ id: 'p', sprite: { x: 0, y: 0 } }],
            hud: { score: true },
          },
        ],
        skills: [
          {
            id: 's',
            trigger: { kind: 'onKey', key: 'SPACE' },
            effects: [{ kind: 'addScore', payload: { delta: 1 } }],
          },
        ],
        assets: [
          { id: 'hero', kind: 'image', url: './assets/hero.png' },
          { id: 'bg', kind: 'image', url: './assets/bg.png' },
          { id: 'bgm', kind: 'audio', url: './assets/bgm.mp3' },
          { id: 'sfx_win', kind: 'audio', url: './assets/sfx_win.mp3' },
        ],
      }),
      'utf8',
    );
    fs.writeFileSync(
      path.join(dir, 'src', 'main.ts'),
      `import { bootstrap } from '@opengame/runtime/bootstrap';\nimport { LevelScene } from './scenes/LevelScene';\nawait bootstrap({ source: './game.json', extraScenes: [LevelScene] });\n`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(dir, 'src', 'scenes', 'LevelScene.ts'),
      `export class LevelScene extends Phaser.Scene { create() { this.add.text(0,0,'hi'); } }\n`,
      'utf8',
    );
    try {
      const result = await runGameQualityGate(dir, 'relaxed', {
        archetype: 'platformer',
        skipArchetypeSceneRules: true,
      });
      expect(result.ok).toBe(false);
      expect(result.issues.some((i) => i.includes('胜负') || i.includes('通关'))).toBe(
        true,
      );
    } finally {
      if (prev === undefined) delete process.env['PLATFORM_QUALITY_BEYOND_BASELINE'];
      else process.env['PLATFORM_QUALITY_BEYOND_BASELINE'] = prev;
    }
  });

  it('beyond-baseline rejects TD without WaveManager/won', async () => {
    const prev = process.env['PLATFORM_QUALITY_BEYOND_BASELINE'];
    process.env['PLATFORM_QUALITY_BEYOND_BASELINE'] = 'true';
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-qa-td-'));
    fs.mkdirSync(path.join(dir, 'public', 'assets'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'src', 'scenes'), { recursive: true });
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    fs.writeFileSync(path.join(dir, 'public', 'assets', 'hero.png'), png);
    fs.writeFileSync(path.join(dir, 'public', 'assets', 'bg.png'), png);
    fs.writeFileSync(path.join(dir, 'public', 'assets', 'bgm.mp3'), Buffer.from([0]));
    fs.writeFileSync(path.join(dir, 'public', 'assets', 'sfx_win.mp3'), Buffer.from([0]));
    fs.writeFileSync(
      path.join(dir, 'public', 'game.json'),
      JSON.stringify({
        dslVersion: '1.0.0',
        meta: { title: 'TD' },
        scenes: [{ id: 'main', entities: [{ id: 'p', sprite: { x: 0, y: 0 } }], hud: { score: true } }],
        skills: [{ id: 's', trigger: { kind: 'onKey', key: 'SPACE' }, effects: [{ kind: 'addScore', payload: { delta: 1 } }] }],
        assets: [
          { id: 'hero', kind: 'image', url: './assets/hero.png' },
          { id: 'bg', kind: 'image', url: './assets/bg.png' },
          { id: 'bgm', kind: 'audio', url: './assets/bgm.mp3' },
          { id: 'sfx_win', kind: 'audio', url: './assets/sfx_win.mp3' },
        ],
      }),
      'utf8',
    );
    fs.writeFileSync(
      path.join(dir, 'src', 'main.ts'),
      `import { bootstrap } from '@opengame/runtime/bootstrap';\nimport { TDScene } from './scenes/TDScene';\nawait bootstrap({ source: './game.json', extraScenes: [TDScene] });\n`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(dir, 'src', 'scenes', 'TDScene.ts'),
      `export class TDScene extends Phaser.Scene { create() { this.add.text(0,0,'td'); } }\n`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(dir, '.opengame-pipeline.json'),
      JSON.stringify({ archetype: 'tower_defense' }),
      'utf8',
    );
    try {
      const result = await runGameQualityGate(dir, 'relaxed', {
        archetype: 'tower_defense',
        skipArchetypeSceneRules: true,
      });
      expect(result.ok).toBe(false);
      expect(
        result.issues.some(
          (i) => i.includes('WaveManager') || i.includes('EconomyManager'),
        ),
      ).toBe(true);
    } finally {
      if (prev === undefined) delete process.env['PLATFORM_QUALITY_BEYOND_BASELINE'];
      else process.env['PLATFORM_QUALITY_BEYOND_BASELINE'] = prev;
    }
  });

  it('beyond-baseline accepts TD with WaveManager + won path', async () => {
    const prev = process.env['PLATFORM_QUALITY_BEYOND_BASELINE'];
    const prevMm = process.env['PLATFORM_GAME_MINIMAX_ASSETS'];
    process.env['PLATFORM_QUALITY_BEYOND_BASELINE'] = 'true';
    // Scene-only TD fixture uses hero/bg — do not force MiniMax 4-pack in this unit test
    delete process.env['PLATFORM_GAME_MINIMAX_ASSETS'];
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-qa-tdok-'));
    fs.mkdirSync(path.join(dir, 'public', 'assets'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'src', 'scenes'), { recursive: true });
    const png = richPng();
    fs.writeFileSync(path.join(dir, 'public', 'assets', 'hero.png'), png);
    fs.writeFileSync(path.join(dir, 'public', 'assets', 'bg.png'), png);
    fs.writeFileSync(path.join(dir, 'public', 'assets', 'bgm.mp3'), richAudio());
    fs.writeFileSync(path.join(dir, 'public', 'assets', 'sfx_win.mp3'), richAudio());
    fs.writeFileSync(
      path.join(dir, 'public', 'game.json'),
      JSON.stringify({
        dslVersion: '1.0.0',
        meta: { title: 'TDOk' },
        scenes: [{ id: 'main', entities: [{ id: 'p', sprite: { x: 0, y: 0 } }], hud: { score: true } }],
        skills: [{ id: 's', trigger: { kind: 'onKey', key: 'SPACE' }, effects: [{ kind: 'addScore', payload: { delta: 1 } }] }],
        assets: [
          { id: 'hero', kind: 'image', url: './assets/hero.png' },
          { id: 'bg', kind: 'image', url: './assets/bg.png' },
          { id: 'bgm', kind: 'audio', url: './assets/bgm.mp3' },
          { id: 'sfx_win', kind: 'audio', url: './assets/sfx_win.mp3' },
        ],
      }),
      'utf8',
    );
    fs.writeFileSync(
      path.join(dir, 'src', 'main.ts'),
      `import { bootstrap } from '@opengame/runtime/bootstrap';\nimport { TDScene } from './scenes/TDScene';\nimport { VictoryScene } from './scenes/VictoryScene';\nawait bootstrap({ source: './game.json', extraScenes: [TDScene, VictoryScene] });\n`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(dir, 'src', 'scenes', 'TDScene.ts'),
      `import { WaveManager, EconomyManager } from '@opengame/module-td';\nexport class TDScene extends Phaser.Scene {\n  create() {\n    const e = new EconomyManager(10);\n    const w = new WaveManager({ waves: [{ id: 'w1', enemyCount: 1 }] });\n    this.registry.set('won', true);\n    this.scene.start('VictoryScene');\n  }\n}\n`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(dir, 'src', 'scenes', 'VictoryScene.ts'),
      `export class VictoryScene extends Phaser.Scene { create() {} }\n`,
      'utf8',
    );
    try {
      const result = await runGameQualityGate(dir, 'relaxed', {
        archetype: 'tower_defense',
        skipArchetypeSceneRules: true,
      });
      expect(
        result.issues.filter(
          (i) =>
            i.includes('WaveManager') ||
            i.includes('registry.set') ||
            i.includes('胜负') ||
            i.includes('ArtDirector'),
        ),
      ).toHaveLength(0);
    } finally {
      if (prev === undefined) delete process.env['PLATFORM_QUALITY_BEYOND_BASELINE'];
      else process.env['PLATFORM_QUALITY_BEYOND_BASELINE'] = prev;
      if (prevMm === undefined) delete process.env['PLATFORM_GAME_MINIMAX_ASSETS'];
      else process.env['PLATFORM_GAME_MINIMAX_ASSETS'] = prevMm;
    }
  });

  it('beyond-baseline flags a missing named loop from MechanicSpec', async () => {
    const prev = process.env['PLATFORM_QUALITY_BEYOND_BASELINE'];
    process.env['PLATFORM_QUALITY_BEYOND_BASELINE'] = 'true';
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-qa-loop-'));
    fs.mkdirSync(path.join(dir, 'public'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'src', 'scenes'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.opengame-mechanic.json'),
      JSON.stringify({
        schema: 'opengame-mechanic-v1',
        prompt: '赶海',
        space: 'side',
        time: 'realtime',
        input: 'keys',
        win: 'custom',
        loops: [
          {
            id: 'custom-赶海',
            label: '赶海',
            signals: ['赶海'],
            source: 'custom',
          },
        ],
        modules: ['platform'],
        archetypeHint: 'platformer',
        updatedAt: new Date().toISOString(),
      }),
      'utf8',
    );
    fs.writeFileSync(
      path.join(dir, 'public', 'game.json'),
      JSON.stringify({
        dslVersion: '1.0.0',
        meta: { title: 'Nope' },
        scenes: [{ id: 'LevelScene', entities: [{ id: 'p', sprite: { x: 0, y: 0 } }] }],
        skills: [
          {
            id: 's',
            trigger: { kind: 'onKey', key: 'SPACE' },
            effects: [{ kind: 'addScore', payload: { delta: 1, winAt: 5 } }],
          },
        ],
      }),
      'utf8',
    );
    fs.writeFileSync(
      path.join(dir, 'src', 'main.ts'),
      `import { bootstrap } from '@opengame/runtime/bootstrap';
import { LevelScene } from './scenes/LevelScene.js';
await bootstrap({ source: './game.json', extraScenes: [LevelScene] });
`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(dir, 'src', 'scenes', 'LevelScene.ts'),
      `export class LevelScene { create() { this.registry.set('won', false); } }\n`,
      'utf8',
    );
    try {
      const result = await runGameQualityGate(dir, 'relaxed', {
        archetype: 'platformer',
        skipArchetypeSceneRules: true,
      });
      expect(result.issues.some((i) => i.includes('赶海'))).toBe(true);
    } finally {
      if (prev === undefined) delete process.env['PLATFORM_QUALITY_BEYOND_BASELINE'];
      else process.env['PLATFORM_QUALITY_BEYOND_BASELINE'] = prev;
    }
  });

  it('custom named loops cannot pass on registry.won alone', async () => {
    const prev = process.env['PLATFORM_QUALITY_BEYOND_BASELINE'];
    process.env['PLATFORM_QUALITY_BEYOND_BASELINE'] = 'true';
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-qa-custom-won-'));
    fs.mkdirSync(path.join(dir, 'public'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'src', 'scenes'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.opengame-mechanic.json'),
      JSON.stringify({
        schema: 'opengame-mechanic-v1',
        prompt: '赶海',
        space: 'side',
        time: 'realtime',
        input: 'keys',
        win: 'custom',
        loops: [
          {
            id: 'custom-赶海',
            label: '赶海',
            signals: ['赶海', "registry.set\\(\\s*['\"]won"],
            source: 'custom',
          },
        ],
        modules: ['platform'],
        archetypeHint: 'platformer',
        updatedAt: new Date().toISOString(),
      }),
      'utf8',
    );
    fs.writeFileSync(
      path.join(dir, 'public', 'game.json'),
      JSON.stringify({
        dslVersion: '1.0.0',
        meta: { title: 'Nope' },
        scenes: [{ id: 'LevelScene', entities: [{ id: 'p', sprite: { x: 0, y: 0 } }] }],
      }),
      'utf8',
    );
    fs.writeFileSync(
      path.join(dir, 'src', 'main.ts'),
      `import { bootstrap } from '@opengame/runtime/bootstrap';
import { LevelScene } from './scenes/LevelScene.js';
await bootstrap({ source: './game.json', extraScenes: [LevelScene] });
`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(dir, 'src', 'scenes', 'LevelScene.ts'),
      `export class LevelScene { create() { this.registry.set('won', true); } }\n`,
      'utf8',
    );
    try {
      const result = await runGameQualityGate(dir, 'relaxed', {
        archetype: 'platformer',
        skipArchetypeSceneRules: true,
      });
      expect(result.issues.some((i) => i.includes('赶海') && i.includes('不能只靠'))).toBe(
        true,
      );
    } finally {
      if (prev === undefined) delete process.env['PLATFORM_QUALITY_BEYOND_BASELINE'];
      else process.env['PLATFORM_QUALITY_BEYOND_BASELINE'] = prev;
    }
  });

  it('board-turn grid_logic does not require skills.winAt', async () => {
    const prev = process.env['PLATFORM_QUALITY_BEYOND_BASELINE'];
    process.env['PLATFORM_QUALITY_BEYOND_BASELINE'] = 'true';
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-qa-board-'));
    fs.mkdirSync(path.join(dir, 'public', 'assets'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'src', 'scenes'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'public', 'assets', 'player.png'), richPng());
    fs.writeFileSync(path.join(dir, 'public', 'BOARD_KERNEL.json'), '{"schema":"opengame-board-kernel-v1","kind":"xiangqi"}\n');
    fs.writeFileSync(
      path.join(dir, 'public', 'game.json'),
      JSON.stringify({
        dslVersion: '1.0.0',
        meta: { title: 'Xiangqi' },
        initialSceneId: 'BoardTurnScene',
        scenes: [{ id: 'BoardTurnScene', entities: [], hud: { score: true } }],
        assets: [{ id: 'player', kind: 'image', url: './assets/player.png' }],
      }),
      'utf8',
    );
    fs.writeFileSync(
      path.join(dir, 'src', 'main.ts'),
      `import { bootstrap } from '@opengame/runtime/bootstrap';
import { BoardTurnScene } from './scenes/BoardTurnScene.js';
await bootstrap({ source: './game.json', extraScenes: [BoardTurnScene] });
`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(dir, 'src', 'scenes', 'BoardTurnScene.ts'),
      `import { legalMoves } from '@opengame/module-board';
export class BoardTurnScene {
  create() { this.registry.set('won', false); legalMoves; }
}
`,
      'utf8',
    );
    try {
      const result = await runGameQualityGate(dir, 'relaxed', {
        archetype: 'grid_logic',
        skipArchetypeSceneRules: true,
      });
      expect(
        result.issues.some(
          (i) => i.includes('skills') || i.includes('winAt') || i.includes('空格加分'),
        ),
      ).toBe(false);
    } finally {
      if (prev === undefined) delete process.env['PLATFORM_QUALITY_BEYOND_BASELINE'];
      else process.env['PLATFORM_QUALITY_BEYOND_BASELINE'] = prev;
    }
  });
});
