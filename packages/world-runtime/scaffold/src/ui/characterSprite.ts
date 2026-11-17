/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Procedural resident sprites: a 4-direction × 3-frame walk sheet drawn from a
 * seeded palette.
 *
 * The asset pipeline only renders walk sheets for the first batch of residents,
 * so every other townsfolk fell back to a coloured blob with the first letter of
 * their name stamped on it — no facing, no motion. This draws an actual little
 * person instead, in the frame layout `SocietyReplayScene.ensureWalkAnims`
 * already expects, so procedural residents animate exactly like generated ones.
 *
 * Painting goes through a callback rather than a canvas context so the geometry
 * is testable without a DOM.
 */

export type PixelPainter = (
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
) => void;

export const WALK_DIRS = ['down', 'left', 'right', 'up'] as const;
export type WalkDir = (typeof WALK_DIRS)[number];
export const CHAR_FRAMES_PER_DIR = 3;

/** Logical drawing grid; every part is expressed in these units. */
const LOGICAL_W = 16;
const LOGICAL_H = 20;

export interface CharacterSheetLayout {
  readonly unit: number;
  readonly cellW: number;
  readonly cellH: number;
  readonly sheetW: number;
  readonly sheetH: number;
}

export function characterSheetLayout(unit = 3): CharacterSheetLayout {
  const u = Math.max(1, Math.round(unit));
  const cellW = LOGICAL_W * u;
  const cellH = LOGICAL_H * u;
  return {
    unit: u,
    cellW,
    cellH,
    sheetW: cellW * CHAR_FRAMES_PER_DIR,
    sheetH: cellH * WALK_DIRS.length,
  };
}

/** Frame keys match the generated atlases so animations are interchangeable. */
export function charFrameName(dir: WalkDir, frame: number): string {
  return `walk_${dir}_${frame}`;
}

export function charFrameRect(
  dir: WalkDir,
  frame: number,
  layout: CharacterSheetLayout,
): { x: number; y: number; w: number; h: number } {
  const row = WALK_DIRS.indexOf(dir);
  const col = Math.max(0, Math.min(CHAR_FRAMES_PER_DIR - 1, frame));
  return {
    x: col * layout.cellW,
    y: Math.max(0, row) * layout.cellH,
    w: layout.cellW,
    h: layout.cellH,
  };
}

export interface CharacterPalette {
  readonly skin: string;
  readonly hair: string;
  readonly top: string;
  readonly bottom: string;
  readonly shoe: string;
  readonly accent: string;
  readonly outline: string;
  readonly hat: boolean;
  readonly apron: boolean;
}

const SKINS = ['#f3d3b3', '#e8bd97', '#c68863', '#a3653f', '#7a4a2b'];
const HAIRS = [
  '#241a12',
  '#4a2f1b',
  '#7a4a22',
  '#b08243',
  '#1f2937',
  '#6b3f2b',
  '#94a3b8',
];
const TOPS = [
  '#3b82f6',
  '#ef4444',
  '#22c55e',
  '#eab308',
  '#a855f7',
  '#14b8a6',
  '#f97316',
  '#64748b',
];
const BOTTOMS = ['#334155', '#4b5563', '#5b4636', '#1e3a8a', '#3f3f46'];
const SHOES = ['#1f2937', '#4b2e1e', '#111827'];
const ACCENTS = ['#f59e0b', '#fda4af', '#fef08a', '#c084fc', '#67e8f9'];
const OUTLINE = '#1b2430';

function hash32(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function pick<T>(list: readonly T[], n: number): T {
  return list[n % list.length]!;
}

function usableColors(palette?: readonly string[]): string[] {
  return (palette ?? []).filter(
    (c) => typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c.trim()),
  );
}

/**
 * Deterministic look per resident. World colours, when the Spec carries them,
 * dress the residents so procedural townsfolk still read as part of the place.
 */
export function characterPalette(
  seed: string,
  worldPalette?: readonly string[],
): CharacterPalette {
  const h = hash32(seed);
  const styled = usableColors(worldPalette);
  const tops = styled.length >= 2 ? [...styled, ...TOPS] : TOPS;
  return {
    skin: pick(SKINS, h & 0xff),
    hair: pick(HAIRS, (h >>> 4) & 0xff),
    top: pick(tops, (h >>> 9) & 0xff),
    bottom: pick(BOTTOMS, (h >>> 15) & 0xff),
    shoe: pick(SHOES, (h >>> 20) & 0xff),
    accent: pick(styled.length ? [...styled, ...ACCENTS] : ACCENTS, (h >>> 24) & 0xff),
    outline: OUTLINE,
    hat: ((h >>> 7) & 0x7) < 3,
    apron: ((h >>> 12) & 0x7) < 2,
  };
}

