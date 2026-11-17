/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { defaultWalkLayout } from '@opengame/asset-forge';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';

import { composeWalkSheet, walkRealPoseCount } from './walkSheet.js';

/** Asymmetric mark so a horizontal mirror is detectable. */
async function markerPng(): Promise<Buffer> {
  const w = 32;
  const h = 32;
  const raw = Buffer.alloc(w * h * 4, 0);
  for (let y = 8; y < 24; y++) {
    for (let x = 8; x < 16; x++) {
      const o = (y * w + x) * 4;
      raw[o] = 240;
      raw[o + 3] = 255;
    }
  }
  return sharp(raw, { raw: { width: w, height: h, channels: 4 } })
    .png()
    .toBuffer();
}

async function frameHashes(
  sheet: string,
  layout: ReturnType<typeof defaultWalkLayout>,
  row: number,
): Promise<string[]> {
  const out: string[] = [];
  for (let col = 0; col < layout.framesPerDir; col++) {
    const buf = await sharp(sheet)
      .extract({
        left: col * layout.frameWidth,
        top: row * layout.frameHeight,
        width: layout.frameWidth,
        height: layout.frameHeight,
      })
      .raw()
      .toBuffer();
    out.push(createHash('sha1').update(buf).digest('hex'));
  }
  return out;
}

let tmp: string | null = null;

afterEach(async () => {
  if (tmp) await fsp.rm(tmp, { recursive: true, force: true });
  tmp = null;
});

describe('composeWalkSheet', () => {
  it('derives a moving cycle from a single still', async () => {
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'og-walk-'));
    const dest = path.join(tmp, 'walk.png');
    const layout = defaultWalkLayout(48, 64);
    await composeWalkSheet({
      dest,
      renders: new Map(),
      base: await markerPng(),
      layout,
      pixelPerfect: false,
    });
    const meta = await sharp(dest).metadata();
    expect(meta.width).toBe(layout.sheetWidth);
    expect(meta.height).toBe(layout.sheetHeight);

    // Front row (mirrorable): the third slot is the contact pose flipped.
    const front = await frameHashes(dest, layout, 0);
    expect(new Set(front).size).toBeGreaterThan(1);

    // Side row cannot mirror, but must still differ frame to frame.
    const side = await frameHashes(
      dest,
      layout,
      layout.directions.indexOf('left'),
    );
    expect(new Set(side).size).toBeGreaterThan(1);
  });

  it('places one real render per slot when the model drew the cycle', async () => {
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'og-walk-'));
    const dest = path.join(tmp, 'walk.png');
    const layout = defaultWalkLayout(48, 64);
    const solid = async (r: number): Promise<Buffer> =>
      sharp({
        create: {
          width: 32,
          height: 32,
          channels: 4,
          background: { r, g: 0, b: 0, alpha: 1 },
        },
      })
        .png()
        .toBuffer();
    const three = [await solid(60), await solid(150), await solid(240)];
    const renders = new Map(
      layout.directions.map((d) => [d, three] as const),
    );
    await composeWalkSheet({
      dest,
      renders,
      layout,
      pixelPerfect: false,
    });
    const front = await frameHashes(dest, layout, 0);
    expect(new Set(front).size).toBe(3);
  });

  it('spends fewer model renders on background NPCs than on the hero', () => {
    delete process.env['PLATFORM_WALK_REAL_POSES'];
    delete process.env['PLATFORM_WALK_REAL_POSES_NPC'];
    expect(walkRealPoseCount(3, 'hero')).toBe(2);
    expect(walkRealPoseCount(3, 'npc')).toBe(1);
    expect(walkRealPoseCount(1, 'hero')).toBe(1);
  });
});
