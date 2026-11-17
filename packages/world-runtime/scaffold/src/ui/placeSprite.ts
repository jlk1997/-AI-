/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Procedural place sprites: one still per landmark kind, painted through a
 * callback so the geometry is testable without a DOM.
 *
 * Living towns skip MiniMax walk sheets to keep generate short. Doing the same
 * per object would put the hour-long asset wait back. These 32×32 (2× optional)
 * top-down props are the place equivalent of `characterSprite.ts`.
 */

export type PixelPainter = (
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
) => void;

export const PLACE_KINDS = [
  'coop',
  'field',
  'forge',
  'oven',
  'fountain',
  'well',
  'stall',
  'bed',
  'mine',
  'tree',
  'bench',
  'lamp',
  'board',
  'sign',
  'swing',
  'cafe',
  'shelf',
  'bar',
  'laundry',
  'generic',
] as const;

export type PlaceKind = (typeof PLACE_KINDS)[number];

const LOGICAL = 16;

export interface PlaceSpriteLayout {
  readonly unit: number;
  readonly size: number;
}

export function placeSpriteLayout(unit = 2): PlaceSpriteLayout {
  const u = Math.max(1, Math.round(unit));
  return { unit: u, size: LOGICAL * u };
}

export function placeTextureKey(kind: PlaceKind): string {
  return `place_${kind}`;
}

export interface PlacePalette {
  readonly wood: string;
  readonly roof: string;
  readonly roofDark: string;
  readonly wheat: string;
  readonly dirt: string;
  readonly iron: string;
  readonly ember: string;
  readonly water: string;
  readonly stone: string;
  readonly leaf: string;
  readonly straw: string;
  readonly accent: string;
  readonly outline: string;
}

const WOODS = ['#8b5a2b', '#6b3f22', '#a16207', '#92400e'];
const ROOFS = ['#9a3412', '#7f1d1d', '#b45309', '#7c2d12'];
const WHEATS = ['#ca8a04', '#eab308', '#d4a017'];
const WATERS = ['#1d4e89', '#0369a1', '#0e7490'];
const STONES = ['#64748b', '#57534e', '#78716c'];
const LEAVES = ['#3f6212', '#4d7c0f', '#166534'];
const ACCENTS = ['#f59e0b', '#f97316', '#fda4af', '#67e8f9'];
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
 * World colours dress the props so a neon-noir town and a mossy one do not
 * share the same brown crate.
 */
export function placePalette(
  seed: string,
  worldPalette?: readonly string[],
): PlacePalette {
  const h = hash32(seed);
  const styled = usableColors(worldPalette);
  const wood = styled[2] ?? pick(WOODS, h & 0xff);
  const roof = styled[1] ?? pick(ROOFS, (h >>> 6) & 0xff);
  return {
    wood,
    roof,
    roofDark: shade(roof, 0.72),
    wheat: pick(styled.length ? [...styled, ...WHEATS] : WHEATS, (h >>> 10) & 0xff),
    dirt: '#6b4f3a',
    iron: '#334155',
    ember: '#f97316',
    water: pick(WATERS, (h >>> 14) & 0xff),
    stone: pick(STONES, (h >>> 18) & 0xff),
    leaf: pick(LEAVES, (h >>> 22) & 0xff),
    straw: '#e8d5a3',
    accent: pick(styled.length ? [...styled, ...ACCENTS] : ACCENTS, (h >>> 24) & 0xff),
    outline: OUTLINE,
  };
}

/**
 * Classify a landmark by its display name. More specific kinds win so a
 * 宿舍床 is a bed, not a coop, even though 舍 is in the coop list.
 */
