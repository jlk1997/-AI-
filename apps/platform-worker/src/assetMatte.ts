/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared matte policy: scene stays opaque; sprites get auto background removal.
 * Reuses @opengame/opengame-core BackgroundRemovalService (imgly / rembg).
 */

import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { BackgroundRemovalService } from '@opengame/opengame-core/dist/src/utils/backgroundRemoval.js';
import sharp from 'sharp';

export type AssetMatteRole = 'scene' | 'sprite';

export interface MatteSlotMeta {
  readonly role: AssetMatteRole;
  readonly matte: boolean;
  readonly pose?: 'idle' | 'run';
}

const SPRITE_IDS = new Set([
  'player',
  'player_run',
  'enemy',
  'item',
  'npc',
  'og_player',
  'og_player_run',
  'og_enemy',
  'og_item',
]);

const SCENE_IDS = new Set([
  'background',
  'og_bg',
  'ground',
  'wall',
  'tile',
  'bg_chapter_02',
  'bg_chapter_03',
  'bg_chapter_04',
  'bg_chapter_05',
]);

function isSceneMatteId(base: string): boolean {
  return SCENE_IDS.has(base) || /^bg_region_/i.test(base) || /^bg_chapter_/i.test(base);
}

let cachedService: BackgroundRemovalService | null = null;

function projectRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
}

function getService(): BackgroundRemovalService {
  if (!cachedService) {
    cachedService = new BackgroundRemovalService({
      projectRoot: projectRoot(),
      debug: process.env['PLATFORM_MATTE_DEBUG'] === '1',
      backend:
        process.env['BACKGROUND_REMOVAL_BACKEND'] === 'rembg' ? 'rembg' : 'imgly',
    });
  }
  return cachedService;
}

/** Classify asset id / filename into scene vs sprite. */
export function matteRoleForAssetId(idOrFile: string): AssetMatteRole {
  const base = path.basename(idOrFile).replace(/\.(png|jpe?g|webp)$/i, '');
  if (isSceneMatteId(base)) return 'scene';
  if (SPRITE_IDS.has(base)) return 'sprite';
  if (/^(ground|wall|bg|background|tile)/i.test(base)) return 'scene';
  if (/^npc_/i.test(base)) return 'sprite';
  return 'sprite';
}

export function shouldMatteAsset(
  idOrFile: string,
  opts?: { readonly keepBackground?: boolean },
): boolean {
  if (opts?.keepBackground) return false;
  return matteRoleForAssetId(idOrFile) === 'sprite';
}

export const SPRITE_PROMPT_SUFFIX =
  ' isolated on solid pure white background, single subject only, no ground plane filling the frame, no scenery, no text, no watermark, no logo, no badge, no chest emblem, no corner mark, face unobstructed, game sprite ready for chroma key';

export const SCENE_PROMPT_SUFFIX =
  ' fully opaque scenic illustration, edge-to-edge, NO transparency, NO characters, NO UI, NO text';

export interface ApplyMatteResult {
  readonly buffer: Buffer;
  readonly matted: boolean;
  readonly note?: string;
}

export interface DefringeOptions {
  /** Colour the model was told to paint behind the subject. */
  readonly background?: readonly [number, number, number];
  /** Alpha at or below this (0..255) is matte dust and gets cleared. */
  readonly floor?: number;
  /** Alpha at or above this counts as interior and is left untouched. */
  readonly solid?: number;
}

const DEFRINGE_FLOOR = 14;
const DEFRINGE_SOLID = 248;
const WHITE: readonly [number, number, number] = [255, 255, 255];

/**
 * Remove the light halo that background removal leaves behind.
 *
 * Sprites are generated on solid white (see {@link SPRITE_PROMPT_SUFFIX}), so an
 * edge pixel holds `subject * a + white * (1 - a)`. The matte gives it an alpha
 * but keeps that blended RGB, which reads as a white outline once the sprite
 * lands on a dark scene. Three passes fix it:
 *
 * 1. un-composite the edge RGB against the known background,
 * 2. erode/feather alpha with a 3x3 min-of-blur so the outermost blended ring
 *    goes away and the remaining edge is smooth rather than stair-stepped,
 * 3. bleed subject colour into fully transparent neighbours so GPU bilinear
 *    filtering samples the subject instead of black when the sprite is scaled.
 */
