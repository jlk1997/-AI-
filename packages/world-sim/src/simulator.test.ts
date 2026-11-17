/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { createEmptyTownWorld } from '@opengame/world-spec';
import { WorldSimulator, evalCondition } from './simulator.js';

describe('world-sim', () => {
  it('starts quest after talking to smith (flag)', () => {
    const world = createEmptyTownWorld();
    const sim = new WorldSimulator(world);
    sim.applyPlayerEffects([
      { kind: 'set_flag', flag: 'talked_npc_smith', value: true },
    ]);
    const q = sim
      .getWorld()
      .narrative.quests.find((x) => x.id === 'q_fetch_ore');
    expect(q?.status).toBe('active');
    expect(sim.getWorld().narrative.flags['met_smith']).toBe(true);
  });

  it('completes quest when player has ore and talked', () => {
    const world = createEmptyTownWorld();
    const sim = new WorldSimulator(world);
    sim.applyPlayerEffects([
      { kind: 'set_flag', flag: 'talked_npc_smith', value: true },
    ]);
    const afterGive = sim.applyPlayerEffects([
      { kind: 'give_item', entityId: 'player', itemId: 'iron_ore' },
    ]);
    const q = afterGive.world.narrative.quests.find(
      (x) => x.id === 'q_fetch_ore',
    );
    expect(q?.status).toBe('completed');
    expect(afterGive.world.narrative.flags['smith_helped']).toBe(true);
  });

  it('evalCondition handles and/not', () => {
    const world = createEmptyTownWorld();
    expect(
      evalCondition(world, {
        op: 'and',
        all: [
          { op: 'flag', flag: 'met_smith', equals: false },
          { op: 'always' },
        ],
      }),
    ).toBe(true);
  });

  it('includes forest portal and enemy for game loop', () => {
    const world = createEmptyTownWorld();
    expect(world.space.portals.length).toBeGreaterThan(0);
    expect(world.entities.some((e) => e.kind === 'enemy')).toBe(true);
    expect(world.entities.some((e) => e.kind === 'item')).toBe(true);
  });

  it('advances NPC schedule in-region without teleport', () => {
    const world = createEmptyTownWorld();
    const npc = world.entities.find((e) => e.kind === 'npc');
    expect(npc).toBeTruthy();
    if (!npc || npc.kind !== 'npc') return;
    world.timeHours = 8;
    npc.pos = { x: 2, y: 2 };
    npc.schedule = [
      { hour: 8, activity: 'patrol_far_corner', regionId: npc.regionId },
    ];
    const sim = new WorldSimulator(world);
    let prev = { ...npc.pos };
    for (let i = 0; i < 20; i++) {
      sim.tick(0);
      const cur = sim.getWorld().entities.find((e) => e.id === npc.id)!;
      const step =
        Math.abs(cur.pos.x - prev.x) + Math.abs(cur.pos.y - prev.y);
      expect(step).toBeLessThanOrEqual(1);
      prev = { ...cur.pos };
    }
  });
});
