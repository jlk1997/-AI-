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
  issuesFromJuiceBaseline,
  restoreJuiceFromBaseline,
  scanJuiceScenes,
  writeJuiceBaseline,
} from './juiceBaseline.js';

describe('juiceBaseline restore', () => {
  it('restores stripped PlatformSceneHelper from JUICE_BASELINE', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-juice-'));
    const scenes = path.join(dir, 'src', 'scenes');
    const pub = path.join(dir, 'public');
    fs.mkdirSync(scenes, { recursive: true });
    fs.mkdirSync(pub, { recursive: true });

    fs.writeFileSync(
      path.join(scenes, 'Level1Scene.ts'),
      `import Phaser from 'phaser';
import { PlatformSceneHelper } from '@opengame/module-platform';
export class Level1Scene extends Phaser.Scene {
  constructor() { super('Level1Scene'); }
  preload(): void {
    PlatformSceneHelper.preloadGameAudio(this);
    PlatformSceneHelper.preloadGameArt(this);
  }
  create(): void {
    PlatformSceneHelper.ensureBgm(this);
    PlatformSceneHelper.installPauseMenu(this);
    this.cameras.main.setBackgroundColor('#111');
  }
}
`,
      'utf8',
    );

    const baseline = await writeJuiceBaseline(dir);
    expect(baseline?.scenes).toContain('Level1Scene.ts');
    expect(await scanJuiceScenes(dir)).toContain('Level1Scene.ts');

    // CODE strips juice into mute color block
    fs.writeFileSync(
      path.join(scenes, 'Level1Scene.ts'),
      `import Phaser from 'phaser';
export class Level1Scene extends Phaser.Scene {
  constructor() { super('Level1Scene'); }
  create(): void {
    this.cameras.main.setBackgroundColor('#000');
  }
}
`,
      'utf8',
    );
    expect(await scanJuiceScenes(dir)).not.toContain('Level1Scene.ts');
    const issues = await issuesFromJuiceBaseline(dir);
    expect(issues.some((i) => /Juice/.test(i))).toBe(true);

    const { patches, restored } = await restoreJuiceFromBaseline(dir);
    expect(restored).toContain('Level1Scene.ts');
    expect(patches.some((p) => p.includes('juice-restore'))).toBe(true);

    const src = fs.readFileSync(path.join(scenes, 'Level1Scene.ts'), 'utf8');
    expect(src).toMatch(/PlatformSceneHelper/);
    expect(src).toMatch(/preloadGameAudio/);
    expect(src).toMatch(/ensureBgm|installPauseMenu/);
    expect(await scanJuiceScenes(dir)).toContain('Level1Scene.ts');
    expect(await issuesFromJuiceBaseline(dir)).toEqual([]);
  });
});
