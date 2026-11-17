/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

export type TileKind = 'ground' | 'wall' | 'decor' | 'water' | 'path';

export interface TilesetMeta {
  readonly tileSize: number;
  readonly columns: number;
  readonly rows: number;
  readonly kinds: readonly TileKind[];
  /** Index map: kind → first tile gid (1-based, like Tiled). */
  readonly firstGid: Record<TileKind, number>;
}

/**
 * The default tile size used to be 32, so a painterly world's 1K tile renders
 * were crushed to 32×32 before ever reaching the screen. High fidelity is the
 * default; pixel styles pass their own smaller size.
 */
export function defaultTilesetMeta(tileSize = 128): TilesetMeta {
  const kinds: TileKind[] = ['ground', 'path', 'wall', 'water', 'decor'];
  const firstGid = {} as Record<TileKind, number>;
  kinds.forEach((k, i) => {
    firstGid[k] = i + 1;
  });
  return {
    tileSize,
    columns: kinds.length,
    rows: 1,
    kinds,
    firstGid,
  };
}

/**
 * Convert a simple ASCII layout (#=wall, .=ground, ~=water, ==path, *=decor)
 * into a flat gid array (row-major) for Phaser Tilemap.
 */
export function asciiToTileGids(
  layoutAscii: string,
  meta: TilesetMeta = defaultTilesetMeta(),
): { width: number; height: number; gids: number[] } {
  const lines = layoutAscii
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);
  const height = lines.length;
  const width = Math.max(0, ...lines.map((l) => l.length));
  const gids: number[] = [];
  for (let y = 0; y < height; y++) {
    const line = lines[y] ?? '';
    for (let x = 0; x < width; x++) {
      const ch = line[x] ?? '.';
      let kind: TileKind = 'ground';
      if (ch === '#') kind = 'wall';
      else if (ch === '~') kind = 'water';
      else if (ch === '=') kind = 'path';
      else if (ch === '*') kind = 'decor';
      else kind = 'ground';
      gids.push(meta.firstGid[kind]);
    }
  }
  return { width, height, gids };
}

/**
 * The tile size used to be baked into the prompt as `32x32`, which asked the
 * model for coarse art no matter what style the user picked. It is now derived
 * from the caller's target size.
 */
export function tilesetPrompt(
  style: string,
  kind: TileKind,
  tileSize = 128,
): string {
  const desc: Record<TileKind, string> = {
    ground: 'seamless grass/dirt ground tile',
    wall: 'seamless stone wall / obstacle tile',
    decor: 'small bush or rock decoration tile',
    water: 'seamless water tile',
    path: 'seamless dirt path tile',
  };
  return `${style}, ${desc[kind]}, top-down RPG tileset tile, seamless edges, ${tileSize}x${tileSize}, no character, game asset`;
}

/** Y-sort depth helper for top-down sprites (feet-anchored). */
export function ySortDepth(y: number, base = 10): number {
  return base + Math.floor(y);
}
