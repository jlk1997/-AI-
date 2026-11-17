/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * When MiniMax music/speech cannot mint a new file, keep a real MP3:
 * this workspace's last track → last-good cache → a neighbor town's
 * MiniMax file → the checked-in seed pack (also MiniMax-era audio).
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { probeAudioBuffer } from './assetAuthenticity.js';
import { loadAudioQuotaSeed } from './audioQuotaSeed.js';

export type KeptAudioKind = 'workspace' | 'cache' | 'neighbor' | 'seed';

const CACHE_DIR_NAME = '.opengame-audio-cache';

export function lastGoodAudioDir(): string {
  const env = process.env['OPENGAME_AUDIO_CACHE_DIR']?.trim();
  if (env) return path.resolve(env);
  const workRoot = process.env['PLATFORM_WORK_ROOT']?.trim();
  if (workRoot) return path.join(path.resolve(workRoot), CACHE_DIR_NAME);
  return path.join(os.tmpdir(), 'opengame-audio-cache');
}

function cachePath(fileName: string): string {
  return path.join(lastGoodAudioDir(), path.basename(fileName));
}

async function readIfValidAudio(full: string): Promise<Buffer | null> {
  if (!fs.existsSync(full)) return null;
  const buf = await fsp.readFile(full);
  return probeAudioBuffer(buf).ok ? buf : null;
}

export async function rememberLastGoodAudio(
  fileName: string,
  buf: Buffer,
): Promise<void> {
  if (!probeAudioBuffer(buf).ok) return;
  const dest = cachePath(fileName);
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  await fsp.writeFile(dest, buf);
}

export async function loadLastGoodAudio(
  fileName: string,
): Promise<Buffer | null> {
  return readIfValidAudio(cachePath(fileName));
}

async function harvestNeighborAudio(
  fileName: string,
  excludePath: string,
): Promise<Buffer | null> {
  const workRoot = process.env['PLATFORM_WORK_ROOT']?.trim();
  if (!workRoot) return null;
  const projects = path.join(path.resolve(workRoot), 'projects');
  if (!fs.existsSync(projects)) return null;
  const want = path.basename(fileName);
  const exclude = path.resolve(excludePath);
  let best: { readonly mtime: number; readonly buf: Buffer } | null = null;
  let scanned = 0;
  const dirs = await fsp.readdir(projects, { withFileTypes: true });
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    scanned += 1;
    if (scanned > 80) break;
    const full = path.join(projects, dir.name, 'repo', 'public', 'assets', want);
    if (path.resolve(full) === exclude) continue;
    const buf = await readIfValidAudio(full);
    if (!buf) continue;
    const mtime = (await fsp.stat(full)).mtimeMs;
    if (!best || mtime > best.mtime) best = { mtime, buf };
  }
  return best?.buf ?? null;
}

export async function resolveKeptAudio(input: {
  readonly destPath: string;
  readonly fileName: string;
}): Promise<{ readonly buf: Buffer; readonly kind: KeptAudioKind } | null> {
  const name = path.basename(input.fileName);
  const workspace = await readIfValidAudio(input.destPath);
  if (workspace) return { buf: workspace, kind: 'workspace' };
  const cache = await loadLastGoodAudio(name);
  if (cache) return { buf: cache, kind: 'cache' };
  const neighbor = await harvestNeighborAudio(name, input.destPath);
  if (neighbor) return { buf: neighbor, kind: 'neighbor' };
  const seed = await loadAudioQuotaSeed(name);
  if (seed && probeAudioBuffer(seed).ok) return { buf: seed, kind: 'seed' };
  return null;
}

export async function writeAudioWithFallback(input: {
  readonly destPath: string;
  readonly rel: string;
  readonly fresh: Buffer | null;
  readonly written: string[];
  readonly failoverEvents: string[];
}): Promise<void> {
  const name = path.basename(input.destPath);
  if (input.fresh && probeAudioBuffer(input.fresh).ok) {
    await fsp.mkdir(path.dirname(input.destPath), { recursive: true });
    await fsp.writeFile(input.destPath, input.fresh);
    await rememberLastGoodAudio(name, input.fresh);
    input.written.push(input.rel);
    return;
  }
  const kept = await resolveKeptAudio({
    destPath: input.destPath,
    fileName: name,
  });
  if (!kept) {
    throw new Error(
      `ASSET ${input.rel}: MiniMax audio failed and no prior usable file`,
    );
  }
  if (kept.kind !== 'workspace') {
    await fsp.mkdir(path.dirname(input.destPath), { recursive: true });
    await fsp.writeFile(input.destPath, kept.buf);
  }
  input.failoverEvents.push(`audio ${name} api miss — ${kept.kind}`);
  input.written.push(`${input.rel} (${kept.kind})`);
}