export function placeKindFromName(name: string): PlaceKind {
  const t = name.toLowerCase();
  // 铺 alone is a shop counter, not a mattress — 铁匠铺 / 面包铺 used to
  // collapse to `bed` and look like furniture in the square.
  if (/床|被褥|病床|bed/.test(t)) return 'bed';
  if (/宿舍/.test(name)) return 'generic';
  if (
    /coop|henhouse|hen|chicken|鸡/.test(t) ||
    (/(?<![宿客屋])舍/.test(name) && !/店|铺|酒/.test(name)) ||
    (/窝/.test(name) && !/被/.test(name))
  ) {
    return 'coop';
  }
  if (/麦|田|垄|稻|field|\bfarm\b/.test(t)) return 'field';
  if (/铁匠|铁砧|砧|锻|forge|anvil|smith|风箱|bellows/.test(t)) return 'forge';
  if (/炉|灶|oven|stove|hearth|壁炉/.test(t)) return 'oven';
  if (/喷泉|fountain/.test(t)) return 'fountain';
  if (/井|well/.test(t)) return 'well';
  if (/摊|stall|面包/.test(t)) return 'stall';
  if (/椅|bench/.test(t)) return 'bench';
  if (/灯|lamp/.test(t)) return 'lamp';
  if (/布告|告示|黑板|board/.test(t)) return 'board';
  if (/路标|招牌|sign/.test(t)) return 'sign';
  if (/秋千|swing/.test(t)) return 'swing';
  if (/咖啡|coffee/.test(t)) return 'cafe';
  if (/货架|书架|药柜|shelf/.test(t)) return 'shelf';
  if (/吧台|柜台|bar/.test(t)) return 'bar';
  if (/晾衣|laundry/.test(t)) return 'laundry';
  if (/矿|mine/.test(t)) return 'mine';
  if (/树|tree|林/.test(t) && !/森林/.test(name)) return 'tree';
  return 'generic';
}

export function drawPlaceSprite(
  paint: PixelPainter,
  kind: PlaceKind,
  palette: PlacePalette,
  layout: PlaceSpriteLayout,
): void {
  const u = layout.unit;
  const part = (
    x: number,
    y: number,
    w: number,
    h: number,
    color: string,
  ): void => {
    paint(x * u - 1, y * u - 1, w * u + 2, h * u + 2, palette.outline);
    paint(x * u, y * u, w * u, h * u, color);
  };
  const fill = (
    x: number,
    y: number,
    w: number,
    h: number,
    color: string,
  ): void => {
    paint(x * u, y * u, w * u, h * u, color);
  };

  const draw =
    kind === 'coop'
      ? drawCoop
      : kind === 'field'
        ? drawField
        : kind === 'forge'
          ? drawForge
          : kind === 'oven'
            ? drawOven
            : kind === 'fountain'
              ? drawFountain
              : kind === 'well'
                ? drawWell
                : kind === 'stall'
                  ? drawStall
                  : kind === 'bed'
                    ? drawBed
                    : kind === 'mine'
                      ? drawMine
                      : kind === 'tree'
                        ? drawTree
                        : kind === 'bench'
                          ? drawBench
                          : kind === 'lamp'
                            ? drawLamp
                            : kind === 'board'
                              ? drawBoard
                              : kind === 'sign'
                                ? drawSign
                                : kind === 'swing'
                                  ? drawSwing
                                  : kind === 'cafe'
                                    ? drawCafe
                                    : kind === 'shelf'
                                      ? drawShelf
                                      : kind === 'bar'
                                        ? drawBar
                                        : kind === 'laundry'
                                          ? drawLaundry
                                          : drawGeneric;
  draw(part, fill, palette);
}

type PartFn = (
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
) => void;

function drawCoop(part: PartFn, fill: PartFn, p: PlacePalette): void {
  fill(1, 12, 14, 3, p.dirt);
  // Fence rails + posts — the yard reads even at 32px.
  for (const x of [1, 5, 10, 14]) part(x, 10, 1, 5, p.wood);
  part(1, 11, 14, 1, p.wood);
  part(1, 14, 14, 1, p.wood);
  // Sloped roof: ridge then two faces.
  part(3, 2, 10, 2, p.roofDark);
  part(2, 4, 12, 2, p.roof);
  part(1, 6, 14, 3, p.roof);
  fill(4, 3, 8, 1, p.straw);
  // Door gap on the south eave.
  fill(7, 8, 2, 2, p.dirt);
  part(6, 8, 1, 3, p.wood);
  part(9, 8, 1, 3, p.wood);
  // Chicken silhouette.
  part(11, 11, 3, 2, p.accent);
  fill(13, 10, 1, 1, p.roof);
  fill(11, 12, 1, 1, p.outline);
}

