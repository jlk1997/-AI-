/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';

import {
  isRetiredMinimaxMusicError,
  listMinimaxAudioApiKeys,
  listMinimaxImageApiKeys,
  minimaxGenerateImagePng,
  resetMinimaxQuotaStickyKeys,
  takeProviderFailoverNotes,
  tryMinimaxGenerateMusicMp3,
} from './minimaxClient.js';

async function fakeSeedreamJpeg(): Promise<Buffer> {
  const w = 64;
  const h = 64;
  const rgb = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    rgb[i * 3] = (i * 13) % 256;
    rgb[i * 3 + 1] = (i * 29) % 256;
    rgb[i * 3 + 2] = (i * 53) % 256;
  }
  return sharp(rgb, { raw: { width: w, height: h, channels: 3 } })
    .jpeg()
    .toBuffer();
}

async function fakePng(): Promise<Buffer> {
  return sharp({
    create: {
      width: 32,
      height: 32,
      channels: 4,
      background: { r: 20, g: 120, b: 200, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
}

describe('minimaxClient failover', () => {
  const prev = {
    mm: process.env['MINIMAX_API_KEY'],
    img: process.env['OPENGAME_IMAGE_API_KEY'],
    imgKeys: process.env['OPENGAME_IMAGE_API_KEYS'],
    fb: process.env['OPENGAME_FALLBACK_API_KEY'],
    fbUrl: process.env['OPENGAME_FALLBACK_BASE_URL'],
    ark: process.env['OPENGAME_ARK_API_KEY'],
    arkUrl: process.env['OPENGAME_ARK_BASE_URL'],
  };

  beforeEach(() => {
    process.env['MINIMAX_API_KEY'] = 'mm-test';
    process.env['OPENGAME_IMAGE_API_KEY'] = 'mm-test';
    delete process.env['OPENGAME_IMAGE_API_KEYS'];
    process.env['OPENGAME_FALLBACK_API_KEY'] = 'sk-mm-spare';
    process.env['OPENGAME_FALLBACK_BASE_URL'] = 'https://api.minimaxi.com/v1';
    delete process.env['OPENGAME_ARK_API_KEY'];
    delete process.env['OPENGAME_ARK_BASE_URL'];
    resetMinimaxQuotaStickyKeys();
    takeProviderFailoverNotes();
  });

  afterEach(() => {
    for (const [k, v] of Object.entries({
      MINIMAX_API_KEY: prev.mm,
      OPENGAME_IMAGE_API_KEY: prev.img,
      OPENGAME_IMAGE_API_KEYS: prev.imgKeys,
      OPENGAME_FALLBACK_API_KEY: prev.fb,
      OPENGAME_FALLBACK_BASE_URL: prev.fbUrl,
      OPENGAME_ARK_API_KEY: prev.ark,
      OPENGAME_ARK_BASE_URL: prev.arkUrl,
    })) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    vi.unstubAllGlobals();
    resetMinimaxQuotaStickyKeys();
    takeProviderFailoverNotes();
  });

  it('lists MiniMax FALLBACK keys and excludes Ark-hosted FALLBACK keys', () => {
    process.env['OPENGAME_FALLBACK_API_KEY'] = 'sk-mm-second';
    process.env['OPENGAME_FALLBACK_BASE_URL'] = 'https://api.minimaxi.com/v1';
    const keys = listMinimaxImageApiKeys();
    expect(keys).toContain('mm-test');
    expect(keys).toContain('sk-mm-second');

    process.env['OPENGAME_FALLBACK_API_KEY'] = 'ark-only';
    process.env['OPENGAME_FALLBACK_BASE_URL'] =
      'https://ark.cn-beijing.volces.com/api/v3';
    expect(listMinimaxImageApiKeys()).not.toContain('ark-only');
  });

  it('omits MiniMax FALLBACK audio keys when includeFallback is false', () => {
    process.env['OPENGAME_AUDIO_API_KEY'] = 'mm-audio';
    process.env['OPENGAME_AUDIO_FALLBACK_API_KEY'] = 'sk-mm-audio-fb';
    process.env['OPENGAME_AUDIO_FALLBACK_BASE_URL'] = 'https://api.minimaxi.com/v1';
    expect(
      listMinimaxAudioApiKeys(process.env, { includeFallback: false }),
    ).not.toContain('sk-mm-audio-fb');
  });

  it('omits MiniMax FALLBACK keys when includeFallback is false', () => {
    process.env['OPENGAME_FALLBACK_API_KEY'] = 'sk-mm-second';
    process.env['OPENGAME_FALLBACK_BASE_URL'] = 'https://api.minimaxi.com/v1';
    expect(
      listMinimaxImageApiKeys(process.env, { includeFallback: false }),
    ).not.toContain('sk-mm-second');
  });

  it('fails over image MiniMax invalid api key (2049) → second MiniMax key', async () => {
    process.env['OPENGAME_FALLBACK_API_KEY'] = 'sk-mm-2222';
    process.env['OPENGAME_FALLBACK_BASE_URL'] = 'https://api.minimaxi.com/v1';
    const png = await fakePng();
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string | URL, init?: RequestInit) => {
        calls += 1;
        const auth = String(
          (init?.headers as Record<string, string>)?.Authorization ?? '',
        );
        if (auth.includes('mm-test')) {
          return {
            ok: true,
            json: async () => ({
              base_resp: {
                status_code: 2049,
                status_msg: 'invalid api key',
              },
            }),
          };
        }
        return {
          ok: true,
          json: async () => ({
            data: { image_base64: [png.toString('base64')] },
            base_resp: { status_code: 0 },
          }),
        };
      }),
    );

    const out = await minimaxGenerateImagePng({ prompt: 'hero sprite' });
    expect(out[0]).toBe(0x89);
    expect(calls).toBe(2);
    const notes = takeProviderFailoverNotes();
    expect(notes.some((n) => /silent rotate|→…2222|2049|invalid/i.test(n))).toBe(
      true,
    );

    // Sticky: second slot should not re-hit invalid primary.
    calls = 0;
    await minimaxGenerateImagePng({ prompt: 'enemy sprite' });
    expect(calls).toBe(1);
  });

  it('fails over image MiniMax quota → second MiniMax key', async () => {
    process.env['OPENGAME_FALLBACK_API_KEY'] = 'sk-mm-2222';
    process.env['OPENGAME_FALLBACK_BASE_URL'] = 'https://api.minimaxi.com/v1';
    const png = await fakePng();
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string | URL, init?: RequestInit) => {
        calls += 1;
        const auth = String(
          (init?.headers as Record<string, string>)?.Authorization ?? '',
        );
        if (auth.includes('mm-test')) {
          return {
            ok: true,
            json: async () => ({
              base_resp: {
                status_code: 2056,
                status_msg: '已达到 Token Plan 用量上限',
              },
            }),
          };
        }
        return {
          ok: true,
          json: async () => ({
            data: { image_base64: [png.toString('base64')] },
            base_resp: { status_code: 0 },
          }),
        };
      }),
    );

    const out = await minimaxGenerateImagePng({ prompt: 'hero sprite' });
    expect(out[0]).toBe(0x89);
    expect(calls).toBe(2);
    const notes = takeProviderFailoverNotes();
    expect(notes.some((n) => /silent rotate|→…2222/i.test(n))).toBe(true);

    // Sticky: second slot should not re-hit exhausted primary.
    calls = 0;
    await minimaxGenerateImagePng({ prompt: 'enemy sprite' });
    expect(calls).toBe(1);
  });

  it('fails over image MiniMax → opt-in Ark when OPENGAME_ARK_* is set', async () => {
    process.env['OPENGAME_FALLBACK_API_KEY'] = 'sk-mm-only';
    process.env['OPENGAME_FALLBACK_BASE_URL'] = 'https://api.minimaxi.com/v1';
    process.env['OPENGAME_ARK_API_KEY'] = 'ark-test';
    process.env['OPENGAME_ARK_BASE_URL'] =
      'https://ark.cn-beijing.volces.com/api/v3';
    const jpeg = await fakeSeedreamJpeg();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        const u = String(url);
        if (u.includes('image_generation')) {
          return {
            ok: true,
            json: async () => ({
              base_resp: {
                status_code: 2056,
                status_msg: '已达到 Token Plan 用量上限',
              },
            }),
          };
        }
        if (u.includes('/images/generations')) {
          return {
            ok: true,
            json: async () => ({
              data: [{ b64_json: jpeg.toString('base64') }],
            }),
          };
        }
        return { ok: false, text: async () => 'unexpected' };
      }),
    );

    const out = await minimaxGenerateImagePng({ prompt: 'hero sprite' });
    expect(out[0]).toBe(0x89);
    expect(out.length).toBeGreaterThan(100);
    const notes = takeProviderFailoverNotes();
    expect(notes.some((n) => /minimax→doubao|ark|Seedream/i.test(n))).toBe(
      true,
    );
  });

  it('soft-skips music on MiniMax quota after all keys', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          base_resp: {
            status_code: 2056,
            status_msg: 'Token Plan usage limit',
          },
        }),
      })),
    );
    const buf = await tryMinimaxGenerateMusicMp3({ prompt: 'loopable bgm' });
    expect(buf).toBeNull();
    const notes = takeProviderFailoverNotes();
    expect(notes.some((n) => /音效已跳过|沿用已有音乐|全部用尽|soft-skip|exhausted/i.test(n))).toBe(
      true,
    );
  });

  it('soft-skips music when MiniMax Music API is retired (410 / 2153)', async () => {
    const retired = new Error(
      'MiniMax music HTTP 410: {"base_resp":{"status_code":2153,"status_msg":"This Music API is no longer available to new users."}}',
    );
    expect(isRetiredMinimaxMusicError(retired)).toBe(true);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 410,
        text: async () =>
          JSON.stringify({
            base_resp: {
              status_code: 2153,
              status_msg:
                'This Music API is no longer available to new users. Existing paying customers can continue to use the service.',
            },
          }),
      })),
    );
    const buf = await tryMinimaxGenerateMusicMp3({ prompt: 'loopable bgm' });
    expect(buf).toBeNull();
    const notes = takeProviderFailoverNotes();
    expect(notes.some((n) => /旧音乐接口已下线|沿用已有音乐|410/i.test(n))).toBe(
      true,
    );
  });

  it('soft-skips music on any MiniMax transport failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('fetch failed');
      }),
    );
    const buf = await tryMinimaxGenerateMusicMp3({ prompt: 'loopable bgm' });
    expect(buf).toBeNull();
    const notes = takeProviderFailoverNotes();
    expect(notes.some((n) => /沿用已有音乐|接口失败/i.test(n))).toBe(true);
  });
});
