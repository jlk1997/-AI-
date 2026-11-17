/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import {
  drawPlaceSprite,
  interiorWallClusters,
  minimapTerrainFill,
  placeAnchorCell,
  placeKindFromName,
  placePalette,
  placeSpriteLayout,
  placeTextureKey,
  type PlaceKind,
} from '../scaffold/src/ui/placeSprite';

type Painted = { x: number; y: number; w: number; h: number; color: string };

function record(): {
  calls: Painted[];
  paint: (x: number, y: number, w: number, h: number, color: string) => void;
} {
  const calls: Painted[] = [];
  return {
    calls,
    paint: (x, y, w, h, color) => calls.push({ x, y, w, h, color }),
  };
}

describe('placeKindFromName', () => {
  it('classifies farm and workshop landmarks', () => {
    expect(placeKindFromName('鸡舍')).toBe('coop');
    expect(placeKindFromName('鸡窝')).toBe('coop');
    expect(placeKindFromName('coop')).toBe('coop');
    expect(placeKindFromName('hen')).toBe('coop');
    expect(placeKindFromName('chicken')).toBe('coop');
    expect(placeKindFromName('麦田')).toBe('field');
    expect(placeKindFromName('田垄')).toBe('field');
    expect(placeKindFromName('铁匠炉')).toBe('forge');
    expect(placeKindFromName('壁炉')).toBe('oven');
    expect(placeKindFromName('喷泉')).toBe('fountain');
    expect(placeKindFromName('水井')).toBe('well');
    expect(placeKindFromName('布摊')).toBe('stall');
    expect(placeKindFromName('客房床')).toBe('bed');
    expect(placeKindFromName('矿道口')).toBe('mine');
    expect(placeKindFromName('铁匠铺')).toBe('forge');
    expect(placeKindFromName('面包铺')).toBe('stall');
    expect(placeKindFromName('布告栏')).toBe('board');
    expect(placeKindFromName('长椅')).toBe('bench');
    expect(placeKindFromName('街灯')).toBe('lamp');
    expect(placeKindFromName('秋千')).toBe('swing');
    expect(placeKindFromName('咖啡壶')).toBe('cafe');
  });

  it('does not call a dorm a coop', () => {
    expect(placeKindFromName('宿舍')).toBe('generic');
    expect(placeKindFromName('宿舍床')).toBe('bed');
  });
});

describe('placeSpriteLayout', () => {
  it('defaults to a 32×32 still (2× logical 16)', () => {
    const layout = placeSpriteLayout(2);
    expect(layout.size).toBe(32);
    expect(placeTextureKey('coop')).toBe('place_coop');
  });
});

describe('drawPlaceSprite', () => {
  it('paints inside the frame only', () => {
    const layout = placeSpriteLayout(2);
    const { calls, paint } = record();
    drawPlaceSprite(paint, 'coop', placePalette('coop'), layout);
    expect(calls.length).toBeGreaterThan(8);
    for (const call of calls) {
      expect(call.x).toBeGreaterThanOrEqual(-1);
      expect(call.y).toBeGreaterThanOrEqual(-1);
      expect(call.x + call.w).toBeLessThanOrEqual(layout.size + 1);
      expect(call.y + call.h).toBeLessThanOrEqual(layout.size + 1);
      expect(call.color).toMatch(/^#[0-9a-f]{3,8}$/i);
    }
  });

  it('draws a coop with a roof and a fence', () => {
    const layout = placeSpriteLayout(2);
    const palette = placePalette('coop-yard');
    const { calls, paint } = record();
    drawPlaceSprite(paint, 'coop', palette, layout);
    const colors = new Set(calls.map((c) => c.color));
    expect(colors.has(palette.roof) || colors.has(palette.roofDark)).toBe(true);
    expect(colors.has(palette.wood)).toBe(true);
    const roof = calls.filter(
      (c) => c.color === palette.roof || c.color === palette.roofDark,
    );
    const fence = calls.filter((c) => c.color === palette.wood);
    const roofTop = Math.min(...roof.map((c) => c.y));
    const fenceBottom = Math.max(...fence.map((c) => c.y + c.h));
    expect(roofTop).toBeLessThan(fenceBottom);
  });

  it('draws a different silhouette per kind', () => {
    const layout = placeSpriteLayout(2);
    const palette = placePalette('kinds');
    const shape = (kind: PlaceKind): string => {
      const { calls, paint } = record();
      drawPlaceSprite(paint, kind, palette, layout);
      return JSON.stringify(calls.map((c) => [c.x, c.y, c.w, c.h, c.color]));
    };
    expect(shape('coop')).not.toBe(shape('field'));
    expect(shape('forge')).not.toBe(shape('well'));
    expect(shape('fountain')).not.toBe(shape('generic'));
  });
});

describe('interiorWallClusters', () => {
  it('roofs interior buildings and skips the map ring', () => {
    const ascii = [
      '##########',
      '#........#',
      '#.##.....#',
      '#.#......#',
      '#.##.....#',
      '#........#',
      '##########',
    ].join('\n');
    const clusters = interiorWallClusters(ascii, 10, 7);
    expect(clusters.length).toBe(1);
    expect(clusters[0]!.cells.length).toBeGreaterThanOrEqual(5);
    expect(clusters[0]!.door).toEqual({ x: 3, y: 3 });
  });
});

describe('minimapTerrainFill', () => {
  it('does not paint the whole inset dead green', () => {
    const ground = minimapTerrainFill('.');
    const roof = minimapTerrainFill('#', { interiorWall: true });
    const water = minimapTerrainFill('~');
    const tree = minimapTerrainFill('*');
    expect(ground.color).not.toBe(0x14532d);
    expect(roof.color).toBe(0x9a3412);
    expect(water.color).toBe(0x1d4e89);
    expect(tree.color).toBe(0x3f6212);
  });
});

describe('placeAnchorCell', () => {
  it('sits a fountain on water and a shop on a door', () => {
    const ascii = [
      '##########',
      '#........#',
      '#.##.....#',
      '#.#..~~..#',
      '#.##.....#',
      '#....**..#',
      '##########',
    ].join('\n');
    const region = { width: 10, height: 7, layoutAscii: ascii };
    const fountain = placeAnchorCell('喷泉', 'obj_fountain', region);
    expect(ascii.split('\n')[fountain.y]?.[fountain.x]).toBe('~');
    const forge = placeAnchorCell('铁匠炉', 'obj_forge', region);
    expect(forge).toEqual({ x: 3, y: 3 });
  });
});
