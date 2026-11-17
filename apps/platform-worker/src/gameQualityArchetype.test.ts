/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  detectFakeHudButtons,
  extractJsStringLiterals,
} from './gameQualityArchetype.js';

describe('extractJsStringLiterals', () => {
  it('does not span across code between quotes', () => {
    const src = `this.refresh('ok');\nthis.turns.start();\nthis.refresh('next');`;
    const lit = extractJsStringLiterals(src);
    expect(lit).toEqual(['ok', 'next']);
  });
});

describe('detectFakeHudButtons', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  async function writeScene(name: string, body: string): Promise<string> {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'og-fakehud-'));
    dirs.push(root);
    const scenes = path.join(root, 'src', 'scenes');
    await fsp.mkdir(scenes, { recursive: true });
    await fsp.writeFile(path.join(scenes, name), body, 'utf8');
    return root;
  }

  it('ignores scene.start / dialogue.start next to stroked rects', async () => {
    const ws = await writeScene(
      'ChapterScene.ts',
      `
      export class ChapterScene {
        create() {
          this.add.rectangle(0,0,10,10).setStrokeStyle(1, 0xffffff);
          this.add.text(0, 0, 'SPACE 推进');
          this.dialogue.start();
          this.scene.start('BattleScene');
        }
      }
      `,
    );
    expect(await detectFakeHudButtons(ws)).toEqual([]);
  });

  it('flags real START label chrome without setInteractive', async () => {
    const ws = await writeScene(
      'TitleScene.ts',
      `
      export class TitleScene {
        create() {
          this.add.rectangle(100,100,80,40).setStrokeStyle(2, 0x00ff00);
          this.add.text(100, 100, 'START');
        }
      }
      `,
    );
    const issues = await detectFakeHudButtons(ws);
    expect(issues.some((i) => i.includes('假按钮'))).toBe(true);
  });

  it('allows START chrome when setInteractive is present', async () => {
    const ws = await writeScene(
      'TitleScene.ts',
      `
      export class TitleScene {
        create() {
          this.add.rectangle(100,100,80,40).setStrokeStyle(2, 0x00ff00).setInteractive();
          this.add.text(100, 100, 'START');
        }
      }
      `,
    );
    expect(await detectFakeHudButtons(ws)).toEqual([]);
  });
});
