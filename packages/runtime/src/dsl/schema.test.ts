/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';

import {
  DSL_VERSION,
  normalizeGameDsl,
  validateGameDsl,
  isPlausibleDataImageUrl,
  sceneDeferredToCustomPhaser,
  sceneIsLayoutOnly,
  sceneSkippedByDslCompile,
  sceneStartCandidates,
  type GameDsl,
  type SceneSpec,
  type EntitySpec,
} from './schema.js';

describe('isPlausibleDataImageUrl', () => {
  it('accepts minimal valid 1x1 png data url', () => {
    const u =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    expect(isPlausibleDataImageUrl(u)).toBe(true);
  });

  it('rejects truncated or junk base64', () => {
    expect(isPlausibleDataImageUrl('data:image/png;base64,xx')).toBe(false);
    expect(isPlausibleDataImageUrl('data:image/png;base64,xx!')).toBe(false);
    expect(isPlausibleDataImageUrl('data:image/png;base64')).toBe(false);
  });
});

describe('normalizeGameDsl', () => {
  it('maps legacy scene.key to id', () => {
    const raw = {
      dslVersion: DSL_VERSION,
      meta: { title: 'T' },
      scenes: [{ key: 'Boot', entities: [] }],
    };
    const n = normalizeGameDsl(raw) as GameDsl;
    expect(n.scenes[0]!.id).toBe('Boot');
    expect(validateGameDsl(n)).toEqual([]);
  });

  it('fills missing id from name slug', () => {
    const raw = {
      dslVersion: DSL_VERSION,
      meta: { title: 'T' },
      scenes: [{ name: 'Main Menu', entities: [] }],
    };
    const n = normalizeGameDsl(raw) as GameDsl;
    expect(n.scenes[0]!.id).toBe('main_menu');
    expect(validateGameDsl(n)).toEqual([]);
  });

  it('dedupes inferred ids', () => {
    const raw = {
      dslVersion: DSL_VERSION,
      meta: { title: 'T' },
      scenes: [
        { name: 'A', entities: [] },
        { name: 'A', entities: [] },
      ],
    };
    const n = normalizeGameDsl(raw) as GameDsl;
    expect(n.scenes[0]!.id).toBe('a');
    expect(n.scenes[1]!.id).toBe('a_1');
    expect(validateGameDsl(n)).toEqual([]);
  });

  it('accepts scenes as string keys', () => {
    const raw = {
      dslVersion: DSL_VERSION,
      meta: { title: 'T' },
      scenes: ['Boot', 'MainGame', 'GameOver'],
    };
    const n = normalizeGameDsl(raw) as GameDsl;
    expect(n.scenes.map((s) => s.id)).toEqual(['boot', 'maingame', 'gameover']);
    expect(validateGameDsl(n)).toEqual([]);
  });

  it('reads id from metadata when top-level id missing', () => {
    const raw = {
      dslVersion: DSL_VERSION,
      meta: { title: 'T' },
      scenes: [{ metadata: { id: 'Level1' }, entities: [] }],
    };
    const n = normalizeGameDsl(raw) as GameDsl;
    expect(n.scenes[0]!.id).toBe('Level1');
    expect(validateGameDsl(n)).toEqual([]);
  });

  it('normalizes planner-style assets (type/key) to kind/id', () => {
    const tinyPng =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const raw = {
      dslVersion: DSL_VERSION,
      meta: { title: 'T' },
      scenes: [{ key: 'S1', entities: [] }],
      assets: [
        { type: 'image', key: 'a1', url: tinyPng },
        { type: 'image', key: 'skip', url: null },
      ],
    };
    const n = normalizeGameDsl(raw) as GameDsl;
    expect(n.assets).toHaveLength(2);
    expect(n.assets![0]).toMatchObject({
      id: 'a1',
      kind: 'image',
      url: tinyPng,
    });
    expect(n.assets![1]).toMatchObject({ id: 'skip', kind: 'image', url: '' });
    expect(validateGameDsl(n)).toEqual([]);
  });

  it('strips invalid data:image base64 from assets during normalize', () => {
    const raw = {
      dslVersion: DSL_VERSION,
      meta: { title: 'T' },
      scenes: [{ key: 'S1', entities: [] }],
      assets: [{ type: 'image', key: 'bad', url: 'data:image/png;base64,xx' }],
    };
    const n = normalizeGameDsl(raw) as GameDsl;
    expect(n.assets![0]!.url).toBe('');
    expect(validateGameDsl(n)).toEqual([]);
  });

  it('clamps initialSceneId when it does not match any scene id', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const raw = {
      dslVersion: DSL_VERSION,
      meta: { title: 'T' },
      initialSceneId: 'RunnerScene',
      scenes: [{ id: 'parkour_main', entities: [] }],
    };
    const n = normalizeGameDsl(raw) as GameDsl;
    expect(n.initialSceneId).toBe('parkour_main');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('normalizes planner-style entity behaviors object + sprite key + entity x/y', () => {
    const raw = {
      dslVersion: DSL_VERSION,
      meta: { title: 'T' },
      scenes: [
        {
          id: 'main',
          entities: [
            {
              id: 'player',
              x: 100,
              y: 200,
              sprite: { key: 'hero' },
              behaviors: {
                EightWayMovement: { speed: 200 },
                Bounds: { minX: 0, maxX: 960 },
              },
            },
          ],
        },
      ],
    };
    const n = normalizeGameDsl(raw) as GameDsl;
    const ent = n.scenes[0]!.entities[0] as EntitySpec & {
      sprite?: { assetId?: string; x: number; y: number };
    };
    expect(ent.sprite?.assetId).toBe('hero');
    expect(ent.sprite?.x).toBe(100);
    expect(ent.sprite?.y).toBe(200);
    expect(ent.behaviors).toEqual([
      { kind: 'eightWayMovement', options: { speed: 200 } },
      { kind: 'bounds', options: { minX: 0, maxX: 960 } },
    ]);
    expect(validateGameDsl(n)).toEqual([]);
  });
});

describe('validateGameDsl', () => {
  it('rejects non-objects', () => {
    expect(validateGameDsl(null)).toContain('game.json must be a JSON object');
  });

  it('rejects missing scenes', () => {
    const errs = validateGameDsl({ dslVersion: DSL_VERSION, meta: { title: 't' } });
    expect(errs.some((e) => e.includes('scenes'))).toBe(true);
  });

  it('accepts the minimum valid shape', () => {
    const dsl: GameDsl = {
      dslVersion: DSL_VERSION,
      meta: { title: 'Test' },
      scenes: [{ id: 'main', entities: [] }],
    };
    expect(validateGameDsl(dsl)).toEqual([]);
  });

  it('flags duplicate scene ids', () => {
    const dsl: GameDsl = {
      dslVersion: DSL_VERSION,
      meta: { title: 'T' },
      scenes: [
        { id: 'a', entities: [] },
        { id: 'a', entities: [] },
      ],
    };
    expect(validateGameDsl(dsl).some((e) => e.includes('duplicate scene id'))).toBe(true);
  });
});

describe('sceneDeferredToCustomPhaser', () => {
  it('is true when customModule is a non-empty string', () => {
    const spec = {
      id: 'BattleScene',
      entities: [],
      customModule: 'BattleScene',
    } as unknown as SceneSpec;
    expect(sceneDeferredToCustomPhaser(spec)).toBe(true);
  });

  it('is false when customModule missing or blank', () => {
    expect(sceneDeferredToCustomPhaser({ id: 'main', entities: [] })).toBe(false);
    const spec = { id: 'x', entities: [], customModule: '  ' } as unknown as SceneSpec;
    expect(sceneDeferredToCustomPhaser(spec)).toBe(false);
  });
});

describe('sceneIsLayoutOnly / sceneSkippedByDslCompile', () => {
  it('treats layoutOnly world regions as non-compilable', () => {
    const region = {
      id: 'town_square',
      entities: [{ id: 'npc_1', tags: ['npc'], sprite: { x: 1, y: 2 } }],
      layoutOnly: true,
    } as unknown as SceneSpec;
    expect(sceneIsLayoutOnly(region)).toBe(true);
    expect(sceneSkippedByDslCompile(region)).toBe(true);
    expect(sceneDeferredToCustomPhaser(region)).toBe(false);
  });

  it('skips customModule shells via sceneSkippedByDslCompile', () => {
    const shell = {
      id: 'TitleScene',
      entities: [],
      customModule: 'TitleScene',
    } as unknown as SceneSpec;
    expect(sceneSkippedByDslCompile(shell)).toBe(true);
  });
});

describe('sceneStartCandidates', () => {
  it('puts initialKey first then scene ids without duplicates', () => {
    const dsl = {
      dslVersion: DSL_VERSION,
      meta: { title: 'T' },
      scenes: [
        { id: 'A', entities: [] },
        { id: 'B', entities: [] },
      ],
    } as GameDsl;
    expect(sceneStartCandidates(dsl, 'B')).toEqual(['B', 'A']);
  });

  it('skips layoutOnly world regions from boot candidates', () => {
    const dsl = {
      dslVersion: DSL_VERSION,
      meta: { title: 'T' },
      scenes: [
        { id: 'TitleScene', entities: [], customModule: 'TitleScene' },
        {
          id: 'town_square',
          entities: [],
          layoutOnly: true,
        },
      ],
    } as unknown as GameDsl;
    expect(sceneStartCandidates(dsl, 'TitleScene')).toEqual(['TitleScene']);
  });
});
