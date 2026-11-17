/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  rememberLastGoodAudio,
  resolveKeptAudio,
  writeAudioWithFallback,
} from './audioFallback.js';
import { loadAudioQuotaSeed } from './audioQuotaSeed.js';

describe('audioFallback', () => {
  const prevCache = process.env['OPENGAME_AUDIO_CACHE_DIR'];
  const prevWork = process.env['PLATFORM_WORK_ROOT'];
  let cacheDir = '';

  beforeEach(async () => {
    cacheDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'og-audio-cache-'));
    process.env['OPENGAME_AUDIO_CACHE_DIR'] = cacheDir;
    delete process.env['PLATFORM_WORK_ROOT'];
  });

  afterEach(() => {
    if (prevCache === undefined) delete process.env['OPENGAME_AUDIO_CACHE_DIR'];
    else process.env['OPENGAME_AUDIO_CACHE_DIR'] = prevCache;
    if (prevWork === undefined) delete process.env['PLATFORM_WORK_ROOT'];
    else process.env['PLATFORM_WORK_ROOT'] = prevWork;
  });

  it('keeps this workspace MiniMax file before cache or seed', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'og-audio-ws-'));
    const dest = path.join(dir, 'bgm.mp3');
    const prior = Buffer.alloc(9_000, 11);
    await fsp.writeFile(dest, prior);
    await rememberLastGoodAudio('bgm.mp3', Buffer.alloc(9_000, 22));
    const hit = await resolveKeptAudio({ destPath: dest, fileName: 'bgm.mp3' });
    expect(hit?.kind).toBe('workspace');
    expect(hit?.buf.equals(prior)).toBe(true);
  });

  it('reuses last-good MiniMax cache when the workspace file is gone', async () => {
    const cached = Buffer.alloc(9_000, 33);
    await rememberLastGoodAudio('bgm.mp3', cached);
    const dest = path.join(
      await fsp.mkdtemp(path.join(os.tmpdir(), 'og-audio-empty-')),
      'bgm.mp3',
    );
    const hit = await resolveKeptAudio({ destPath: dest, fileName: 'bgm.mp3' });
    expect(hit?.kind).toBe('cache');
    expect(hit?.buf.equals(cached)).toBe(true);
  });

  it('falls back to the MiniMax-era seed pack', async () => {
    const dest = path.join(
      await fsp.mkdtemp(path.join(os.tmpdir(), 'og-audio-seed-')),
      'bgm.mp3',
    );
    const hit = await resolveKeptAudio({ destPath: dest, fileName: 'bgm.mp3' });
    const seed = await loadAudioQuotaSeed('bgm.mp3');
    expect(hit?.kind).toBe('seed');
    expect(seed).not.toBeNull();
    expect(hit?.buf.equals(seed!)).toBe(true);
  });

  it('writes prior music when MiniMax returns nothing', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'og-audio-write-'));
    const dest = path.join(dir, 'bgm.mp3');
    await fsp.writeFile(dest, Buffer.alloc(9_000, 44));
    const written: string[] = [];
    const events: string[] = [];
    await writeAudioWithFallback({
      destPath: dest,
      rel: 'assets/bgm.mp3',
      fresh: null,
      written,
      failoverEvents: events,
    });
    expect(written).toEqual(['assets/bgm.mp3 (workspace)']);
    expect(events.some((e) => /workspace/.test(e))).toBe(true);
  });

  it('reuses a neighbor town MiniMax file when this workspace is empty', async () => {
    const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'og-work-'));
    process.env['PLATFORM_WORK_ROOT'] = work;
    const neighbor = path.join(
      work,
      'projects',
      'old-town',
      'repo',
      'public',
      'assets',
    );
    await fsp.mkdir(neighbor, { recursive: true });
    const prior = Buffer.alloc(9_000, 66);
    await fsp.writeFile(path.join(neighbor, 'bgm.mp3'), prior);
    const dest = path.join(
      work,
      'projects',
      'new-town',
      'repo',
      'public',
      'assets',
      'bgm.mp3',
    );
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    const hit = await resolveKeptAudio({ destPath: dest, fileName: 'bgm.mp3' });
    expect(hit?.kind).toBe('neighbor');
    expect(hit?.buf.equals(prior)).toBe(true);
  });

  it('remembers a fresh MiniMax file for the next miss', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'og-audio-fresh-'));
    const dest = path.join(dir, 'bgm.mp3');
    const fresh = Buffer.alloc(9_000, 55);
    await writeAudioWithFallback({
      destPath: dest,
      rel: 'assets/bgm.mp3',
      fresh,
      written: [],
      failoverEvents: [],
    });
    const other = path.join(
      await fsp.mkdtemp(path.join(os.tmpdir(), 'og-audio-next-')),
      'bgm.mp3',
    );
    const hit = await resolveKeptAudio({ destPath: other, fileName: 'bgm.mp3' });
    expect(hit?.kind).toBe('cache');
    expect(hit?.buf.equals(fresh)).toBe(true);
  });
});
