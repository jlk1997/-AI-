/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import sharp from 'sharp';

import {
  defringeSpritePng,
  isFullyOpaquePng,
  matteRoleForAssetId,
  shouldMatteAsset,
  slotMetaForId,
} from './assetMatte.js';
import { detectOpaqueSpriteAssets } from './gameQualityArchetype.js';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

describe('assetMatte policy', () => {
  it('classifies scene vs sprite roles', () => {
    expect(matteRoleForAssetId('background')).toBe('scene');
    expect(matteRoleForAssetId('og_bg')).toBe('scene');
    expect(matteRoleForAssetId('ground.png')).toBe('scene');
    expect(matteRoleForAssetId('player')).toBe('sprite');
    expect(matteRoleForAssetId('player_run.png')).toBe('sprite');
    expect(matteRoleForAssetId('enemy')).toBe('sprite');
    expect(matteRoleForAssetId('item')).toBe('sprite');
  });

  it('respects keepBackground for sprites', () => {
    expect(shouldMatteAsset('player')).toBe(true);
    expect(shouldMatteAsset('player', { keepBackground: true })).toBe(false);
    expect(shouldMatteAsset('background')).toBe(false);
  });

  it('slotMetaForId includes pose for player variants', () => {
    expect(slotMetaForId('player')).toEqual({
      role: 'sprite',
      matte: true,
      pose: 'idle',
    });
    expect(slotMetaForId('player_run')).toEqual({
      role: 'sprite',
      matte: true,
      pose: 'run',
    });
    expect(slotMetaForId('background')).toEqual({
      role: 'scene',
      matte: false,
    });
  });

  it('isFullyOpaquePng detects alpha vs opaque', async () => {
    const opaque = await sharp({
      create: {
        width: 8,
        height: 8,
        channels: 3,
        background: { r: 255, g: 0, b: 0 },
      },
    })
      .png()
      .toBuffer();
    expect(await isFullyOpaquePng(opaque)).toBe(true);

    const transparent = await sharp({
      create: {
        width: 8,
        height: 8,
        channels: 4,
        background: { r: 0, g: 255, b: 0, alpha: 0 },
      },
    })
      .png()
      .toBuffer();
    expect(await isFullyOpaquePng(transparent)).toBe(false);
  });
});

describe('defringeSpritePng', () => {
  /** A red blob on white with a half-alpha ring — what imgly hands back. */
  async function haloedSprite(): Promise<Buffer> {
    const w = 16;
    const h = 16;
    const raw = Buffer.alloc(w * h * 4, 0);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        const inCore = x >= 5 && x <= 10 && y >= 5 && y <= 10;
        const inRing = !inCore && x >= 4 && x <= 11 && y >= 4 && y <= 11;
        if (inCore) {
          raw[o] = 200;
          raw[o + 1] = 20;
          raw[o + 2] = 20;
          raw[o + 3] = 255;
        } else if (inRing) {
          // 50% coverage over white: (200,20,20)*0.5 + 255*0.5
          raw[o] = 228;
          raw[o + 1] = 138;
          raw[o + 2] = 138;
          raw[o + 3] = 128;
        }
      }
    }
    return sharp(raw, { raw: { width: w, height: h, channels: 4 } })
      .png()
      .toBuffer();
  }

  async function rgbaAt(
    png: Buffer,
    x: number,
    y: number,
  ): Promise<[number, number, number, number]> {
    const { data, info } = await sharp(png)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const o = (y * info.width + x) * 4;
    return [
      data[o] ?? 0,
      data[o + 1] ?? 0,
      data[o + 2] ?? 0,
      data[o + 3] ?? 0,
    ];
  }

  it('un-composites the white halo out of semi-transparent edges', async () => {
    const before = await haloedSprite();
    const [, gBefore] = await rgbaAt(before, 4, 8);
    expect(gBefore).toBeGreaterThan(120);

    const after = await defringeSpritePng(before);
    const [r, g, b] = await rgbaAt(after, 4, 8);
    // Edge should now read as the subject colour, not a wash of white.
    expect(g).toBeLessThan(80);
    expect(b).toBeLessThan(80);
    expect(r).toBeGreaterThan(g + 60);
  });

  it('keeps the opaque core and feathers without growing the silhouette',
    async () => {
      const after = await defringeSpritePng(await haloedSprite());
      expect((await rgbaAt(after, 8, 8))[3]).toBe(255);
      // The ring is eroded, never expanded past its original bounds.
      expect((await rgbaAt(after, 2, 8))[3]).toBe(0);
      // Outer corners of the blended ring lose coverage; the straight edge next
      // to the solid core keeps its soft transition.
      expect((await rgbaAt(after, 4, 4))[3]).toBeLessThan(128);
      expect((await rgbaAt(after, 4, 8))[3]).toBeLessThanOrEqual(128);
    });

  it('bleeds subject colour into transparent neighbours', async () => {
    const after = await defringeSpritePng(await haloedSprite());
    const [r, , , a] = await rgbaAt(after, 3, 8);
    expect(a).toBe(0);
    // Transparent, but carrying colour so bilinear scaling cannot pull black.
    expect(r).toBeGreaterThan(0);
  });
});

describe('detectOpaqueSpriteAssets', () => {
  it('flags opaque player.png and ignores background', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'og-matte-'));
    const assets = path.join(root, 'public', 'assets');
    await fsp.mkdir(assets, { recursive: true });
    const opaque = await sharp({
      create: {
        width: 16,
        height: 16,
        channels: 3,
        background: { r: 10, g: 20, b: 30 },
      },
    })
      .png()
      .toBuffer();
    await fsp.writeFile(path.join(assets, 'player.png'), opaque);
    await fsp.writeFile(path.join(assets, 'background.png'), opaque);
    const issues = await detectOpaqueSpriteAssets(root);
    expect(issues.some((i) => i.includes('player.png'))).toBe(true);
    expect(issues.some((i) => i.includes('background.png'))).toBe(false);
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('passes when player has transparency', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'og-matte-'));
    const assets = path.join(root, 'public', 'assets');
    await fsp.mkdir(assets, { recursive: true });
    // Mostly transparent with a small opaque core
    const buf = Buffer.alloc(16 * 16 * 4, 0);
    for (let i = 0; i < 16 * 16; i++) {
      buf[i * 4 + 3] = i % 3 === 0 ? 255 : 0;
      buf[i * 4] = 255;
    }
    const png = await sharp(buf, { raw: { width: 16, height: 16, channels: 4 } })
      .png()
      .toBuffer();
    await fsp.writeFile(path.join(assets, 'player.png'), png);
    const issues = await detectOpaqueSpriteAssets(root);
    expect(issues).toEqual([]);
    await fsp.rm(root, { recursive: true, force: true });
  });
});
