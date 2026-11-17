/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import sharp from 'sharp';
import { runGameAssetPhase } from './gameAssetPhase.js';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

async function fakeRichPng(): Promise<Buffer> {
  const w = 256;
  const h = 256;
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = (i * 37) & 0xff;
    rgba[i * 4 + 1] = (i * 17) & 0xff;
    rgba[i * 4 + 2] = (i * 53) & 0xff;
    rgba[i * 4 + 3] = 255;
  }
  return sharp(rgba, { raw: { width: w, height: h, channels: 4 } })
    .png({ compressionLevel: 0 })
    .toBuffer();
}

describe('gameAssetPhase MiniMax', () => {
  const prevKey = process.env['MINIMAX_API_KEY'];
  const prevReq = process.env['PLATFORM_REQUIRE_REAL_ASSETS'];

  beforeEach(() => {
    process.env['MINIMAX_API_KEY'] = 'test-key';
    process.env['PLATFORM_REQUIRE_REAL_ASSETS'] = 'true';
  });

  afterEach(() => {
    if (prevKey === undefined) delete process.env['MINIMAX_API_KEY'];
    else process.env['MINIMAX_API_KEY'] = prevKey;
    if (prevReq === undefined) delete process.env['PLATFORM_REQUIRE_REAL_ASSETS'];
    else process.env['PLATFORM_REQUIRE_REAL_ASSETS'] = prevReq;
    vi.unstubAllGlobals();
  });

  it(
    'seeds player/background + audio and patches game.json',
    { timeout: 60_000 },
    async () => {
    process.env['PLATFORM_ASSET_IMAGE_CONCURRENCY'] = '2';
    const png = await fakeRichPng();
    const audio = Buffer.alloc(10_000, 7);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        const u = String(url);
        if (u.includes('image_generation')) {
          return {
            ok: true,
            json: async () => ({
              base_resp: { status_code: 0 },
              data: { image_base64: [png.toString('base64')] },
            }),
          };
        }
        if (u.includes('music_generation') || u.includes('t2a_v2')) {
          return {
            ok: true,
            json: async () => ({
              base_resp: { status_code: 0 },
              data: { status: 2, audio: audio.toString('hex') },
            }),
          };
        }
        return { ok: false, text: async () => 'nope' };
      }),
    );

    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'og-game-mm-'));
    await fsp.mkdir(path.join(dir, 'public'), { recursive: true });
    await fsp.writeFile(
      path.join(dir, 'public', 'game.json'),
      JSON.stringify({
        meta: { title: 'MiniMax Game' },
        scenes: [
          {
            id: 'main',
            entities: [
              {
                id: 'player',
                tags: ['player'],
                sprite: { shape: 'rect', color: '#fbbf24', x: 100, y: 200 },
              },
              {
                id: 'slime',
                tags: ['enemy'],
                sprite: { shape: 'rect', color: '#ef4444', x: 300, y: 200 },
              },
              {
                id: 'coin1',
                tags: ['item'],
                sprite: { shape: 'circle', color: '#fde047', x: 400, y: 200 },
              },
            ],
          },
        ],
        assets: [],
        gameFlow: { should: 'be_stripped' },
      }),
      'utf8',
    );

    const res = await runGameAssetPhase(dir, { keepBackground: true });
    expect(res.quality).toBe('minimax');
    expect(res.failoverEvents).toEqual([]);
    expect(res.patchedGameJson).toBe(true);
    expect(res.files.some((f) => f.includes('player.png'))).toBe(true);
    expect(res.files.some((f) => f.includes('bgm.mp3'))).toBe(true);

    const dsl = JSON.parse(
      await fsp.readFile(path.join(dir, 'public', 'game.json'), 'utf8'),
    ) as {
      assets: Array<{ id: string; kind: string; url: string }>;
      audioTracks: Array<{ assetId: string }>;
      gameFlow?: unknown;
      scenes: Array<{
        entities: Array<{ sprite?: { assetId?: string; shape?: string } }>;
      }>;
    };
    expect(dsl.assets.some((a) => a.id === 'player' && a.kind === 'image')).toBe(
      true,
    );
    expect(dsl.assets.some((a) => a.id === 'bgm' && a.kind === 'audio')).toBe(
      true,
    );
    expect(dsl.audioTracks.some((t) => t.assetId === 'bgm')).toBe(true);
    expect(dsl.assets.some((a) => a.id === 'sfx_coin')).toBe(true);
    expect(dsl.gameFlow).toBeUndefined();
    expect(dsl.scenes[0]?.entities[0]?.sprite?.assetId).toBe('player');
    expect(dsl.scenes[0]?.entities[1]?.sprite?.assetId).toBe('enemy');
    expect(dsl.scenes[0]?.entities[2]?.sprite?.assetId).toBe('item');
    expect(dsl.scenes[0]?.entities[0]?.sprite?.shape).toBeUndefined();
    expect(dsl.scenes[0]?.entities[1]?.sprite?.shape).toBeUndefined();
    expect(res.files.some((f) => f.includes('enemy.png'))).toBe(true);
    expect(res.files.some((f) => f.includes('item.png'))).toBe(true);

    const brief = JSON.parse(
      await fsp.readFile(path.join(dir, 'public', 'ASSET_BRIEF.json'), 'utf8'),
    ) as { assetQuality: string };
    expect(brief.assetQuality).toBe('minimax');
  },
  );
});