export function drawCharacterSheet(
  paint: PixelPainter,
  palette: CharacterPalette,
  layout: CharacterSheetLayout,
): void {
  for (const dir of WALK_DIRS) {
    for (let frame = 0; frame < CHAR_FRAMES_PER_DIR; frame += 1) {
      drawCharacterFrame(paint, palette, layout, dir, frame);
    }
  }
}

export function drawCharacterFrame(
  paint: PixelPainter,
  palette: CharacterPalette,
  layout: CharacterSheetLayout,
  dir: WalkDir,
  frame: number,
): void {
  const rect = charFrameRect(dir, frame, layout);
  const u = layout.unit;
  const side = dir === 'left' || dir === 'right';
  // 'right' is 'left' mirrored inside the cell, so only one profile is authored.
  const flip = dir === 'right';

  const at = (x: number, w: number): number =>
    rect.x + (flip ? LOGICAL_W - x - w : x) * u;
  /** Body part: 1px darker edge first so the silhouette reads over any tile. */
  const part = (
    x: number,
    y: number,
    w: number,
    h: number,
    color: string,
  ): void => {
    const px = at(x, w);
    const py = rect.y + y * u;
    paint(px - 1, py - 1, w * u + 2, h * u + 2, palette.outline);
    paint(px, py, w * u, h * u, color);
  };
  /** Detail on top of a part — no edge, it would cut into the face. */
  const detail = (
    x: number,
    y: number,
    w: number,
    h: number,
    color: string,
  ): void => {
    paint(at(x, w), rect.y + y * u, w * u, h * u, color);
  };

  // Marching cycle: frame 0 stands, 1 lifts the near leg, 2 lifts the far leg.
  const lift = frame === 0 ? 0 : frame === 1 ? 1 : 2;
  const swing = frame === 0 ? 0 : frame === 1 ? 1 : -1;

  if (side) {
    const back = 9;
    // Rear leg trails, near leg leads; the lifted one is a row shorter.
    const nearShort = lift === 1;
    const farShort = lift === 2;
    part(8, 14, 3, farShort ? 3 : 4, shade(palette.bottom));
    part(8, farShort ? 17 : 18, 3, 2, shade(palette.shoe));
    part(6 - swing, 14, 3, nearShort ? 3 : 4, palette.bottom);
    part(6 - swing, nearShort ? 17 : 18, 3, 2, palette.shoe);
    part(5, 8, 6, 6, palette.top);
    if (palette.apron) detail(6, 10, 4, 4, palette.accent);
    detail(5, 13, 6, 1, palette.accent);
    // Single visible arm, swinging across the chest.
    part(7 + swing, 8, 2, 5, palette.top);
    detail(7 + swing, 12, 2, 1, palette.skin);
    part(4, 2, 8, 6, palette.skin);
    detail(4, 1, 8, 3, palette.hair);
    detail(back, 2, 3, 5, palette.hair);
    detail(5, 5, 1, 1, palette.outline);
  } else {
    const leftShort = lift === 1;
    const rightShort = lift === 2;
    part(5, 14, 3, leftShort ? 3 : 4, palette.bottom);
    part(5, leftShort ? 17 : 18, 3, 2, palette.shoe);
    part(9, 14, 3, rightShort ? 3 : 4, palette.bottom);
    part(9, rightShort ? 17 : 18, 3, 2, palette.shoe);
    part(4, 8, 8, 6, palette.top);
    if (palette.apron) detail(6, 10, 4, 4, palette.accent);
    detail(4, 13, 8, 1, palette.accent);
    part(2, 8 + swing, 2, 5, palette.top);
    detail(2, 12 + swing, 2, 1, palette.skin);
    part(12, 8 - swing, 2, 5, palette.top);
    detail(12, 12 - swing, 2, 1, palette.skin);
    part(4, 2, 8, 6, palette.skin);
    if (dir === 'up') {
      // Back of the head: hair down to the neck, no face.
      detail(4, 1, 8, 6, palette.hair);
    } else {
      detail(4, 1, 8, 3, palette.hair);
      detail(4, 3, 2, 1, palette.hair);
      detail(10, 3, 2, 1, palette.hair);
      detail(6, 5, 1, 1, palette.outline);
      detail(9, 5, 1, 1, palette.outline);
      detail(7, 7, 2, 1, shade(palette.skin));
    }
  }

  if (palette.hat) {
    detail(3, 1, 10, 1, palette.accent);
    detail(5, 0, 6, 1, palette.accent);
  }
}

/** Cheap darkening for far limbs and mouth lines. */
function shade(color: string): string {
  const hex = color.replace('#', '');
  if (hex.length !== 6) return color;
  const dim = (i: number): string => {
    const v = Math.round(parseInt(hex.slice(i, i + 2), 16) * 0.72);
    return Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0');
  };
  return `#${dim(0)}${dim(2)}${dim(4)}`;
}
