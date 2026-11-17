/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

export type WalkDirection = 'down' | 'left' | 'right' | 'up';

export const WALK_DIRECTIONS: readonly WalkDirection[] = [
  'down',
  'left',
  'right',
  'up',
] as const;

export interface AtlasFrame {
  readonly filename: string;
  readonly frame: { x: number; y: number; w: number; h: number };
  readonly rotated: false;
  readonly trimmed: false;
  readonly spriteSourceSize: { x: number; y: number; w: number; h: number };
  readonly sourceSize: { w: number; h: number };
}

export interface PhaserAtlasJson {
  readonly frames: Record<string, AtlasFrame>;
  readonly meta: {
    readonly app: string;
    readonly version: string;
    readonly image: string;
    readonly format: string;
    readonly size: { w: number; h: number };
    readonly scale: string;
  };
  readonly animations?: Record<string, string[]>;
}

export interface WalkAtlasLayout {
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly framesPerDir: number;
  readonly directions: readonly WalkDirection[];
  readonly sheetWidth: number;
  readonly sheetHeight: number;
}

/**
 * Default 4×3 walk sheet: down/left/right/up × idle/stepA/stepB.
 *
 * The defaults used to be 48×64, which threw away almost all of the ~1K render
 * the image model returned and is why sprites looked mushy at any zoom. Callers
 * that genuinely want small pixel frames pass the size explicitly (see the
 * `fine_pixel` art style profile).
 */
export function defaultWalkLayout(
  frameWidth = 192,
  frameHeight = 256,
  framesPerDir = 3,
): WalkAtlasLayout {
  return {
    frameWidth,
    frameHeight,
    framesPerDir,
    directions: WALK_DIRECTIONS,
    sheetWidth: frameWidth * framesPerDir,
    sheetHeight: frameHeight * WALK_DIRECTIONS.length,
  };
}

export function buildWalkAtlasJson(
  imageFileName: string,
  layout: WalkAtlasLayout = defaultWalkLayout(),
  keyPrefix = 'walk',
): PhaserAtlasJson {
  const frames: Record<string, AtlasFrame> = {};
  const animations: Record<string, string[]> = {};

  layout.directions.forEach((dir, row) => {
    const names: string[] = [];
    for (let col = 0; col < layout.framesPerDir; col++) {
      const filename = `${keyPrefix}_${dir}_${col}`;
      const x = col * layout.frameWidth;
      const y = row * layout.frameHeight;
      frames[filename] = {
        filename,
        frame: { x, y, w: layout.frameWidth, h: layout.frameHeight },
        rotated: false,
        trimmed: false,
        spriteSourceSize: {
          x: 0,
          y: 0,
          w: layout.frameWidth,
          h: layout.frameHeight,
        },
        sourceSize: { w: layout.frameWidth, h: layout.frameHeight },
      };
      names.push(filename);
    }
    animations[`walk_${dir}`] = names;
    animations[`idle_${dir}`] = [names[0]!];
  });

  return {
    frames,
    meta: {
      app: 'OpenGame asset-forge',
      version: '1.0',
      image: imageFileName,
      format: 'RGBA8888',
      size: { w: layout.sheetWidth, h: layout.sheetHeight },
      scale: '1',
    },
    animations,
  };
}

/**
 * Prompt templates for deriving directional walk frames from a subject ref.
 *
 * `pixel-art friendly` used to be appended unconditionally, so even a painterly
 * world asked the model for pixel sprites. The technique now comes from the
 * caller's style string; only genuinely pixel styles opt back in.
 */
export function walkFramePrompts(
  style: string,
  characterDesc: string,
  options?: { readonly pixelPerfect?: boolean },
): Record<WalkDirection, string> {
  const technique = options?.pixelPerfect
    ? 'pixel-art friendly, sharp pixel edges'
    : 'crisp readable silhouette, no visible pixels';
  const base = `${style}, game sprite sheet frame, full body character, transparent background, ${characterDesc}, consistent proportions, ${technique}`;
  return {
    down: `${base}, facing camera, front view, walking pose`,
    left: `${base}, facing left, side view, walking pose`,
    right: `${base}, facing right, side view, walking pose`,
    up: `${base}, facing away, back view, walking pose`,
  };
}