export async function defringeSpritePng(
  png: Buffer,
  opts?: DefringeOptions,
): Promise<Buffer> {
  const bg = opts?.background ?? WHITE;
  const floor = opts?.floor ?? DEFRINGE_FLOOR;
  const solid = opts?.solid ?? DEFRINGE_SOLID;
  const { data, info } = await sharp(png)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 4) return png;
  const { width: w, height: h } = info;
  const px = w * h;

  // Pass 1 — un-composite blended edges against the generation background.
  for (let i = 0; i < px; i++) {
    const o = i * 4;
    const a = data[o + 3] ?? 0;
    if (a === 0 || a >= solid) continue;
    if (a <= floor) {
      data[o + 3] = 0;
      continue;
    }
    const af = a / 255;
    for (let c = 0; c < 3; c++) {
      const blended = data[o + c] ?? 0;
      const back = bg[c] ?? 255;
      const v = (blended - back * (1 - af)) / af;
      data[o + c] = v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
    }
  }

  // Pass 2 — feather by eroding: min(alpha, blurred alpha) never grows the
  // silhouette, so it cannot re-introduce a fringe of its own.
  const alpha = new Uint8Array(px);
  for (let i = 0; i < px; i++) alpha[i] = data[i * 4 + 3] ?? 0;
  const at = (x: number, y: number): number => {
    const cx = x < 0 ? 0 : x >= w ? w - 1 : x;
    const cy = y < 0 ? 0 : y >= h ? h - 1 : y;
    return alpha[cy * w + cx] ?? 0;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const a = alpha[i] ?? 0;
      if (a === 0) continue;
      const blur =
        (at(x - 1, y - 1) +
          2 * at(x, y - 1) +
          at(x + 1, y - 1) +
          2 * at(x - 1, y) +
          4 * a +
          2 * at(x + 1, y) +
          at(x - 1, y + 1) +
          2 * at(x, y + 1) +
          at(x + 1, y + 1)) /
        16;
      const next = Math.min(a, Math.round(blur));
      data[i * 4 + 3] = next <= floor ? 0 : next;
    }
  }

  // Pass 3 — colour bleed outward so scaled sprites do not sample black.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if ((data[i * 4 + 3] ?? 0) !== 0) continue;
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = (ny * w + nx) * 4;
          // Read the pre-erosion alpha so a neighbour cleared in pass 2 still
          // donates its (already un-composited) colour.
          if ((alpha[ny * w + nx] ?? 0) === 0) continue;
          r += data[j] ?? 0;
          g += data[j + 1] ?? 0;
          b += data[j + 2] ?? 0;
          n += 1;
        }
      }
      if (n === 0) continue;
      data[i * 4] = Math.round(r / n);
      data[i * 4 + 1] = Math.round(g / n);
      data[i * 4 + 2] = Math.round(b / n);
    }
  }

  return sharp(data, { raw: { width: w, height: h, channels: 4 } })
    .png()
    .toBuffer();
}

/**
 * Apply matte policy. On failure returns original buffer + note (never throws).
 */
export async function applyMattePolicy(
  png: Buffer,
  idOrFile: string,
  opts?: { readonly keepBackground?: boolean; readonly force?: boolean },
): Promise<ApplyMatteResult> {
  const want =
    opts?.force === true
      ? true
      : shouldMatteAsset(idOrFile, { keepBackground: opts?.keepBackground });
  if (!want) {
    return { buffer: png, matted: false };
  }
  try {
    const out = await getService().removeBackgroundFromBuffer(png);
    if (!out?.length) {
      return {
        buffer: png,
        matted: false,
        note: `matte ${path.basename(idOrFile)}: empty result — kept original`,
      };
    }
    // imgly may return original on failure; detect no-op by size equality alone is weak —
    // still mark matted=true when service returned a buffer (caller probes alpha separately).
    try {
      return { buffer: await defringeSpritePng(out), matted: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        buffer: out,
        matted: true,
        note: `defringe ${path.basename(idOrFile)} failed: ${msg.slice(0, 120)} — kept matte`,
      };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      buffer: png,
      matted: false,
      note: `matte ${path.basename(idOrFile)} failed: ${msg.slice(0, 120)} — kept original`,
    };
  }
}

/**
 * Heuristic: sprite PNG should have some transparent (or near-transparent) pixels.
 * Returns true when alpha looks fully opaque (bad for character slots).
 */
export async function isFullyOpaquePng(png: Buffer): Promise<boolean> {
  try {
    const { data, info } = await sharp(png)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const channels = info.channels;
    if (channels < 4) return true;
    let transparentish = 0;
    const total = info.width * info.height;
    const sampleStep = Math.max(1, Math.floor(total / 4000));
    for (let i = 0; i < total; i += sampleStep) {
      const a = data[i * channels + 3] ?? 255;
      if (a < 250) transparentish += 1;
    }
    const samples = Math.ceil(total / sampleStep);
    return transparentish / samples < 0.02;
  } catch {
    return false;
  }
}

export function slotMetaForId(id: string): MatteSlotMeta {
  const role = matteRoleForAssetId(id);
  const pose =
    id === 'player_run' || id === 'og_player_run'
      ? ('run' as const)
      : id === 'player' || id === 'og_player'
        ? ('idle' as const)
        : undefined;
  return {
    role,
    matte: role === 'sprite',
    ...(pose ? { pose } : {}),
  };
}
