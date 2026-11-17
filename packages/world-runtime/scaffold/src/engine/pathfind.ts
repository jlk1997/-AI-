/**
 * Local A* for scaffold (copied — scaffold is shipped as source, not package import).
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
  open.set(key(start.x, start.y), { g: 0, f: h(start) });
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

export function dayNightTint(timeHours: number): number {
  const h = ((timeHours % 24) + 24) % 24;
  if (h >= 6 && h < 8) return 0xffe4b5;
  if (h >= 8 && h < 17) return 0xffffff;
  if (h >= 17 && h < 20) return 0xffb347;
  return 0x334155;
}
