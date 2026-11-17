/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Compose a 4-direction walk sheet from however many real renders exist.
 *
 * Every asset phase used to duplicate one still per direction into all three
 * cycle slots, so `walk_down` and friends animated nothing — characters slid.
 * Here the frame plan decides which render fills each slot and how to vary it
 * (mirror for front/back, lift for the passing pose) so even a single render
 * yields visible motion.
 */

import {
  walkCycleFramePlan,
  walkDirectionAllowsFlop,
  type WalkAtlasLayout,
  type WalkDirection,
} from '@opengame/asset-forge';

export interface WalkSheetInput {
  readonly dest: string;
  /** Renders per direction, in cycle order. Empty entries fall back to `base`. */
  readonly renders: ReadonlyMap<WalkDirection, readonly Buffer[]>;
  /** Used when a direction produced no render at all. */
  readonly base?: Buffer;
  readonly layout: WalkAtlasLayout;
  readonly pixelPerfect: boolean;
  /** Living-town side portraits must not be flopped into a fake front face. */
  readonly allowFlop?: boolean;
}

/** Nearest keeps pixel art crisp; lanczos3 keeps painterly detail. */
export function resampleKernel(pixelPerfect: boolean): 'nearest' | 'lanczos3' {
  return pixelPerfect ? 'nearest' : 'lanczos3';
}

export async function composeWalkSheet(input: WalkSheetInput): Promise<void> {
  const sharpMod = await import('sharp').catch(() => null);
  if (!sharpMod) throw new Error('sharp unavailable');
  const sharp = sharpMod.default;
  const { layout } = input;
  const fw = layout.frameWidth;
  const fh = layout.frameHeight;
  const kernel = resampleKernel(input.pixelPerfect);
  const composites: Array<{ input: Buffer; left: number; top: number }> = [];

  for (let row = 0; row < layout.directions.length; row++) {
    const dir = layout.directions[row]!;
    const available = input.renders.get(dir) ?? [];
    const pool = available.length
      ? available
      : input.base
        ? [input.base]
        : [];
    if (!pool.length) continue;
    const plan = walkCycleFramePlan(layout.framesPerDir, pool.length, {
      allowFlop:
        input.allowFlop === false ? false : walkDirectionAllowsFlop(dir),
    });
    for (let col = 0; col < plan.length; col++) {
      const step = plan[col]!;
      const src = pool[Math.min(step.pose, pool.length - 1)]!;
      const lift = Math.round(fh * step.lift);
      let pipeline = sharp(src);
      if (step.flop) pipeline = pipeline.flop();
      const frame = await pipeline
        .resize(fw, fh - lift, {
          fit: 'contain',
          kernel,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .png()
        .toBuffer();
      composites.push({
        input: frame,
        left: col * fw,
        // Lifted frames sit against the top of the cell so the feet rise.
        top: row * fh,
      });
    }
  }

  await sharp({
    create: {
      width: layout.sheetWidth,
      height: layout.sheetHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .png()
    .toFile(input.dest);
}

/**
 * How many real renders to ask the image model for per direction.
 *
 * A full cycle is three, i.e. 12 calls per character — the same asset-phase cost
 * that makes generation time out. The hero is on screen constantly and gets two
 * (contact + passing, 8 calls); a town's NPCs get one each and rely on the
 * derived plan, because a cast of eight would otherwise add 64 renders.
 */
export function walkRealPoseCount(
  framesPerDir = 3,
  kind: 'hero' | 'npc' = 'hero',
): number {
  const env =
    kind === 'hero'
      ? process.env['PLATFORM_WALK_REAL_POSES']
      : (process.env['PLATFORM_WALK_REAL_POSES_NPC'] ??
        process.env['PLATFORM_WALK_REAL_POSES']);
  const raw = Number(env ?? (kind === 'hero' ? '2' : '1'));
  if (!Number.isFinite(raw) || raw < 1) return 1;
  return Math.min(framesPerDir, Math.floor(raw));
}
