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
  issuesFromArtStyleFingerprint,
  snapshotAssetFingerprintPrev,
  writeAssetFingerprint,
} from './assetFingerprint.js';

describe('assetFingerprint', () => {
  it('detects unchanged hashes after style swap when PREV matches', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-fp-'));
    const assets = path.join(dir, 'public', 'assets');
    const scenes = path.join(dir, 'src', 'scenes');
    fs.mkdirSync(assets, { recursive: true });
    fs.mkdirSync(scenes, { recursive: true });
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    fs.writeFileSync(path.join(assets, 'player.png'), png);
    fs.writeFileSync(path.join(assets, 'background.png'), png);
    fs.writeFileSync(
      path.join(scenes, 'Level1Scene.ts'),
      "PlatformSceneHelper.preloadGameArt(this); PlatformSceneHelper.spriteOrRect(this,0,0,'player',1,1,0);",
    );

    await writeAssetFingerprint(dir, 'pixel cozy');
    await snapshotAssetFingerprintPrev(dir);
    // Same bytes again — simulate failed cyber regen
    await writeAssetFingerprint(dir, 'cyberpunk neon');
    const issues = await issuesFromArtStyleFingerprint(dir, 'cyberpunk neon');
    expect(issues.some((i) => i.includes('哈希') || i.includes('未变化'))).toBe(
      true,
    );
  });

  it('passes when hashes change and Scene uses spriteOrRect', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-fp-ok-'));
    const assets = path.join(dir, 'public', 'assets');
    const scenes = path.join(dir, 'src', 'scenes');
    fs.mkdirSync(assets, { recursive: true });
    fs.mkdirSync(scenes, { recursive: true });
    const pngA = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    fs.writeFileSync(path.join(assets, 'player.png'), pngA);
    fs.writeFileSync(path.join(assets, 'background.png'), pngA);
    await writeAssetFingerprint(dir, 'pixel');
    await snapshotAssetFingerprintPrev(dir);
    // Different bytes
    const pngB = Buffer.concat([pngA, Buffer.from([1, 2, 3, 4])]);
    fs.writeFileSync(path.join(assets, 'player.png'), pngB);
    fs.writeFileSync(path.join(assets, 'background.png'), pngB);
    fs.writeFileSync(
      path.join(scenes, 'Level1Scene.ts'),
      "PlatformSceneHelper.spriteOrRect(this,0,0,'player',10,10,0xff);",
    );
    await writeAssetFingerprint(dir, 'cyberpunk neon');
    const issues = await issuesFromArtStyleFingerprint(dir, 'cyberpunk neon');
    expect(issues).toEqual([]);
  });
});