function drawField(part: PartFn, fill: PartFn, p: PlacePalette): void {
  fill(1, 3, 14, 12, p.dirt);
  for (let row = 0; row < 4; row += 1) {
    const y = 4 + row * 3;
    part(1, y, 14, 1, shade(p.dirt, 0.78));
    for (let x = 2; x <= 13; x += 2) {
      part(x, y - 1, 1, 2, p.wheat);
      fill(x, y - 2, 1, 1, shade(p.wheat, 1.15));
    }
  }
}

function drawForge(part: PartFn, fill: PartFn, p: PlacePalette): void {
  part(3, 8, 10, 6, p.stone);
  part(5, 5, 6, 4, p.iron);
  part(6, 3, 4, 3, p.ember);
  fill(7, 2, 2, 2, p.accent);
  part(4, 11, 8, 2, p.iron);
  fill(6, 12, 4, 1, shade(p.iron, 0.7));
}

function drawOven(part: PartFn, fill: PartFn, p: PlacePalette): void {
  part(3, 5, 10, 9, p.stone);
  part(5, 7, 6, 5, p.roofDark);
  fill(6, 8, 4, 3, p.ember);
  part(4, 3, 8, 3, p.roof);
  fill(7, 4, 2, 1, p.accent);
}

function drawFountain(part: PartFn, fill: PartFn, p: PlacePalette): void {
  part(2, 10, 12, 4, p.stone);
  part(4, 6, 8, 6, p.water);
  fill(6, 4, 4, 4, shade(p.water, 1.2));
  part(7, 2, 2, 4, p.stone);
  fill(7, 1, 2, 2, p.accent);
}

function drawWell(part: PartFn, fill: PartFn, p: PlacePalette): void {
  part(3, 8, 10, 6, p.stone);
  part(5, 10, 6, 3, p.water);
  part(4, 3, 2, 6, p.wood);
  part(10, 3, 2, 6, p.wood);
  part(4, 2, 8, 2, p.wood);
  fill(7, 5, 2, 3, p.iron);
}

function drawStall(part: PartFn, fill: PartFn, p: PlacePalette): void {
  part(2, 9, 12, 5, p.wood);
  part(1, 4, 14, 5, p.roof);
  fill(2, 5, 12, 3, p.roofDark);
  part(3, 11, 4, 3, p.straw);
  part(9, 11, 4, 3, p.accent);
}

function drawBed(part: PartFn, fill: PartFn, p: PlacePalette): void {
  part(2, 5, 12, 8, p.wood);
  part(3, 6, 10, 6, p.straw);
  fill(3, 6, 10, 2, p.accent);
  part(2, 4, 12, 2, p.wood);
}

function drawMine(part: PartFn, fill: PartFn, p: PlacePalette): void {
  part(2, 4, 12, 10, p.stone);
  part(5, 7, 6, 6, p.outline);
  fill(6, 8, 4, 4, shade(p.outline, 1.4));
  part(4, 5, 2, 4, p.wood);
  part(10, 5, 2, 4, p.wood);
  part(4, 4, 8, 2, p.wood);
}

function drawTree(part: PartFn, fill: PartFn, p: PlacePalette): void {
  part(7, 9, 2, 6, p.wood);
  part(3, 4, 10, 7, p.leaf);
  fill(5, 2, 6, 4, shade(p.leaf, 1.15));
}

function drawGeneric(part: PartFn, fill: PartFn, p: PlacePalette): void {
  part(3, 6, 10, 8, p.wood);
  part(4, 4, 8, 4, p.roof);
  fill(5, 8, 6, 4, p.straw);
}

function drawBench(part: PartFn, fill: PartFn, p: PlacePalette): void {
  part(2, 10, 12, 2, p.wood);
  part(3, 8, 10, 2, p.straw);
  part(2, 8, 2, 5, p.wood);
  part(12, 8, 2, 5, p.wood);
  fill(4, 9, 8, 1, p.accent);
}

