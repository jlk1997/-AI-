/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  buildWalkAtlasJson,
  defaultWalkLayout,
  walkCycleFramePlan,
  walkCyclePrompts,
  walkDirectionAllowsFlop,
} from './atlas.js';
import { asciiToTileGids, ySortDepth } from './tileset.js';

describe('asset-forge', () => {
  it('builds 4x3 walk atlas', () => {
    const json = buildWalkAtlasJson('player_walk.png');
    expect(Object.keys(json.frames).length).toBe(12);
    expect(json.animations?.walk_down?.length).toBe(3);
    expect(json.meta.size.w).toBe(defaultWalkLayout().sheetWidth);
  });

  it('parses ascii tilemap', () => {
    const { width, height, gids } = asciiToTileGids('###\n#.#\n###');
    expect(width).toBe(3);
    expect(height).toBe(3);
    expect(gids.length).toBe(9);
    expect(gids[0]).toBeGreaterThan(0);
  });

  it('y-sort increases with y', () => {
    expect(ySortDepth(100)).toBeGreaterThan(ySortDepth(50));
  });
});

describe('walk cycle', () => {
  it('asks for a distinct stride per cycle slot', () => {
    const prompts = walkCyclePrompts('hand-painted', 'a baker');
    expect(prompts.left).toHaveLength(3);
    expect(new Set(prompts.left).size).toBe(3);
    expect(prompts.left[0]).toContain('facing left');
    expect(prompts.left[0]).toContain('left leg forward');
    expect(prompts.left[1]).toContain('legs together');
    expect(prompts.down[0]).toContain('front view');
  });

  it('uses every real render when the model supplied a full cycle', () => {
    const plan = walkCycleFramePlan(3, 3);
    expect(plan.map((s) => s.pose)).toEqual([0, 1, 2]);
    expect(plan.every((s) => s.lift === 0 && !s.flop)).toBe(true);
  });

  it('mirrors the contact pose for front and back views', () => {
    const plan = walkCycleFramePlan(3, 2, { allowFlop: true });
    expect(plan[2]).toEqual({ pose: 0, lift: 0, flop: true });
    expect(walkDirectionAllowsFlop('down')).toBe(true);
    expect(walkDirectionAllowsFlop('left')).toBe(false);
  });

  it('varies the lift instead of mirroring a side view', () => {
    const plan = walkCycleFramePlan(3, 2, { allowFlop: false });
    expect(plan[2]?.flop).toBe(false);
    expect(plan[2]?.lift).toBeGreaterThan(0);
  });

  it('still animates when only one render exists', () => {
    const plan = walkCycleFramePlan(3, 1, { allowFlop: false });
    const signatures = plan.map((s) => `${s.pose}:${s.lift}:${s.flop}`);
    expect(new Set(signatures).size).toBeGreaterThan(1);
  });
});
