/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * A* grid pathfinding for NPC smooth movement (replaces schedule teleport).
 */

export interface GridPos {
  readonly x: number;
  readonly y: number;
}

export function findPath(
  width: number,
  height: number,
  blocked: (x: number, y: number) => boolean,
  start: GridPos,
  goal: GridPos,
): GridPos[] | null {
  if (start.x === goal.x && start.y === goal.y) return [start];
  const key = (x: number, y: number) => `${x},${y}`;
  const parse = (k: string): GridPos => {
    const [xs, ys] = k.split(',');
    return { x: Number(xs), y: Number(ys) };
  };
  const h = (p: GridPos) => Math.abs(p.x - goal.x) + Math.abs(p.y - goal.y);
  const open = new Map<string, { g: number; f: number }>();
  const came = new Map<string, string>();
  const closed = new Set<string>();
  const sk = key(start.x, start.y);
  open.set(sk, { g: 0, f: h(start) });

  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const;

  while (open.size) {
    let bestK = '';
    let bestF = Infinity;
    for (const [k, n] of open) {
      if (n.f < bestF) {
        bestF = n.f;
        bestK = k;
      }
    }
    const cur = open.get(bestK)!;
    open.delete(bestK);
    const curPos = parse(bestK);
    if (curPos.x === goal.x && curPos.y === goal.y) {
      const path: GridPos[] = [];
      let c: string | undefined = bestK;
      while (c) {
        path.push(parse(c));
        c = came.get(c);
      }
      path.reverse();
      return path;
    }
    closed.add(bestK);
    for (const [dx, dy] of dirs) {
      const nx = curPos.x + dx;
      const ny = curPos.y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      if (blocked(nx, ny)) continue;
      const nk = key(nx, ny);
      if (closed.has(nk)) continue;
      const g = cur.g + 1;
      const prev = open.get(nk);
      if (!prev || g < prev.g) {
        came.set(nk, bestK);
        open.set(nk, { g, f: g + h({ x: nx, y: ny }) });
      }
    }
  }
  return null;
}

/** Interpolate along path for smooth presentation (0..1). */
export function lerpAlongPath(
  path: readonly GridPos[],
  t: number,
): { x: number; y: number } {
  if (!path.length) return { x: 0, y: 0 };
  if (path.length === 1) return { x: path[0]!.x, y: path[0]!.y };
  const clamped = Math.max(0, Math.min(1, t));
  const f = clamped * (path.length - 1);
  const i = Math.floor(f);
  const frac = f - i;
  const a = path[i]!;
  const b = path[Math.min(path.length - 1, i + 1)]!;
  return {
    x: a.x + (b.x - a.x) * frac,
    y: a.y + (b.y - a.y) * frac,
  };
}