function drawLamp(part: PartFn, fill: PartFn, p: PlacePalette): void {
  part(7, 7, 2, 8, p.iron);
  part(5, 3, 6, 5, p.accent);
  fill(6, 4, 4, 3, p.straw);
  part(6, 14, 4, 2, p.stone);
}

function drawBoard(part: PartFn, fill: PartFn, p: PlacePalette): void {
  part(3, 3, 10, 10, p.wood);
  fill(4, 4, 8, 8, p.straw);
  part(5, 6, 6, 1, p.iron);
  part(5, 8, 5, 1, p.iron);
  part(6, 13, 4, 2, p.wood);
}

function drawSign(part: PartFn, fill: PartFn, p: PlacePalette): void {
  part(7, 6, 2, 9, p.wood);
  part(3, 3, 10, 5, p.straw);
  fill(4, 4, 8, 3, p.accent);
}

function drawSwing(part: PartFn, fill: PartFn, p: PlacePalette): void {
  part(2, 2, 2, 12, p.wood);
  part(12, 2, 2, 12, p.wood);
  part(2, 2, 12, 2, p.wood);
  fill(6, 4, 1, 7, p.iron);
  fill(9, 4, 1, 7, p.iron);
  part(5, 11, 6, 2, p.straw);
}

function drawCafe(part: PartFn, fill: PartFn, p: PlacePalette): void {
  part(5, 6, 6, 8, p.iron);
  fill(6, 8, 4, 5, p.accent);
  part(6, 4, 4, 3, p.wood);
  fill(7, 3, 2, 2, p.straw);
}

function drawShelf(part: PartFn, fill: PartFn, p: PlacePalette): void {
  part(3, 3, 10, 12, p.wood);
  part(4, 5, 8, 2, p.straw);
  part(4, 8, 8, 2, p.accent);
  part(4, 11, 8, 2, p.wheat);
}

function drawBar(part: PartFn, fill: PartFn, p: PlacePalette): void {
  part(1, 9, 14, 5, p.wood);
  fill(2, 10, 12, 3, p.straw);
  part(3, 6, 3, 4, p.accent);
  part(10, 5, 4, 5, p.iron);
}

function drawLaundry(part: PartFn, fill: PartFn, p: PlacePalette): void {
  part(2, 4, 1, 10, p.wood);
  part(13, 4, 1, 10, p.wood);
  part(2, 5, 12, 1, p.iron);
  part(4, 6, 3, 5, p.straw);
  part(9, 6, 3, 5, p.accent);
}

function shade(color: string, factor: number): string {
  const hex = color.replace('#', '');
  if (hex.length !== 6) return color;
  const dim = (i: number): string => {
    const v = Math.round(parseInt(hex.slice(i, i + 2), 16) * factor);
    return Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0');
  };
  return `#${dim(0)}${dim(2)}${dim(4)}`;
}

export type AsciiCell = { readonly x: number; readonly y: number };

export type WallCluster = {
  readonly cells: readonly AsciiCell[];
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly door?: AsciiCell;
};

function parseRows(
  layoutAscii: string | undefined,
  width: number,
  height: number,
): string[] {
  const rows = (layoutAscii ?? '')
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.trimEnd());
  while (rows.length < height) rows.push('');
  return rows.slice(0, height);
}

function cellAt(rows: readonly string[], x: number, y: number): string {
  return rows[y]?.[x] ?? '.';
}

function isWallChar(ch: string): boolean {
  return ch === '#' || ch === 'X';
}

/**
 * Interior `#`/`X` blobs — the map ring is skipped so we do not roof the
 * whole region.
 */
