/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import {
  createDungeonWorld,
  createEmptyTownWorld,
  createForestWorld,
} from './schema.js';
import {
  compileWorldToGameSeed,
  validateSeedGameDsl,
  WORLD_GAME_SEED_SCHEMA,
} from './toGameSeed.js';

describe('compileWorldToGameSeed', () => {
  it('compiles the dungeon world into a valid game.json', () => {
    const world = createDungeonWorld({ id: 'w_dungeon' });
    const seed = compileWorldToGameSeed(world);

    expect(seed.schema).toBe(WORLD_GAME_SEED_SCHEMA);
    expect(validateSeedGameDsl(seed.game)).toEqual([]);
    expect(seed.game.scenes).toHaveLength(world.space.regions.length);
    expect(seed.game.initialSceneId).toBe('dungeon_hall');
    expect(seed.game.scenes.every((s) => s.layoutOnly === true)).toBe(true);
    expect(seed.stats).toMatchObject({
      regions: 3,
      enemies: 2,
      items: 1,
      quests: 1,
      portals: 4,
    });
  });

  it('is deterministic — same spec compiles byte-identically', () => {
    const world = createDungeonWorld({ id: 'w_stable' });
    const a = compileWorldToGameSeed(world);
    const b = compileWorldToGameSeed(world);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('keeps every region / entity / quest / rule id reachable in the DSL', () => {
    const world = createEmptyTownWorld({ id: 'w_town' });
    const seed = compileWorldToGameSeed(world);
    const json = JSON.stringify(seed.game);

    for (const region of world.space.regions) {
      expect(seed.lineage.sceneIdByRegionId[region.id]).toBeTruthy();
      expect(json).toContain(seed.lineage.sceneIdByRegionId[region.id]!);
    }
    for (const entity of world.entities) {
      expect(json).toContain(`"${entity.id}"`);
    }
    for (const quest of world.narrative.quests) {
      expect(json).toContain(`"${quest.id}"`);
    }
    for (const rule of world.rules) {
      expect(json).toContain(`"${rule.id}"`);
    }
    for (const portal of world.space.portals) {
      expect(json).toContain(`"${portal.id}"`);
    }
  });

  it('places a player and keeps every entity inside the canvas', () => {
    const seed = compileWorldToGameSeed(createForestWorld({ id: 'w_forest' }));
    // Read the canvas off the compiled seed — a duplicated constant here went
    // stale the moment the base resolution was raised.
    const canvas = seed.game.meta.canvas;
    for (const scene of seed.game.scenes) {
      const player = scene.entities.find((e) => e.tags.includes('player'));
      expect(player, `scene ${scene.id} needs a player`).toBeTruthy();
      for (const entity of scene.entities) {
        expect(entity.sprite.x).toBeGreaterThanOrEqual(0);
        expect(entity.sprite.x).toBeLessThanOrEqual(canvas.width);
        expect(entity.sprite.y).toBeGreaterThanOrEqual(0);
        expect(entity.sprite.y).toBeLessThanOrEqual(canvas.height);
      }
    }
  });

  it('wires portals to real scene transitions', () => {
    const world = createDungeonWorld({ id: 'w_portals' });
    const seed = compileWorldToGameSeed(world);
    const sceneIds = new Set(seed.game.scenes.map((s) => s.id));

    let transitions = 0;
    for (const scene of seed.game.scenes) {
      for (const entity of scene.entities) {
        for (const behavior of entity.behaviors ?? []) {
          if (behavior.kind !== 'sceneTransition') continue;
          transitions += 1;
          const target = behavior.options?.['targetSceneId'];
          expect(typeof target).toBe('string');
          expect(sceneIds.has(String(target))).toBe(true);
        }
      }
    }
    expect(transitions).toBe(world.space.portals.length);
  });

  it('turns items into a collect-to-win loop', () => {
    const world = createEmptyTownWorld({ id: 'w_items' });
    const seed = compileWorldToGameSeed(world);
    const itemCount = world.entities.filter((e) => e.kind === 'item').length;
    const pickups = seed.game.scenes
      .flatMap((s) => s.entities)
      .flatMap((e) => e.behaviors ?? [])
      .filter(
        (b) =>
          b.kind === 'collectOnTouch' && Number(b.options?.['winAt'] ?? 0) > 0,
      );

    expect(pickups).toHaveLength(itemCount);
    for (const pickup of pickups) {
      expect(pickup.options?.['winAt']).toBe(itemCount * 10);
    }
  });

  it('wires enemies with chase + contact damage so L2 HP tunables matter', () => {
    const seed = compileWorldToGameSeed(createDungeonWorld({ id: 'w_combat' }), {
      tunables: { contactDamage: 2, playerHp: 16, enemyHpScale: 1.25 },
      tunablesSource: 'l2-hybrid-world-model',
    });
    const enemies = seed.game.scenes
      .flatMap((s) => s.entities)
      .filter((e) => e.tags.includes('enemy'));
    expect(enemies.length).toBeGreaterThan(0);
    for (const enemy of enemies) {
      const kinds = new Set((enemy.behaviors ?? []).map((b) => b.kind));
      expect(kinds.has('chase')).toBe(true);
      expect(kinds.has('damageOnTouch')).toBe(true);
      const dmg = (enemy.behaviors ?? []).find((b) => b.kind === 'damageOnTouch');
      // Prefer entity.attrs.atk when present; otherwise the contactDamage tunable.
      expect(Number(dmg?.options?.['amount'])).toBeGreaterThanOrEqual(2);
      expect(dmg?.options?.['initialHp']).toBe(16);
      expect(enemy.state?.['hp']).toBeGreaterThan(0);
    }
    expect(seed.game.rules.lose).toContain('HP reaches 0');
    const player = seed.game.scenes[0]!.entities.find((e) =>
      e.tags.includes('player'),
    );
    expect(player?.state?.['hp']).toBe(16);
  });

  it('only emits behaviors the runtime can execute', () => {
    const known = new Set([
      'patrol',
      'chase',
      'shoot',
      'eightWayMovement',
      'velocity',
      'lifetime',
      'spawner',
      'bounds',
      'draggable',
      'gridSnap',
      'dialog',
      'sceneTransition',
      'collectOnTouch',
      'damageOnTouch',
    ]);
    for (const factory of [createDungeonWorld, createEmptyTownWorld, createForestWorld]) {
      const seed = compileWorldToGameSeed(factory({ id: 'w_behaviors' }));
      for (const scene of seed.game.scenes) {
        for (const entity of scene.entities) {
          for (const behavior of entity.behaviors ?? []) {
            expect(known.has(behavior.kind), behavior.kind).toBe(true);
          }
        }
      }
    }
  });

  it('attaches dialog behavior to every dialogue NPC in a scene', () => {
    const seed = compileWorldToGameSeed(createEmptyTownWorld({ id: 'w_dialog' }));
    const dialogNpcs = seed.game.scenes.flatMap((scene) =>
      scene.entities.filter((e) =>
        (e.behaviors ?? []).some((b) => b.kind === 'dialog'),
      ),
    );
    expect(dialogNpcs.length).toBeGreaterThanOrEqual(2);
    const speakers = new Set(
      (seed.game.dialogue ?? []).map((l) => l.speaker).filter(Boolean),
    );
    expect(speakers.size).toBeGreaterThanOrEqual(2);
  });

  it('applies L2 tunables and clamps hostile values', () => {
    const world = createDungeonWorld({ id: 'w_tunables' });
    const seed = compileWorldToGameSeed(world, {
      tunables: { enemySpeed: 9999, enemyHpScale: 1.5, playerSpeed: Number.NaN },
      tunablesSource: 'l2-hybrid-world-model',
    });

    expect(seed.tunables['enemySpeed']).toBe(260);
    expect(seed.tunables['enemyHpScale']).toBe(1.5);
    expect(seed.tunables['playerSpeed']).toBe(190);
    expect(seed.tunablesSource).toBe('l2-hybrid-world-model');
    expect(seed.summaryLines.join('\n')).toContain('l2-hybrid-world-model');

    const warden = seed.game.scenes
      .flatMap((s) => s.entities)
      .find((e) => e.id === 'enemy_warden');
    // 20 hp × 1.5 scale
    expect(warden?.state?.['hp']).toBe(30);
  });

  it('never emits runtime-dead DSL fields', () => {
    const seed = compileWorldToGameSeed(createDungeonWorld({ id: 'w_clean' }));
    const root = seed.game as unknown as Record<string, unknown>;
    for (const key of ['gameFlow', 'sceneConfig', 'tunable', 'spawners']) {
      expect(root[key]).toBeUndefined();
    }
    expect(Object.keys(seed.game.rules).sort()).toEqual([
      'lose',
      'scoreLabel',
      'win',
    ]);
    for (const scene of seed.game.scenes) {
      const row = scene as unknown as Record<string, unknown>;
      expect(row['rules']).toBeUndefined();
      expect(row['spawners']).toBeUndefined();
      expect(row['entities_templates']).toBeUndefined();
      expect(row['customModule']).toBeUndefined();
    }
  });

  it('derives an asset brief from the style anchor', () => {
    const world = createDungeonWorld({ id: 'w_assets' });
    const seed = compileWorldToGameSeed(world);
    expect(seed.assetBrief.artStyle).toBe(world.styleAnchor.artStyle);
    // Default art direction is high fidelity, not the old hardcoded pixel.
    expect(seed.assetBrief.artStyle).toContain('hand-painted');
    expect(seed.assetBrief.artStyle).toContain('dungeon');
    expect(seed.assetBrief.palette).toEqual(world.styleAnchor.palette);
    expect(seed.assetBrief.prompts.player).toContain('Delver');
    expect(Object.keys(seed.assetBrief.regionBackgroundPrompts)).toEqual(
      world.space.regions.map((r) => r.id),
    );
  });

  it('stamps renderer knobs on game meta so Phaser stops guessing', () => {
    const painterly = compileWorldToGameSeed(
      createDungeonWorld({ id: 'w_paint' }),
    );
    expect(painterly.game.meta.pixelPerfect).toBe(false);
    expect(painterly.game.meta.artStyleId).toBe('hand_painted');
    // 960x640 was upscaled by Scale.FIT on any modern display.
    expect(painterly.game.meta.canvas.width).toBeGreaterThanOrEqual(1280);

    const pixel = compileWorldToGameSeed(
      createDungeonWorld({ id: 'w_pixel', artStyleId: 'fine_pixel' }),
    );
    expect(pixel.game.meta.pixelPerfect).toBe(true);
    expect(pixel.game.meta.artStyleId).toBe('fine_pixel');
  });
});
