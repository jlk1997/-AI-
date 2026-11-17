/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Reject solid-color / tiny procedural placeholders; require real MiniMax-sized assets.
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { inflateSync } from 'node:zlib';

export function requireRealAssets(): boolean {
  if (
    process.env['WORLD_ALLOW_PLACEHOLDER_ASSETS'] === 'true' ||
    process.env['PLATFORM_ALLOW_PLACEHOLDER_ASSETS'] === 'true'
  ) {
    return false;
  }
  return (
    process.env['WORLD_REQUIRE_REAL_ASSETS'] === 'true' ||
    process.env['WORLD_REQUIRE_REAL_ASSETS'] === '1' ||
    process.env['PLATFORM_REQUIRE_REAL_ASSETS'] === 'true' ||
    process.env['PLATFORM_REQUIRE_REAL_ASSETS'] === '1' ||
    process.env['PLATFORM_QUALITY_BEYOND_BASELINE'] === 'true' ||
    process.env['PLATFORM_GAME_QUALITY_MODE'] === 'strict'
  );
}

/** Minimum bytes for a non-toy PNG (procedural 32×32 solid is typically < 400B). */
export const MIN_REAL_PNG_BYTES = 2_500;
/** MiniMax MP3 BGM/SFX should be more than a few KB of silence. */
export const MIN_REAL_AUDIO_BYTES = 8_000;

export function probePngBuffer(buf: Buffer): { ok: boolean; reason?: string } {
  if (buf.length < MIN_REAL_PNG_BYTES) {
    return {
      ok: false,
      reason: `png too small (${buf.length}B < ${MIN_REAL_PNG_BYTES}) — likely procedural placeholder`,
    };
  }
  if (buf[0] !== 0x89 || buf[1] !== 0x50) {
    return { ok: false, reason: 'not a PNG' };
  }
  // Decode IDAT and sample unique colors — solid/near-solid fails
  try {
    const unique = samplePngUniqueColors(buf, 64);
    if (unique >= 0 && unique < 8) {
      return {
        ok: false,
        reason: `png near-solid (${unique} unique colors) — reject placeholder silhouette`,
      };
    }
  } catch {
    // If decode fails, size check already passed — allow
  }
  return { ok: true };
}

export async function probePngFile(
  filePath: string,
): Promise<{ ok: boolean; reason?: string }> {
  if (!fs.existsSync(filePath)) {
    return { ok: false, reason: `missing ${path.basename(filePath)}` };
  }
  const buf = await fsp.readFile(filePath);
  return probePngBuffer(buf);
}

export function probeAudioBuffer(buf: Buffer): { ok: boolean; reason?: string } {
  if (buf.length < MIN_REAL_AUDIO_BYTES) {
    return {
      ok: false,
      reason: `audio too small (${buf.length}B < ${MIN_REAL_AUDIO_BYTES}) — reject procedural beep`,
    };
  }
  return { ok: true };
}

export async function probeAudioFile(
  filePath: string,
): Promise<{ ok: boolean; reason?: string }> {
  if (!fs.existsSync(filePath)) {
    return { ok: false, reason: `missing ${path.basename(filePath)}` };
  }
  const buf = await fsp.readFile(filePath);
  return probeAudioBuffer(buf);
}

export function readAssetBriefQuality(workspace: string): string | null {
  const p = path.join(workspace, 'public', 'ASSET_BRIEF.json');
  if (!fs.existsSync(p)) return null;
  try {
    const j = JSON.parse(fs.readFileSync(p, 'utf8')) as {
      placeholderQuality?: string;
      assetQuality?: string;
    };
    return String(j.assetQuality ?? j.placeholderQuality ?? '');
  } catch {
    return null;
  }
}

/** Rough unique-color count from PNG IDAT (RGB / RGBA / grayscale). */
function samplePngUniqueColors(buf: Buffer, maxSide: number): number {
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 2; // default RGB
  const idats: Buffer[] = [];
  while (offset + 8 <= buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9] ?? 2;
    } else if (type === 'IDAT') {
      idats.push(Buffer.from(data));
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + len;
  }
  if (!width || !height || idats.length === 0) return -1;
  // bytes per pixel (no filter byte): 0=gray 2=RGB 4=grayA 6=RGBA
  const bpp =
    colorType === 0 ? 1 : colorType === 4 ? 2 : colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idats));
  const stride = width * bpp + 1;
  const colors = new Set<string>();
  const stepX = Math.max(1, Math.floor(width / maxSide));
  const stepY = Math.max(1, Math.floor(height / maxSide));
  for (let y = 0; y < height; y += stepY) {
    const row = y * stride;
    if (row >= raw.length) break;
    for (let x = 0; x < width; x += stepX) {
      const i = row + 1 + x * bpp;
      if (i + (bpp >= 3 ? 2 : 0) >= raw.length) break;
      if (bpp >= 3) {
        colors.add(`${raw[i]!},${raw[i + 1]!},${raw[i + 2]!}`);
      } else {
        colors.add(`${raw[i]!}`);
      }
      if (colors.size > 64) return colors.size;
    }
  }
  return colors.size;
}