export function interiorWallClusters(
  layoutAscii: string | undefined,
  width: number,
  height: number,
): WallCluster[] {
  const rows = parseRows(layoutAscii, width, height);
  const seen = new Set<string>();
  const keyOf = (x: number, y: number) => `${x},${y}`;
  const out: WallCluster[] = [];
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      if (!isWallChar(cellAt(rows, x, y)) || seen.has(keyOf(x, y))) continue;
      const cells: AsciiCell[] = [];
      const stack = [{ x, y }];
      seen.add(keyOf(x, y));
      while (stack.length) {
        const cur = stack.pop()!;
        cells.push(cur);
        for (const [dx, dy] of dirs) {
          const nx = cur.x + dx;
          const ny = cur.y + dy;
          if (nx <= 0 || ny <= 0 || nx >= width - 1 || ny >= height - 1) continue;
          if (!isWallChar(cellAt(rows, nx, ny))) continue;
          const k = keyOf(nx, ny);
          if (seen.has(k)) continue;
          seen.add(k);
          stack.push({ x: nx, y: ny });
        }
      }
      if (cells.length < 3) continue;
      let minX = width;
      let maxX = 0;
      let minY = height;
      let maxY = 0;
      for (const c of cells) {
        if (c.x < minX) minX = c.x;
        if (c.x > maxX) maxX = c.x;
        if (c.y < minY) minY = c.y;
        if (c.y > maxY) maxY = c.y;
      }
      const inCluster = new Set(cells.map((c) => `${c.x},${c.y}`));
      let door: AsciiCell | undefined;
      for (let dy = maxY; dy >= minY && !door; dy -= 1) {
        for (let dx = minX; dx <= maxX; dx += 1) {
          if (inCluster.has(`${dx},${dy}`)) continue;
          if (isWallChar(cellAt(rows, dx, dy)) || cellAt(rows, dx, dy) === '~') {
            continue;
          }
          const nextToWall = dirs.some(([ox, oy]) =>
            inCluster.has(`${dx + ox},${dy + oy}`),
          );
          if (nextToWall) {
            door = { x: dx, y: dy };
            break;
          }
        }
      }
      if (!door) {
        for (const c of cells) {
          const south = { x: c.x, y: c.y + 1 };
          if (
            south.y < height - 1 &&
            !isWallChar(cellAt(rows, south.x, south.y)) &&
            cellAt(rows, south.x, south.y) !== '~'
          ) {
            door = south;
            break;
          }
        }
      }
      out.push({ cells, minX, maxX, minY, maxY, door });
    }
  }
  return out;
}

/** Walkable tiles around a field/coop so one object still reads as a plot. */
export function placePadCells(
  origin: AsciiCell,
  kind: 'field' | 'coop',
  width: number,
  height: number,
  layoutAscii?: string,
): AsciiCell[] {
  const rows = parseRows(layoutAscii, width, height);
  const walkable = (x: number, y: number): boolean => {
    if (x < 1 || y < 1 || x >= width - 1 || y >= height - 1) return false;
    const ch = cellAt(rows, x, y);
    return ch !== '#' && ch !== 'X' && ch !== '~';
  };
  const offsets =
    kind === 'coop'
      ? [
          [0, 0],
          [-1, 0],
          [1, 0],
          [0, 1],
        ]
      : [
          [0, 0],
          [-1, 0],
          [1, 0],
          [0, -1],
          [-1, -1],
          [1, -1],
        ];
  const cells: AsciiCell[] = [];
  for (const [dx, dy] of offsets) {
    const x = origin.x + dx;
    const y = origin.y + dy;
    if (walkable(x, y)) cells.push({ x, y });
    if (cells.length >= 3) break;
  }
  return cells;
}

export function hashedPlaceCell(
  id: string,
  width: number,
  height: number,
): AsciiCell {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) | 0;
  return {
    x: 2 + (Math.abs(h) % Math.max(1, width - 4)),
    y: 2 + ((Math.abs(h) >> 8) % Math.max(1, height - 4)),
  };
}

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) | 0;
  return h;
}

function cellsOfChar(
  rows: readonly string[],
  width: number,
  height: number,
  ch: string,
): AsciiCell[] {
  const out: AsciiCell[] = [];
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      if (cellAt(rows, x, y) === ch) out.push({ x, y });
    }
  }
  return out;
}

function pickNth<T>(items: readonly T[], id: string): T | undefined {
  if (!items.length) return undefined;
  return items[Math.abs(hashId(id)) % items.length];
}

