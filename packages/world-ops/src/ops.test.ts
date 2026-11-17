/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { createEmptyTownWorld } from '@opengame/world-spec';
import { WorldRevisionTree, applyWorldOp } from './ops.js';

describe('world-ops', () => {
  it('edits entity and bumps version', () => {
    const world = createEmptyTownWorld();
    const result = applyWorldOp(world, {
      op: 'edit_entity',
      entityId: 'npc_smith',
      patch: { name: 'Traitor Smith', personality: 'secretly a traitor' },
    });
    expect(result.ok).toBe(true);
    expect(result.world?.entities.find((e) => e.id === 'npc_smith')?.name).toBe(
      'Traitor Smith',
    );
    expect(result.dirtyAssetKeys).toContain('entity:npc_smith');
  });

  it('expands region', () => {
    const world = createEmptyTownWorld();
    const result = applyWorldOp(world, {
      op: 'expand_region',
      region: {
        id: 'whisper_woods',
        name: 'Whisper Woods',
        kind: 'wilderness',
        width: 20,
        height: 16,
      },
    });
    expect(result.ok).toBe(true);
    expect(result.world?.space.regions.some((r) => r.id === 'whisper_woods')).toBe(
      true,
    );
  });

  it('maintains revision tree', () => {
    const tree = new WorldRevisionTree(createEmptyTownWorld());
    tree.apply({
      op: 'set_flag',
      flag: 'demo',
      value: true,
    });
    expect(tree.history.length).toBe(2);
    expect(tree.tip.world.narrative.flags['demo']).toBe(true);
  });

  it('adds quest and edits dialogue', () => {
    const world = createEmptyTownWorld();
    const quested = applyWorldOp(world, {
      op: 'add_quest',
      quest: {
        id: 'q_scrap',
        title: 'Scrap iron',
        description: 'Bring scrap to the smith',
        giverEntityId: 'npc_smith',
        status: 'available',
        steps: [],
        onComplete: [],
      },
    });
    expect(quested.ok).toBe(true);
    expect(quested.world?.narrative.quests.some((q) => q.id === 'q_scrap')).toBe(
      true,
    );

    const dlg = applyWorldOp(quested.world!, {
      op: 'edit_dialogue',
      entityId: 'npc_smith',
      dialogueSeed: 'Three new lines for the forge.',
    });
    expect(dlg.ok).toBe(true);
    expect(
      dlg.world?.entities.find((e) => e.id === 'npc_smith')?.dialogueSeed,
    ).toBe('Three new lines for the forge.');
    expect(dlg.dirtyAssetKeys).toContain('entity:npc_smith');
  });

  it('sets genre profile and clock', () => {
    const world = createEmptyTownWorld();
    const profiled = applyWorldOp(world, {
      op: 'set_genre_profile',
      profile: {
        id: 'society.crew',
        clock: { kind: 'watch', shifts: 3 },
        viewer: 'observer',
        population: { min: 6, max: 14 },
        topology: { minRegions: 2, maxRegions: 4 },
        verbs: ['whisper', 'set_object'],
        hubKind: 'bridge',
      },
    });
    expect(profiled.ok).toBe(true);
    expect(profiled.world?.presentation.genreProfile?.id).toBe('society.crew');
    const clocked = applyWorldOp(profiled.world!, {
      op: 'set_clock',
      clock: { kind: 'watch', shifts: 4 },
    });
    expect(clocked.ok).toBe(true);
    expect(clocked.world?.presentation.genreProfile?.clock).toEqual({
      kind: 'watch',
      shifts: 4,
    });
  });

  it('adds a reachable region with hub portals and a stub area', () => {
    const world = createEmptyTownWorld();
    const start = world.space.startRegionId;
    const result = applyWorldOp(world, {
      op: 'add_region',
      region: {
        id: 'net_yard',
        name: '晒网场',
        kind: 'interior',
        width: 16,
        height: 12,
      },
    });
    expect(result.ok).toBe(true);
    expect(result.world?.space.regions.some((r) => r.id === 'net_yard')).toBe(true);
    expect(
      result.world?.space.portals.some(
        (p) => p.fromRegionId === start && p.toRegionId === 'net_yard',
      ),
    ).toBe(true);
    expect(
      result.world?.space.areas.some((a) => a.regionId === 'net_yard'),
    ).toBe(true);
  });

  it('snaps add_entity onto startRegionId when the region is missing', () => {
    const world = createEmptyTownWorld();
    const result = applyWorldOp(world, {
      op: 'add_entity',
      entity: {
        id: 'npc_newcomer',
        kind: 'npc',
        name: 'New Settler',
        regionId: 'does_not_exist',
        pos: { x: 4, y: 4 },
        attrs: {},
        inventory: [],
        tags: [],
        schedule: [],
      },
    });
    expect(result.ok).toBe(true);
    expect(
      result.world?.entities.find((e) => e.id === 'npc_newcomer')?.regionId,
    ).toBe(world.space.startRegionId);
  });
});
