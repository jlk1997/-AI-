/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import {
  CHAR_FRAMES_PER_DIR,
  WALK_DIRS,
  charFrameName,
  charFrameRect,
  characterPalette,
  characterSheetLayout,
  drawCharacterSheet,
  type WalkDir,
} from '../scaffold/src/ui/characterSprite';

type Painted = { x: number; y: number; w: number; h: number; color: string };

function record(): { calls: Painted[]; paint: (x: number, y: number, w: number, h: number, color: string) => void } {
  const calls: Painted[] = [];
  return {
    calls,
    paint: (x, y, w, h, color) => calls.push({ x, y, w, h, color }),
  };
}

describe('characterSheetLayout', () => {
  it('lays out 4 directions of 3 frames', () => {
    const layout = characterSheetLayout(3);
    expect(layout.sheetW).toBe(layout.cellW * CHAR_FRAMES_PER_DIR);
    expect(layout.sheetH).toBe(layout.cellH * WALK_DIRS.length);
  });

  it('gives every frame its own cell', () => {
    const layout = characterSheetLayout();
    const seen = new Set<string>();
    for (const dir of WALK_DIRS) {
      for (let frame = 0; frame < CHAR_FRAMES_PER_DIR; frame += 1) {
        const rect = charFrameRect(dir, frame, layout);
        expect(rect.x + rect.w).toBeLessThanOrEqual(layout.sheetW);
        expect(rect.y + rect.h).toBeLessThanOrEqual(layout.sheetH);
        seen.add(`${rect.x},${rect.y}`);
      }
    }
    expect(seen.size).toBe(WALK_DIRS.length * CHAR_FRAMES_PER_DIR);
  });

  it('names frames the way generated walk atlases do', () => {
    expect(charFrameName('down', 0)).toBe('walk_down_0');
    expect(charFrameName('up', 2)).toBe('walk_up_2');
  });
});

describe('characterPalette', () => {
  it('is stable per resident', () => {
    expect(characterPalette('npc_mara')).toEqual(characterPalette('npc_mara'));
  });

  it('varies between residents', () => {
    const looks = new Set(
      ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id) =>
        JSON.stringify(characterPalette(`npc_${id}`)),
      ),
    );
    expect(looks.size).toBeGreaterThan(4);
  });

  it('dresses residents in the world palette when the Spec has one', () => {
    const styled = ['#8d6e63', '#c5a25d', '#4e6e58'];
    const worn = new Set<string>();
    for (let i = 0; i < 24; i += 1) {
      worn.add(characterPalette(`npc_${i}`, styled).top);
    }
    expect([...worn].some((c) => styled.includes(c))).toBe(true);
  });

  it('ignores palette entries that are not colours', () => {
    const palette = characterPalette('npc_x', ['not-a-color', '']);
    expect(palette.top).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe('drawCharacterSheet', () => {
  it('paints inside the sheet only', () => {
    const layout = characterSheetLayout(3);
    const { calls, paint } = record();
    drawCharacterSheet(paint, characterPalette('npc_mara'), layout);
    expect(calls.length).toBeGreaterThan(100);
    for (const call of calls) {
      // A 1px outline may bleed by one pixel; nothing may land in another cell.
      expect(call.x).toBeGreaterThanOrEqual(-1);
      expect(call.y).toBeGreaterThanOrEqual(-1);
      expect(call.x + call.w).toBeLessThanOrEqual(layout.sheetW + 1);
      expect(call.y + call.h).toBeLessThanOrEqual(layout.sheetH + 1);
      expect(call.color).toMatch(/^#[0-9a-f]{3,8}$/i);
    }
  });

  it('draws a different silhouette per walk frame', () => {
    const layout = characterSheetLayout(3);
    const shapeOf = (dir: WalkDir, frame: number): string => {
      const { calls, paint } = record();
      drawCharacterSheet(paint, characterPalette('npc_mara'), layout);
      const rect = charFrameRect(dir, frame, layout);
      return JSON.stringify(
        calls
          .filter(
            (c) =>
              c.x >= rect.x - 1 &&
              c.x < rect.x + rect.w &&
              c.y >= rect.y - 1 &&
              c.y < rect.y + rect.h,
          )
          .map((c) => [c.x - rect.x, c.y - rect.y, c.w, c.h]),
      );
    };
    expect(shapeOf('down', 0)).not.toBe(shapeOf('down', 1));
    expect(shapeOf('down', 1)).not.toBe(shapeOf('down', 2));
  });

  it('faces the four directions differently', () => {
    const layout = characterSheetLayout(3);
    const colorsIn = (dir: WalkDir): string => {
      const { calls, paint } = record();
      drawCharacterSheet(paint, characterPalette('npc_mara'), layout);
      const rect = charFrameRect(dir, 0, layout);
      return JSON.stringify(
        calls
          .filter(
            (c) =>
              c.y >= rect.y - 1 && c.y < rect.y + rect.h && c.x < rect.x + rect.w,
          )
          .map((c) => [c.x - rect.x, c.y - rect.y, c.color]),
      );
    };
    const looks = new Set(WALK_DIRS.map(colorsIn));
    expect(looks.size).toBe(WALK_DIRS.length);
  });
});