/** `*` shrubs / plaza trees — drawn as canopies, not orange tile dots. */
export function decorCells(
  layoutAscii: string | undefined,
  width: number,
  height: number,
): AsciiCell[] {
  return cellsOfChar(parseRows(layoutAscii, width, height), width, height, '*');
}

export function interiorWallCellKeys(
  layoutAscii: string | undefined,
  width: number,
  height: number,
): Set<string> {
  const keys = new Set<string>();
  for (const cluster of interiorWallClusters(layoutAscii, width, height)) {
    for (const c of cluster.cells) keys.add(`${c.x},${c.y}`);
  }
  return keys;
}

/** Minimap fill so the inset is a tiny town, not a dead-green slab. */
export function minimapTerrainFill(
  ch: string,
  opts: { interiorWall?: boolean; far?: boolean } = {},
): { color: number; alpha: number } {
  if (opts.interiorWall) return { color: 0x9a3412, alpha: 0.92 };
  if (ch === '#' || ch === 'X') return { color: 0x334155, alpha: 0.9 };
  if (ch === '~') return { color: 0x1d4e89, alpha: 0.9 };
  if (ch === '=') return { color: 0xa16207, alpha: 0.82 };
  if (ch === '*') return { color: 0x3f6212, alpha: 0.88 };
  if (opts.far) return { color: 0x243d4a, alpha: 0.7 };
  return { color: 0x1a3d2a, alpha: 0.88 };
}

/**
 * Snap a landmark onto a matching footprint when the Spec has no x/y —
 * 喷泉 sits on the water, 鸡舍 on the coop door, 麦田 in the open plot.
 */
export function placeAnchorCell(
  name: string,
  id: string,
  region: { width: number; height: number; layoutAscii?: string },
): AsciiCell {
  const fallback = hashedPlaceCell(id, region.width, region.height);
  const kind = placeKindFromName(name);
  const rows = parseRows(region.layoutAscii, region.width, region.height);
  const clusters = interiorWallClusters(
    region.layoutAscii,
    region.width,
    region.height,
  );
  const stars = cellsOfChar(rows, region.width, region.height, '*');
  const water = cellsOfChar(rows, region.width, region.height, '~');
  const paths = cellsOfChar(rows, region.width, region.height, '=');

  if ((kind === 'coop' || kind === 'mine') && clusters.length) {
    const ordered = [...clusters].sort((a, b) => a.cells.length - b.cells.length);
    const pick = kind === 'coop' ? ordered[0]! : ordered[ordered.length - 1]!;
    return pick.door ?? { x: pick.minX + 1, y: pick.maxY };
  }
  if (
    (kind === 'forge' || kind === 'oven' || kind === 'bar' || kind === 'shelf') &&
    clusters.length
  ) {
    const pick = pickNth(clusters, id)!;
    return pick.door ?? { x: pick.minX + 1, y: pick.maxY };
  }
  if (kind === 'fountain') {
    return pickNth(water, id) ?? pickNth(stars, id) ?? fallback;
  }
  if (kind === 'tree' || kind === 'bench' || kind === 'swing') {
    return pickNth(stars, id) ?? fallback;
  }
  if (kind === 'lamp' || kind === 'sign') {
    return pickNth(paths, id) ?? fallback;
  }
  if (kind === 'field') {
    for (let y = 2; y < region.height - 2; y += 1) {
      for (let x = 3; x < region.width - 3; x += 1) {
        const ch = cellAt(rows, x, y);
        if (ch !== '.') continue;
        const nearWall =
          isWallChar(cellAt(rows, x - 1, y)) ||
          isWallChar(cellAt(rows, x + 1, y)) ||
          isWallChar(cellAt(rows, x, y + 1));
        if (!nearWall) return { x, y };
      }
    }
  }
  if (kind === 'well') {
    const open = cellsOfChar(rows, region.width, region.height, '.').filter(
      (c) => c.y > region.height / 2,
    );
    return pickNth(open, id) ?? fallback;
  }
  return fallback;
}
