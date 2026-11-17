/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { deflateSync } from 'node:zlib';
import { runWorldAssetPhase } from './worldAssetPhase.js';
import { createEmptyTownWorld } from '@opengame/world-spec';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** Valid noisy PNG large enough to pass authenticity (not solid). */
function fakeRichPng(): Buffer {
  const w = 96;
  const h = 96;
  const stride = w * 3 + 1;
  const raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0;
    for (let x = 0; x < w; x++) {
      const i = y * stride + 1 + x * 3;
      raw[i] = (x * 37 + y * 13) & 0xff;
      raw[i + 1] = (x * 19 + y * 29) & 0xff;
      raw[i + 2] = (x * 7 + y * 53) & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

describe('worldAssetPhase MiniMax', () => {
  const prevKey = process.env['MINIMAX_API_KEY'];
  const prevImg = process.env['OPENGAME_IMAGE_API_KEY'];
  const prevReq = process.env['WORLD_REQUIRE_REAL_ASSETS'];
  const prevSkipWalk = process.env['PLATFORM_SKIP_WALK_ATLAS'];

  beforeEach(() => {
    process.env['MINIMAX_API_KEY'] = 'test-key';
    process.env['OPENGAME_IMAGE_API_KEY'] = 'test-key';
    process.env['WORLD_REQUIRE_REAL_ASSETS'] = 'true';
    process.env['PLATFORM_SKIP_WALK_ATLAS'] = 'true';
  });

  afterEach(() => {
    if (prevKey === undefined) delete process.env['MINIMAX_API_KEY'];
    else process.env['MINIMAX_API_KEY'] = prevKey;
    if (prevImg === undefined) delete process.env['OPENGAME_IMAGE_API_KEY'];
    else process.env['OPENGAME_IMAGE_API_KEY'] = prevImg;
    if (prevReq === undefined) delete process.env['WORLD_REQUIRE_REAL_ASSETS'];
    else process.env['WORLD_REQUIRE_REAL_ASSETS'] = prevReq;
    if (prevSkipWalk === undefined) delete process.env['PLATFORM_SKIP_WALK_ATLAS'];
    else process.env['PLATFORM_SKIP_WALK_ATLAS'] = prevSkipWalk;
    vi.unstubAllGlobals();
  });

  it(
    'writes minimax assets when API mocked',
    async () => {
    const png = fakeRichPng();
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
              data: {
                image_base64: [png.toString('base64')],
              },
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

    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'og-world-mm-'));
    const world = createEmptyTownWorld({ title: 'MiniMaxTown' });
    const res = await runWorldAssetPhase(dir, world);
    expect(res.files).toContain('assets/player.png');
    expect(res.files).toContain('assets/bgm.mp3');
    const brief = JSON.parse(
      await fsp.readFile(path.join(dir, 'public', 'ASSET_BRIEF.json'), 'utf8'),
    );
    expect(brief.placeholderQuality).toBeDefined();
    for (const e of brief.entities ?? []) {
      if (e.kind === 'npc' || e.kind === 'player') {
        expect(String(e.suggestedAsset)).not.toMatch(/\/npc\.png$/);
        expect(String(e.suggestedAsset)).not.toMatch(/_walk\.png$/);
      }
    }
  },
  // Real imgly matte + sharp defringe per sprite: ~15s alone, but it competes
  // with the rest of the suite for CPU.
  90_000,
);

  it('fails without API key', async () => {
    delete process.env['MINIMAX_API_KEY'];
    delete process.env['OPENGAME_IMAGE_API_KEY'];
    delete process.env['OPENGAME_AUDIO_API_KEY'];
    delete process.env['OPENAI_API_KEY'];
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'og-world-mm-nokey-'));
    const world = createEmptyTownWorld({ title: 'NoKey' });
    await expect(runWorldAssetPhase(dir, world)).rejects.toThrow(/API key/i);
  });
});
