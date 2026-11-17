/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Region grid helpers over the Spec's `layoutAscii`.
 *
 * Anchors used to be laid out on a synthetic 3-column grid that ignored the
 * map, so "the fountain" could sit inside a wall and residents would path into
 * geometry they cannot occupy. Everything spatial now reads the real layout.
 */

/** `#`/`X` walls and `~` water are impassable; `.` `=` `*` are walkable. */
const BLOCKED = new Set(['#', 'X', '~']);
const DECOR = new Set(['*']);
const PATH = new Set(['=']);

export interface RegionGrid {
  readonly width: number;
  readonly height: number;
  /** Row-major, always `width * height` entries. */
  readonly cells: readonly string[];
}

export interface Cell {
  readonly x: number;
  readonly y: number;
}

export function parseRegionGrid(input: {
  readonly width: number;
  readonly height: number;
  readonly layoutAscii?: string;
}): RegionGrid {
  const width = Math.max(1, Math.floor(input.width));
  const height = Math.max(1, Math.floor(input.height));
  const rows = (input.layoutAscii ?? '')
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''));
  const cells: string[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      cells.push(rows[y]?.[x] ?? '.');
    }
  }
  return { width, height, cells };
}

export function tileAt(grid: RegionGrid, x: number, y: number): string {
  if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return '#';
  return grid.cells[y * grid.width + x] ?? '.';
}

export function isBlocked(grid: RegionGrid, x: number, y: number): boolean {
  return BLOCKED.has(tileAt(grid, x, y));
}

export function isWalkable(grid: RegionGrid, x: number, y: number): boolean {
  return !isBlocked(grid, x, y);
}

export function isDecor(grid: RegionGrid, x: number, y: number): boolean {
  return DECOR.has(tileAt(grid, x, y));
}

export function isPath(grid: RegionGrid, x: number, y: number): boolean {
  return PATH.has(tileAt(grid, x, y));
}

/** Walkable cells, excluding the outer ring so sprites never hug the border. */
export function walkableCells(grid: RegionGrid): Cell[] {
  const out: Cell[] = [];
  for (let y = 1; y < grid.height - 1; y++) {
    for (let x = 1; x < grid.width - 1; x++) {
      if (isWalkable(grid, x, y)) out.push({ x, y });
    }
  }
  if (out.length) return out;
  // Degenerate map (all wall / 1-tile region): fall back to the whole rect.
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) out.push({ x, y });
  }
  return out;
}

/** Snap a possibly-inside-a-wall position onto the closest walkable cell. */
export function nearestWalkable(
  grid: RegionGrid,
  x: number,
  y: number,
): Cell {
  const cx = Math.max(0, Math.min(grid.width - 1, Math.round(x)));
  const cy = Math.max(0, Math.min(grid.height - 1, Math.round(y)));
  if (isWalkable(grid, cx, cy)) return { x: cx, y: cy };
  const maxR = Math.max(grid.width, grid.height);
  for (let r = 1; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= grid.width || ny >= grid.height) continue;
        if (isWalkable(grid, nx, ny)) return { x: nx, y: ny };
      }
    }
  }
  return { x: cx, y: cy };
}

/**
 * How plaza-like a cell is: near the region centre, on a path, or beside decor
 * (fountains/monuments are authored as `*`). Lower is better.
 */
export function hubScore(grid: RegionGrid, cell: Cell): number {
  const cx = (grid.width - 1) / 2;
  const cy = (grid.height - 1) / 2;
  let score = Math.hypot(cell.x - cx, cell.y - cy);
  if (isPath(grid, cell.x, cell.y)) score -= 2.5;
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    if (isDecor(grid, cell.x + dx, cell.y + dy)) {
      score -= 4;
      break;
    }
  }
  return score;
}

/** Ring of walkable cells around a centre, nearest first. */
export function walkableRing(
  grid: RegionGrid,
  centre: Cell,
  maxRadius = 3,
): Cell[] {
  const out: Cell[] = [];
  for (let r = 1; r <= maxRadius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = centre.x + dx;
        const ny = centre.y + dy;
        if (nx < 1 || ny < 1 || nx >= grid.width - 1 || ny >= grid.height - 1) {
          continue;
        }
        if (isWalkable(grid, nx, ny)) out.push({ x: nx, y: ny });
      }
    }
  }
  return out;
}
