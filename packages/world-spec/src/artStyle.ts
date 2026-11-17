/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * The single source of truth for art direction.
 *
 * Art style used to be the string `'pixel'` hardcoded in six places (world
 * schema, planner, world/game asset phases, prompt contracts, asset-forge), and
 * the fidelity was then thrown away again by downsampling 1K renders to 48x64
 * sprites and 32x32 tiles. Every one of those decisions now derives from a
 * profile picked here, so choosing a style actually changes the output —
 * including the target resolutions and whether the renderer snaps to pixels.
 */

export type ArtStyleId =
  | 'hand_painted'
  | 'illustration'
  | 'soft_3d'
  | 'fine_pixel'
  | 'ink_wash'
  | 'neon_noir';

export interface ArtStyleProfile {
  readonly id: ArtStyleId;
  /** Free text written to `styleAnchor.artStyle` and into every asset prompt. */
  readonly artStyle: string;
  /** Appended to character/scene prompts to lock the rendering technique. */
  readonly promptSuffix: string;
  /** Fallback palette when the planner or model offers nothing better. */
  readonly palette: readonly string[];
  readonly mood: string;
  /**
   * True only for deliberately pixel styles. Drives Phaser `pixelArt` /
   * `roundPixels` and nearest-neighbour resizing; everything else wants
   * smoothing, or the art reads as a blurry mistake.
   */
  readonly pixelPerfect: boolean;
  /** Target walk-frame size. Painterly styles keep far more of the render. */
  readonly frameWidth: number;
  readonly frameHeight: number;
  /** Target tileset tile size. */
  readonly tileSize: number;
}

const PROFILES: readonly ArtStyleProfile[] = [
  {
    id: 'hand_painted',
    artStyle:
      'high-fidelity hand-painted game art, rich brushwork, soft volumetric light, detailed textures',
    promptSuffix:
      'painterly rendering, clean readable silhouette, no visible pixels, no UI text',
    palette: ['#2f3e46', '#84a98c', '#f2e8cf', '#e07a5f'],
    mood: 'warm, lived-in',
    pixelPerfect: false,
    frameWidth: 192,
    frameHeight: 256,
    tileSize: 128,
  },
  {
    id: 'illustration',
    artStyle:
      'modern storybook illustration, crisp ink linework, flat-but-layered color, cel shading',
    promptSuffix:
      'clean line art, confident shapes, high contrast, no visible pixels, no UI text',
    palette: ['#22223b', '#4a4e69', '#9a8c98', '#f2e9e4'],
    mood: 'bright, storybook',
    pixelPerfect: false,
    frameWidth: 192,
    frameHeight: 256,
    tileSize: 128,
  },
  {
    id: 'soft_3d',
    artStyle:
      '2.5D stylized render, soft global illumination, gentle depth of field, matte materials',
    promptSuffix:
      'stylized 3D render, isometric-friendly lighting, smooth gradients, no UI text',
    palette: ['#1b263b', '#415a77', '#778da9', '#e0e1dd'],
    mood: 'calm, cinematic',
    pixelPerfect: false,
    frameWidth: 192,
    frameHeight: 256,
    tileSize: 128,
  },
  {
    id: 'fine_pixel',
    artStyle:
      'refined 32-bit pixel art, hand-placed dithering, limited palette, crisp outlines',
    promptSuffix:
      'pixel art, sharp pixel edges, no anti-aliasing, no UI text',
    palette: ['#1a1c2c', '#5d275d', '#ef7d57', '#ffcd75'],
    mood: 'nostalgic, cozy',
    pixelPerfect: true,
    frameWidth: 64,
    frameHeight: 96,
    tileSize: 48,
  },
  {
    id: 'ink_wash',
    artStyle:
      'Chinese ink-wash painting, xieyi brush strokes, rice-paper texture, restrained color',
    promptSuffix:
      'ink wash rendering, negative space composition, wet-edge brushwork, no UI text',
    palette: ['#1c1c1c', '#5c5c5c', '#c9c2b6', '#8c2f2f'],
    mood: 'austere, poetic',
    pixelPerfect: false,
    frameWidth: 192,
    frameHeight: 256,
    tileSize: 128,
  },
  {
    id: 'neon_noir',
    artStyle:
      'neon noir concept art, wet reflective surfaces, volumetric haze, strong rim light',
    promptSuffix:
      'cinematic lighting, deep blacks, saturated neon accents, no visible pixels, no UI text',
    palette: ['#0a0a0f', '#00fff9', '#ff00a0', '#ffd166'],
    mood: 'rain-slick, electric',
    pixelPerfect: false,
    frameWidth: 192,
    frameHeight: 256,
    tileSize: 128,
  },
];

export const ART_STYLES = PROFILES;

/**
 * High fidelity by default. The old default was `'pixel'`, which is why every
 * generated world looked like coarse 8-bit art nobody asked for.
 */
export const DEFAULT_ART_STYLE_ID: ArtStyleId = 'hand_painted';

export function artStyleIds(): readonly ArtStyleId[] {
  return PROFILES.map((p) => p.id);
}

export function isArtStyleId(value: unknown): value is ArtStyleId {
  return (
    typeof value === 'string' && PROFILES.some((p) => p.id === value)
  );
}

/** Profile by id, falling back to the high-fidelity default. */
export function artStyleProfile(id?: string | null): ArtStyleProfile {
  const hit = PROFILES.find((p) => p.id === id);
  return hit ?? PROFILES.find((p) => p.id === DEFAULT_ART_STYLE_ID)!;
}

/**
 * Legacy ids and the free-text `styleAnchor.artStyle` of worlds generated
 * before the picker existed. `'pixel'`, `'pixel dungeon'` and the intake's
 * `'warm_pixel'` must keep resolving to a pixel profile so reopening an old
 * world does not silently restyle it.
 */
const TEXT_ALIASES: ReadonlyArray<{ match: RegExp; id: ArtStyleId }> = [
  { match: /水墨|ink[\s_-]?wash|xieyi|sumi/i, id: 'ink_wash' },
  { match: /霓虹|neon|cyberpunk|noir/i, id: 'neon_noir' },
  { match: /pixel|像素|8-?bit|16-?bit|32-?bit/i, id: 'fine_pixel' },
  { match: /2\.5d|isometric|3d|render/i, id: 'soft_3d' },
  { match: /插画|illustration|storybook|line[\s_-]?art|comic|cel/i, id: 'illustration' },
  { match: /手绘|painterly|painted|watercolor|水彩|oil/i, id: 'hand_painted' },
];

/**
 * Best-effort resolution from an id *or* free text. Prefers an explicit id so
 * the picker is authoritative; only falls back to sniffing legacy strings.
 */
export function resolveArtStyle(input?: {
  readonly id?: string | null;
  readonly text?: string | null;
}): ArtStyleProfile {
  if (isArtStyleId(input?.id)) return artStyleProfile(input?.id);
  const text = input?.text?.trim();
  if (text) {
    for (const alias of TEXT_ALIASES) {
      if (alias.match.test(text)) return artStyleProfile(alias.id);
    }
  }
  return artStyleProfile(DEFAULT_ART_STYLE_ID);
}

/** The prompt fragment every asset generator should prepend. */
export function artStylePromptPrefix(profile: ArtStyleProfile): string {
  return `${profile.artStyle}, ${profile.promptSuffix}`;
}