const VIEW_OF: Record<WalkDirection, string> = {
  down: 'facing camera, front view',
  left: 'facing left, side view',
  right: 'facing right, side view',
  up: 'facing away, back view',
};

/**
 * Distinct leg positions for one walk cycle. Index 0 is a contact pose, 1 the
 * passing pose, 2 the opposite contact.
 */
const CYCLE_POSES: readonly string[] = [
  'mid-stride contact pose, left leg forward and right leg trailing, arms swinging in opposition, weight on the front foot',
  'passing pose, legs together directly beneath the body, torso at the top of the step',
  'mid-stride contact pose, right leg forward and left leg trailing, arms swinging in opposition, weight on the front foot',
];

/**
 * One prompt per cycle slot per direction, so a sheet can hold genuinely
 * different poses instead of the same still repeated three times (which read as
 * a character sliding across the floor).
 */
export function walkCyclePrompts(
  style: string,
  characterDesc: string,
  options?: {
    readonly pixelPerfect?: boolean;
    readonly framesPerDir?: number;
  },
): Record<WalkDirection, string[]> {
  const technique = options?.pixelPerfect
    ? 'pixel-art friendly, sharp pixel edges'
    : 'crisp readable silhouette, no visible pixels';
  const base = `${style}, game sprite sheet frame, full body character, transparent background, ${characterDesc}, consistent proportions, ${technique}`;
  const count = Math.max(1, options?.framesPerDir ?? CYCLE_POSES.length);
  const out = {} as Record<WalkDirection, string[]>;
  for (const dir of WALK_DIRECTIONS) {
    out[dir] = Array.from({ length: count }, (_, i) => {
      const pose = CYCLE_POSES[i % CYCLE_POSES.length]!;
      return `${base}, ${VIEW_OF[dir]}, ${pose}`;
    });
  }
  return out;
}

export interface WalkFrameStep {
  /** Which of the available real renders this slot draws from. */
  readonly pose: number;
  /** Fraction of frame height to lift the sprite, faking the step bounce. */
  readonly lift: number;
  /** Mirror horizontally — swaps the legs on front and back views. */
  readonly flop: boolean;
}

/** Lift used for the passing pose; halved for a derived in-between frame. */
const CYCLE_LIFT = 0.035;

/**
 * Decide how to fill a cycle when fewer real renders exist than frames.
 *
 * Every generated sprite used to be the same buffer repeated, so `walk_*`
 * animations never moved. With two renders the third slot is the first one
 * mirrored (front/back only — mirroring a side view would turn the character
 * around); otherwise the slot re-uses a pose at a different lift so the cycle
 * still reads as motion.
 */
export function walkCycleFramePlan(
  framesPerDir = 3,
  realPoses = framesPerDir,
  options?: { readonly allowFlop?: boolean },
): WalkFrameStep[] {
  const poses = Math.max(1, Math.min(realPoses, framesPerDir));
  const allowFlop = options?.allowFlop ?? false;
  const steps: WalkFrameStep[] = [];
  for (let i = 0; i < framesPerDir; i++) {
    if (i < poses) {
      // Real render for this slot — the model already drew the stride.
      steps.push({ pose: i, lift: 0, flop: false });
      continue;
    }
    const isContactSlot = i % 2 === 0;
    if (isContactSlot && allowFlop) {
      steps.push({ pose: 0, lift: 0, flop: true });
      continue;
    }
    const source = Math.min(poses - 1, 1);
    steps.push({
      pose: source,
      lift: isContactSlot ? CYCLE_LIFT / 2 : CYCLE_LIFT,
      flop: false,
    });
  }
  return steps;
}

/** Front and back views can swap legs by mirroring; side views cannot. */
export function walkDirectionAllowsFlop(dir: WalkDirection): boolean {
  return dir === 'down' || dir === 'up';
}
