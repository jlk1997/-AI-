/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { createEmptyTownWorld, parseWorldSpec } from '@opengame/world-spec';
import {
  detectWorldArchetype,
  extractPlacePromises,
  heuristicWorldFromPrompt,
  mergeHeuristicWithLlmHints,
  planWorldFromPrompt,
  planWorldOps,
  coversPromisedPlace,
  isClassicTownPrompt,
  parseIntentFromPrompt,
  stampMissingStanceCards,
  fulfillSocietyPromises,
  ensurePromisedRegions,
  placeLayoutFlavor,
} from './planner.js';
import { ensureWorldDepth } from './ensureDepth.js';
import { CLOISTER_GENRE_PROFILE, CREW_GENRE_PROFILE } from '@opengame/world-spec';

describe('world-planner', () => {
  it('honors an explicit population hint over prompt text', () => {
    const ir = parseIntentFromPrompt('至少 22 名渔民的可观察社会', {
      populationHint: 10,
    });
    expect(ir.populationHint).toBe(10);
    expect(ir.profile.population).toEqual({ min: 10, max: 10 });
  });

  it('does not let a town pack range override 至少 N 名', () => {
    const ir = parseIntentFromPrompt(
      '至少 10 名有名字、有职业的居民。本模板使用 society.town pack：居民有住处和职场，约 18–25 人。',
    );
    expect(ir.populationHint).toBe(10);
    expect(ir.profile.population.max).toBe(10);
  });

  it('does not clamp a crowded headcount to the town pack max of 25', () => {
    const ir = parseIntentFromPrompt('热闹镇约 36 人的可观察社会');
    expect(ir.populationHint).toBe(36);
    expect(ir.profile.population).toEqual({ min: 36, max: 36 });
  });

  it('keeps prompt-named residents instead of overwriting them with the pool', async () => {
    const planned = await planWorldFromPrompt(
      '运河船 10 人的可观察社会。船员「阿禾」是补网人，老陈是铁匠。不要塌回无名广场。',
      { forceHeuristic: true, worldPopulation: 10 },
    );
    const npcs = planned.world.entities.filter((e) => e.kind === 'npc');
    expect(npcs.map((n) => n.name)).toEqual(
      expect.arrayContaining(['阿禾', '老陈']),
    );
    const ahe = npcs.find((n) => n.name === '阿禾');
    expect(ahe?.identity?.occupation).toMatch(/补网/);
    expect(ahe?.tags ?? []).not.toContain('padded');
    expect(ahe?.tags ?? []).toContain('authored');
    expect(npcs.filter((n) => (n.tags ?? []).includes('padded')).length).toBeGreaterThan(
      0,
    );
    expect(
      planned.world.space.regions.every(
        (r) => r.id !== 'town_square' && r.id !== 'home_row',
      ),
    ).toBe(true);
  });

  it('extracts named residents from the prompt into IntentIR', () => {
    const ir = parseIntentFromPrompt(
      '点名：阿秀、林嫂。玛拉是面包师。居民必须包含「织娘」。',
    );
    const names = ir.residents.map((r) => r.name);
    expect(names).toEqual(expect.arrayContaining(['阿秀', '林嫂', '玛拉', '织娘']));
    expect(ir.residents.find((r) => r.name === '玛拉')?.occupation).toMatch(
      /面包/,
    );
  });

  it('stamps stance cards on LLM-like NPCs and depth pads', async () => {
    const planned = await planWorldFromPrompt(
      '运河船 10 人的可观察社会。船员「阿禾」是补网人。',
      { forceHeuristic: true, worldPopulation: 10 },
    );
    const npcs = planned.world.entities.filter((e) => e.kind === 'npc');
    expect(npcs.every((n) => n.identity?.secret && n.identity?.stance)).toBe(
      true,
    );
    const stripped = parseWorldSpec({
      ...planned.world,
      entities: planned.world.entities.map((e) =>
        e.kind === 'npc'
          ? {
              ...e,
              identity: {
                ...(e.identity ?? { displayName: e.name, traits: [] }),
                secret: undefined,
                stance: undefined,
              },
            }
          : e,
      ),
    });
    expect(
      stripped.entities.some(
        (e) => e.kind === 'npc' && !e.identity?.stance,
      ),
    ).toBe(true);
    const stamped = stampMissingStanceCards(stripped);
    expect(
      stamped.entities
        .filter((e) => e.kind === 'npc')
        .every((n) => n.identity?.secret && n.identity?.stance),
    ).toBe(true);
    const fulfilled = fulfillSocietyPromises(stripped, '补网人「阿禾」必须出现');
    const ahe = fulfilled.entities.find((e) => e.name === '阿禾');
    expect(ahe?.identity?.stance).toBeTruthy();
  });

  it('brief pack and places win over 小镇 in extra text', () => {
    const ir = parseIntentFromPrompt('一座小镇的可观察社会', {
      packId: 'society.crew',
      places: ['舰桥', '温室舱'],
    });
    expect(ir.packId).toBe('society.crew');
    expect(ir.places).toEqual(['舰桥', '温室舱']);
    expect(ir.classicTown).toBe(false);
  });

  it('pool pads inherit the occupation of the place they land on', async () => {
    const planned = await planWorldFromPrompt(
      '一座可观察的社会。不要塌回无名广场。',
      {
        forceHeuristic: true,
        worldPopulation: 2,
        packId: 'society.town',
        places: ['夜市'],
      },
    );
    const { world } = ensureWorldDepth(planned.world, {
      mode: 'society',
      populationHint: 4,
    });
    const pads = world.entities.filter(
      (e) => e.kind === 'npc' && (e.tags ?? []).includes('padded'),
    );
    expect(pads.length).toBeGreaterThan(0);
    expect(
      pads.some((n) => /夜摊/.test(n.identity?.occupation ?? '')),
    ).toBe(true);
  });

  it('stamps the create brief onto the Spec so seed copy can read it', async () => {
    const planned = await planWorldFromPrompt(
      '一座小镇的可观察社会。不要塌回无名广场。',
      {
        forceHeuristic: true,
        worldPopulation: 10,
        packId: 'society.town',
        places: ['夜市', '茶馆'],
        useCase: 'xiangyi',
        scale: 'standard',
        livedIn: 'full_day',
        note: '林嫂和阿禾要在夜市对质',
      },
    );
    expect(planned.world.presentation.worldBrief).toEqual({
      packId: 'society.town',
      useCase: 'xiangyi',
      venues: ['夜市', '茶馆'],
      scale: 'standard',
      livedIn: 'full_day',
      note: '林嫂和阿禾要在夜市对质',
    });
  });

  it('planWorldFromPrompt honors brief pack over 小镇 keywords', async () => {
    const planned = await planWorldFromPrompt(
      '一座小镇的可观察社会。不要塌回无名广场。',
      {
        forceHeuristic: true,
        worldPopulation: 10,
        packId: 'society.crew',
        places: ['舰桥', '温室舱'],
      },
    );
    expect(planned.world.presentation.genreProfile?.id).toBe('society.crew');
    expect(
      planned.world.space.regions.every(
        (r) => r.id !== 'town_square' && r.id !== 'home_row',
      ),
    ).toBe(true);
    const blob = planned.world.space.regions
      .map((r) => `${r.id} ${r.name}`)
      .join(' ');
    expect(/舰桥|bridge|温室/i.test(blob)).toBe(true);
  });

  it('heuristic planner uses worldPopulation for named residents', async () => {
    const compact = await planWorldFromPrompt('生成一座可观察的渔村社会', {
      forceHeuristic: true,
      worldPopulation: 10,
    });
    const npcs = compact.world.entities.filter((e) => e.kind === 'npc');
    expect(npcs.length).toBe(10);
  });

  it('falls back to heuristic without API key', async () => {
    const prev = process.env['OPENAI_API_KEY'];
    const prev2 = process.env['OPENGAME_REASONING_API_KEY'];
    const prev3 = process.env['MINIMAX_API_KEY'];
    delete process.env['OPENAI_API_KEY'];
    delete process.env['OPENGAME_REASONING_API_KEY'];
    delete process.env['MINIMAX_API_KEY'];
    process.env['WORLD_PLANNER_HEURISTIC'] = 'true';
    try {
      const result = await planWorldFromPrompt('生成一座带森林的叛徒铁匠小镇');
      expect(result.source).toBe('heuristic');
      expect(
        result.world.entities.some((e) => /叛徒/.test(e.name)),
      ).toBe(true);
      expect(
        result.world.space.regions.every(
          (r) => r.id !== 'town_square' && r.id !== 'home_row',
        ),
      ).toBe(true);
    } finally {
      if (prev) process.env['OPENAI_API_KEY'] = prev;
      if (prev2) process.env['OPENGAME_REASONING_API_KEY'] = prev2;
      if (prev3) process.env['MINIMAX_API_KEY'] = prev3;
      delete process.env['WORLD_PLANNER_HEURISTIC'];
    }
  });

  it('defaults town prompts to society (no ore/wolf quests)', () => {
    const world = heuristicWorldFromPrompt('生成一座可观察的小镇社会');
    expect(world.entities.filter((e) => e.kind === 'npc').length).toBeGreaterThanOrEqual(
      4,
    );
    expect(world.entities.some((e) => e.kind === 'enemy')).toBe(false);
    expect(world.narrative.quests.length).toBe(0);
    expect(world.presentation.narrativeSeed).toContain('society');
    expect(world.presentation.openingRumor).toMatch(/压低声音|脚印/);
  });

  it('temple-town prompts compile 庙宇/香案 instead of a nameless plaza', () => {
    const prompt =
      '生成一座可观察的香火庙镇社会，场所必须包含庙宇、香案。至少 22 名香火看守、司香';
    const world = heuristicWorldFromPrompt(prompt);
    expect(world.space.regions.some((r) => r.id === 'town_square')).toBe(false);
    expect(
      world.space.regions.some((r) => coversPromisedPlace(r.name, '庙宇')) ||
        (world.space.areas ?? []).some((a) =>
          coversPromisedPlace(a.name, '庙宇'),
        ),
    ).toBe(true);
    expect(
      world.entities.some(
        (e) =>
          e.kind === 'npc' &&
          /香火看守|司香|庙祝/.test(
            `${e.identity?.occupation ?? ''} ${e.name}`,
          ),
      ),
    ).toBe(true);
  });

  it('society padding uses unique Chinese identities, not filler residents', () => {
    const base = heuristicWorldFromPrompt('生成一座可观察的小镇社会');
    const keepNpcs = base.entities.filter((e) => e.kind === 'npc').slice(0, 2);
    const thin = parseWorldSpec({
      ...base,
      entities: [
        ...base.entities.filter((e) => e.kind !== 'npc'),
        ...keepNpcs,
      ],
      relations: [],
    });
    const { world } = ensureWorldDepth(thin, { mode: 'society' });
    const npcs = world.entities.filter((e) => e.kind === 'npc');
    expect(npcs.length).toBeGreaterThanOrEqual(25);
    for (const n of npcs) {
      expect(n.identity?.backstory ?? '').not.toMatch(/Padded resident/i);
      expect(n.name).toMatch(/[\u4e00-\u9fff]/);
    }
    const pads = npcs.filter((n) => n.tags.includes('padded'));
    expect(pads.length).toBeGreaterThan(0);
    const traitKeys = pads.map((n) => (n.identity?.traits ?? []).join('|'));
    expect(new Set(traitKeys).size).toBe(traitKeys.length);
    expect(
      pads.every((n) => (n.identity?.traits ?? []).length >= 2),
    ).toBe(true);
    expect(world.relations.length).toBeGreaterThan(0);
    const covered = new Set((world.space.areas ?? []).map((a) => a.regionId));
    for (const r of world.space.regions) {
      expect(covered.has(r.id)).toBe(true);
    }
    expect(
      (world.space.areas ?? []).every((a) => (a.objects ?? []).length > 0),
    ).toBe(true);
  });

  it('society padding fills a missing area+object on every region', () => {
    const base = heuristicWorldFromPrompt('生成一座可观察的小镇社会');
    const hollow = parseWorldSpec({
      ...base,
      space: { ...base.space, areas: [] },
      relations: base.relations.filter((r) => r.type !== 'located_in'),
    });
    const { world } = ensureWorldDepth(hollow, { mode: 'society' });
    const covered = new Set((world.space.areas ?? []).map((a) => a.regionId));
    expect(world.space.regions.every((r) => covered.has(r.id))).toBe(true);
    expect(
      (world.space.areas ?? []).every((a) => (a.objects ?? []).length > 0),
    ).toBe(true);
  });

  it('uses dungeon archetype with dungeon start (not town ore quest)', () => {
    expect(detectWorldArchetype('一座黑暗地牢')).toBe('dungeon');
    const world = heuristicWorldFromPrompt('探索黑暗地牢与宝藏');
    expect(world.space.startRegionId).toBe('dungeon_hall');
    expect(world.narrative.quests.some((q) => q.id === 'q_claim_key')).toBe(
      true,
    );
    expect(world.narrative.quests.some((q) => q.id === 'q_fetch_ore')).toBe(
      false,
    );
    expect(world.entities.find((e) => e.kind === 'player')?.name).toBe('Delver');
  });

  it('planWorldOps expands forest without weak set_flag', async () => {
    process.env['WORLD_PLANNER_HEURISTIC'] = 'true';
    try {
      const planned = await planWorldOps('扩一片森林', 'town with plaza');
      expect(planned.understood).toBe(true);
      expect(planned.ops.some((o) => o.op === 'expand_region')).toBe(true);
      expect(planned.ops.every((o) => o.op !== 'set_flag')).toBe(true);
    } finally {
      delete process.env['WORLD_PLANNER_HEURISTIC'];
    }
  });

  it('planWorldOps refuses ununderstood substantial edits', async () => {
    process.env['WORLD_PLANNER_HEURISTIC'] = 'true';
    try {
      const planned = await planWorldOps(
        '把布局改成完全不同的魔法学院地图并重做任务线',
        'tiny town',
      );
      if (!planned.understood) {
        expect(planned.ops.length).toBe(0);
        expect(planned.issues.some((i) => i.includes('ununderstood'))).toBe(
          true,
        );
      }
    } finally {
      delete process.env['WORLD_PLANNER_HEURISTIC'];
    }
  });

  it('society system prompt follows the user language instead of locking Chinese', async () => {
    const { SOCIETY_SYSTEM } = await import('./chat.js');
    expect(SOCIETY_SYSTEM).not.toMatch(/只用中文/);
    expect(SOCIETY_SYSTEM).toMatch(/language the user message/i);
  });

  it('createSocietyLlmFn is undefined without API keys', async () => {
    const names = [
      'OPENAI_API_KEY',
      'OPENGAME_REASONING_API_KEY',
      'MINIMAX_API_KEY',
      'OPENGAME_REASONING_API_KEYS',
      'OPENGAME_FALLBACK_API_KEY',
      'OPENAI_FALLBACK_API_KEY',
    ] as const;
    const prev: Record<string, string | undefined> = {};
    for (const name of names) {
      prev[name] = process.env[name];
      delete process.env[name];
    }
    try {
      const { createSocietyLlmFn } = await import('./chat.js');
      expect(createSocietyLlmFn()).toBeUndefined();
    } finally {
      for (const name of names) {
        if (prev[name]) process.env[name] = prev[name];
        else delete process.env[name];
      }
    }
  });

  it('chatCompletion rotates to the next key after 401/2049', async () => {
    const { chatCompletion, resetSocietyKeyPoolState } = await import('./chat.js');
    resetSocietyKeyPoolState();
    const seen: string[] = [];
    const fetchMock = async (
      _url: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      const auth = String(
        (init?.headers as Record<string, string> | undefined)?.Authorization ??
          '',
      );
      seen.push(auth);
      if (auth.includes('sk-bad')) {
        return new Response(
          JSON.stringify({
            type: 'error',
            error: {
              type: 'authorized_error',
              message: 'invalid api key (2049)',
              http_code: '401',
            },
          }),
          { status: 401 },
        );
      }
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'ok-from-good-key' } }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };
    const prev = globalThis.fetch;
    globalThis.fetch = fetchMock as typeof fetch;
    try {
      const text = await chatCompletion({
        baseUrl: 'https://api.minimaxi.com/v1',
        apiKey: 'sk-bad',
        apiKeys: ['sk-bad', 'sk-good'],
        model: 'MiniMax-M3',
        provider: 'minimax',
        messages: [{ role: 'user', content: 'hi' }],
      });
      expect(text).toBe('ok-from-good-key');
      expect(seen.length).toBe(2);
      seen.length = 0;
      const again = await chatCompletion({
        baseUrl: 'https://api.minimaxi.com/v1',
        apiKey: 'sk-bad',
        apiKeys: ['sk-bad', 'sk-good'],
        model: 'MiniMax-M3',
        provider: 'minimax',
        messages: [{ role: 'user', content: 'hi' }],
      });
      expect(again).toBe('ok-from-good-key');
      expect(seen.some((a) => a.includes('sk-bad'))).toBe(false);
      expect(seen.some((a) => a.includes('sk-good'))).toBe(true);
    } finally {
      globalThis.fetch = prev;
      resetSocietyKeyPoolState();
    }
  });

  it('chatCompletion rotates to the next key after 429/额度', async () => {
    const { chatCompletion, resetSocietyKeyPoolState } = await import('./chat.js');
    resetSocietyKeyPoolState();
    const seen: string[] = [];
    const fetchMock = async (
      _url: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      const auth = String(
        (init?.headers as Record<string, string> | undefined)?.Authorization ??
          '',
      );
      seen.push(auth);
      if (auth.includes('sk-quota')) {
        return new Response(
          JSON.stringify({
            type: 'error',
            error: { message: 'Token Plan quota exceeded', http_code: '429' },
          }),
          { status: 429 },
        );
      }
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'ok-from-healthy-key' } }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };
    const prev = globalThis.fetch;
    globalThis.fetch = fetchMock as typeof fetch;
    try {
      const text = await chatCompletion({
        baseUrl: 'https://api.minimaxi.com/v1',
        apiKey: 'sk-quota',
        apiKeys: ['sk-quota', 'sk-healthy'],
        model: 'MiniMax-M3',
        provider: 'minimax',
        messages: [{ role: 'user', content: 'hi' }],
      });
      expect(text).toBe('ok-from-healthy-key');
      expect(seen.length).toBe(2);
      seen.length = 0;
      const again = await chatCompletion({
        baseUrl: 'https://api.minimaxi.com/v1',
        apiKey: 'sk-quota',
        apiKeys: ['sk-quota', 'sk-healthy'],
        model: 'MiniMax-M3',
        provider: 'minimax',
        messages: [{ role: 'user', content: 'hi' }],
      });
      expect(again).toBe('ok-from-healthy-key');
      expect(seen.some((a) => a.includes('sk-quota'))).toBe(false);
      expect(seen.some((a) => a.includes('sk-healthy'))).toBe(true);
    } finally {
      globalThis.fetch = prev;
      resetSocietyKeyPoolState();
    }
  });

  it('lit key pool lists paid keys first and falls back to the floor pool', async () => {
    const prev = {
      lit: process.env['OPENGAME_SOCIETY_LIT_API_KEYS'],
      floor: process.env['OPENGAME_REASONING_API_KEY'],
      floors: process.env['OPENGAME_REASONING_API_KEYS'],
    };
    process.env['OPENGAME_SOCIETY_LIT_API_KEYS'] = 'sk-lit-a,sk-lit-b';
    process.env['OPENGAME_REASONING_API_KEY'] = 'sk-floor';
    delete process.env['OPENGAME_REASONING_API_KEYS'];
    try {
      const { collectSocietyLitApiKeys, collectSocietyApiKeys, resolveChatEnv } =
        await import('./chat.js');
      expect(collectSocietyApiKeys()).toContain('sk-floor');
      expect(collectSocietyLitApiKeys()[0]).toBe('sk-lit-a');
      expect(collectSocietyLitApiKeys()).toContain('sk-floor');
      expect(resolveChatEnv('lit')?.apiKeys[0]).toBe('sk-lit-a');
      expect(resolveChatEnv('floor')?.apiKeys[0]).toBe('sk-floor');
    } finally {
      if (prev.lit) process.env['OPENGAME_SOCIETY_LIT_API_KEYS'] = prev.lit;
      else delete process.env['OPENGAME_SOCIETY_LIT_API_KEYS'];
      if (prev.floor) process.env['OPENGAME_REASONING_API_KEY'] = prev.floor;
      else delete process.env['OPENGAME_REASONING_API_KEY'];
      if (prev.floors) process.env['OPENGAME_REASONING_API_KEYS'] = prev.floors;
    }
  });

  it('floor pool excludes FALLBACK keys; emergency env uses its own URL', async () => {
    const names = [
      'OPENGAME_REASONING_API_KEY',
      'OPENGAME_REASONING_API_KEYS',
      'OPENGAME_SOCIETY_LIT_API_KEYS',
      'OPENGAME_FALLBACK_API_KEY',
      'OPENGAME_FALLBACK_API_KEYS',
      'OPENAI_FALLBACK_API_KEY',
      'OPENGAME_FALLBACK_BASE_URL',
      'OPENGAME_REASONING_FALLBACK_MODEL',
      'OPENGAME_FALLBACK_PROVIDER',
    ] as const;
    const prev: Record<string, string | undefined> = {};
    for (const name of names) {
      prev[name] = process.env[name];
      delete process.env[name];
    }
    process.env['OPENGAME_REASONING_API_KEY'] = 'sk-floor';
    process.env['OPENGAME_FALLBACK_API_KEY'] = 'ark-emergency';
    process.env['OPENGAME_FALLBACK_BASE_URL'] =
      'https://ark.cn-beijing.volces.com/api/v3';
    process.env['OPENGAME_REASONING_FALLBACK_MODEL'] = 'doubao-seed-test';
    process.env['OPENGAME_FALLBACK_PROVIDER'] = 'doubao';
    try {
      const {
        collectSocietyApiKeys,
        collectSocietyEmergencyApiKeys,
        collectSocietyLitApiKeys,
        resolveChatEnv,
        resolveSocietyEmergencyEnv,
      } = await import('./chat.js');
      expect(collectSocietyApiKeys()).toEqual(['sk-floor']);
      expect(collectSocietyLitApiKeys()).toEqual(['sk-floor']);
      expect(collectSocietyEmergencyApiKeys()).toEqual(['ark-emergency']);
      expect(resolveChatEnv('floor')?.apiKeys).not.toContain('ark-emergency');
      const emergency = resolveSocietyEmergencyEnv();
      expect(emergency?.apiKeys[0]).toBe('ark-emergency');
      expect(emergency?.baseUrl).toContain('volces.com');
      expect(emergency?.model).toBe('doubao-seed-test');
      expect(emergency?.provider).toBe('doubao');
    } finally {
      for (const name of names) {
        if (prev[name]) process.env[name] = prev[name];
        else delete process.env[name];
      }
    }
  });

  it('floor lane never spends the emergency model after the cheap pool dies', async () => {
    const names = [
      'OPENGAME_REASONING_API_KEY',
      'OPENGAME_REASONING_API_KEYS',
      'MINIMAX_API_KEY',
      'OPENAI_API_KEY',
      'OPENGAME_FALLBACK_API_KEY',
      'OPENGAME_FALLBACK_BASE_URL',
      'OPENGAME_REASONING_FALLBACK_MODEL',
    ] as const;
    const prev: Record<string, string | undefined> = {};
    for (const name of names) {
      prev[name] = process.env[name];
      delete process.env[name];
    }
    process.env['OPENGAME_REASONING_API_KEY'] = 'sk-floor-dead';
    process.env['OPENGAME_FALLBACK_API_KEY'] = 'ark-emergency';
    process.env['OPENGAME_FALLBACK_BASE_URL'] =
      'https://ark.cn-beijing.volces.com/api/v3';
    process.env['OPENGAME_REASONING_FALLBACK_MODEL'] = 'doubao-seed-test';
    const {
      createSocietyLlmFn,
      resetSocietyKeyPoolState,
      SocietyLlmKeysExhaustedError,
    } = await import('./chat.js');
    resetSocietyKeyPoolState();
    const urls: string[] = [];
    const prevFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request) => {
      urls.push(String(url));
      return new Response('rate limit 429 quota', { status: 429 });
    }) as typeof fetch;
    try {
      const llm = createSocietyLlmFn({ lane: 'floor', timeoutMs: 20_000 });
      expect(llm).toBeTypeOf('function');
      await expect(llm!('hi')).rejects.toBeInstanceOf(
        SocietyLlmKeysExhaustedError,
      );
      expect(urls.some((u) => u.includes('volces'))).toBe(false);
    } finally {
      globalThis.fetch = prevFetch;
      resetSocietyKeyPoolState();
      for (const name of names) {
        if (prev[name]) process.env[name] = prev[name];
        else delete process.env[name];
      }
    }
  });

  it('lit lane uses the emergency URL after the cheap pool dies, and honours the cap', async () => {
    const names = [
      'OPENGAME_REASONING_API_KEY',
      'OPENGAME_REASONING_API_KEYS',
      'MINIMAX_API_KEY',
      'OPENAI_API_KEY',
      'OPENGAME_FALLBACK_API_KEY',
      'OPENGAME_FALLBACK_BASE_URL',
      'OPENGAME_REASONING_FALLBACK_MODEL',
      'OPENGAME_FALLBACK_PROVIDER',
    ] as const;
    const prev: Record<string, string | undefined> = {};
    for (const name of names) {
      prev[name] = process.env[name];
      delete process.env[name];
    }
    process.env['OPENGAME_REASONING_API_KEY'] = 'sk-floor-dead';
    process.env['OPENGAME_FALLBACK_API_KEY'] = 'ark-emergency';
    process.env['OPENGAME_FALLBACK_BASE_URL'] =
      'https://ark.cn-beijing.volces.com/api/v3';
    process.env['OPENGAME_REASONING_FALLBACK_MODEL'] = 'doubao-seed-test';
    process.env['OPENGAME_FALLBACK_PROVIDER'] = 'doubao';
    const {
      createSocietyLlmFn,
      resetSocietyKeyPoolState,
      SocietyLlmKeysExhaustedError,
    } = await import('./chat.js');
    resetSocietyKeyPoolState();
    const urls: string[] = [];
    let consume = 0;
    const prevFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request) => {
      urls.push(String(url));
      if (String(url).includes('volces')) {
        return new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: 'stop',
                message: { content: '{"speaker":"A","text":"ok"}' },
              },
            ],
            usage: { completion_tokens: 8 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('429 token plan quota', { status: 429 });
    }) as typeof fetch;
    try {
      const llm = createSocietyLlmFn({
        lane: 'lit',
        timeoutMs: 20_000,
        consumeEmergency: async () => {
          consume += 1;
          return consume === 1;
        },
      });
      expect(await llm!('hi')).toContain('ok');
      expect(consume).toBe(1);
      expect(urls.some((u) => u.includes('volces'))).toBe(true);
      await expect(llm!('again')).rejects.toBeInstanceOf(
        SocietyLlmKeysExhaustedError,
      );
      expect(consume).toBe(2);
      expect(urls.filter((u) => u.includes('volces'))).toHaveLength(1);
    } finally {
      globalThis.fetch = prevFetch;
      resetSocietyKeyPoolState();
      for (const name of names) {
        if (prev[name]) process.env[name] = prev[name];
        else delete process.env[name];
      }
    }
  });

  it('chatCompletion throws when every pool key is rejected', async () => {
    const { chatCompletion, resetSocietyKeyPoolState, SocietyLlmKeysExhaustedError } =
      await import('./chat.js');
    resetSocietyKeyPoolState();
    const prev = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response('{"type":"error","error":{"type":"authorized_error"}}', {
        status: 401,
      })) as typeof fetch;
    try {
      await expect(
        chatCompletion({
          baseUrl: 'https://api.minimaxi.com/v1',
          apiKey: 'sk-dead',
          apiKeys: ['sk-dead', 'sk-also-dead'],
          model: 'MiniMax-M3',
          provider: 'minimax',
          messages: [{ role: 'user', content: 'hi' }],
        }),
      ).rejects.toBeInstanceOf(SocietyLlmKeysExhaustedError);
    } finally {
      globalThis.fetch = prev;
      resetSocietyKeyPoolState();
    }
  });

  it('collectSocietyApiKeys dedupes and keeps MINIMAX after REASONING', async () => {
    const names = [
      'OPENGAME_REASONING_API_KEY',
      'MINIMAX_API_KEY',
      'OPENAI_API_KEY',
      'OPENGAME_REASONING_API_KEYS',
      'OPENGAME_REASONING_FALLBACK_API_KEY',
      'OPENGAME_FALLBACK_API_KEY',
      'OPENGAME_FALLBACK_API_KEYS',
      'OPENAI_API_KEYS',
      'OPENAI_FALLBACK_API_KEY',
      'OPENAI_FALLBACK_API_KEYS',
    ] as const;
    const prev: Record<string, string | undefined> = {};
    for (const name of names) {
      prev[name] = process.env[name];
      delete process.env[name];
    }
    process.env['OPENGAME_REASONING_API_KEY'] = 'sk-bad';
    process.env['MINIMAX_API_KEY'] = 'sk-good';
    process.env['OPENAI_API_KEY'] = 'sk-bad';
    process.env['OPENGAME_FALLBACK_API_KEY'] = 'ark-do-not-use';
    try {
      const { collectSocietyApiKeys, collectSocietyEmergencyApiKeys } =
        await import('./chat.js');
      expect(collectSocietyApiKeys()).toEqual(['sk-bad', 'sk-good']);
      expect(collectSocietyEmergencyApiKeys()).toEqual(['ark-do-not-use']);
    } finally {
      for (const name of names) {
        if (prev[name]) process.env[name] = prev[name];
        else delete process.env[name];
      }
    }
  });

  it('chatCompletion gives up when every continuation stays think-only', async () => {
    const { chatCompletion, resetSocietyKeyPoolState, stripThinking } =
      await import('./chat.js');
    expect(stripThinking('<think>planning forever</think>')).toBe('');
    expect(stripThinking('<think>still going')).toBe('');
    resetSocietyKeyPoolState();
    const prev = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'length',
              message: { content: '<think>planning forever</think>' },
            },
          ],
          usage: { completion_tokens: 512, total_tokens: 800 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )) as typeof fetch;
    try {
      await expect(
        chatCompletion({
          baseUrl: 'https://api.minimaxi.com/v1',
          apiKey: 'sk-test',
          model: 'MiniMax-M2.7-highspeed',
          provider: 'minimax',
          messages: [{ role: 'user', content: 'hi' }],
        }),
      ).rejects.toThrow(/Empty chat completion after strip/);
    } finally {
      globalThis.fetch = prev;
      resetSocietyKeyPoolState();
    }
  });

  it('chatCompletion resumes the same thread when MiniMax spends the budget on think', async () => {
    const { chatCompletion, resetSocietyKeyPoolState } = await import('./chat.js');
    resetSocietyKeyPoolState();
    const bodies: unknown[] = [];
    let n = 0;
    const prev = globalThis.fetch;
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      n += 1;
      bodies.push(JSON.parse(String(init?.body ?? '{}')));
      if (n === 1) {
        return new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: 'length',
                message: {
                  content: '<think>planning forever</think>',
                  reasoning_content: 'planning forever',
                },
              },
            ],
            usage: { completion_tokens: 2048 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'stop',
              message: {
                content: '{"turns":[{"speaker":"A","text":"铁砧今晚别只顾打铁"}]}',
              },
            },
          ],
          usage: { completion_tokens: 80 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;
    try {
      const text = await chatCompletion({
        baseUrl: 'https://api.minimaxi.com/v1',
        apiKey: 'sk-test',
        model: 'MiniMax-M2.7-highspeed',
        provider: 'minimax',
        messages: [{ role: 'user', content: 'hi' }],
        maxTokens: 2048,
      });
      expect(text).toMatch(/铁砧/);
      expect(n).toBe(2);
      const first = bodies[0] as Record<string, unknown>;
      const second = bodies[1] as Record<string, unknown>;
      expect(first['reasoning_split']).toBe(true);
      expect(second['max_completion_tokens']).toBe(first['max_completion_tokens']);
      const msgs = second['messages'] as Array<{ role: string; content?: string }>;
      expect(msgs.some((m) => m.role === 'assistant')).toBe(true);
      expect(msgs.at(-1)?.content).toMatch(/Stop thinking/i);
    } finally {
      globalThis.fetch = prev;
      resetSocietyKeyPoolState();
    }
  });

  it('chatCompletion treats a 3-char stop remnant as think-only and flushes the same thread', async () => {
    const { chatCompletion, resetSocietyKeyPoolState, isThinkOnlyRemainder, classifySocietyReply } =
      await import('./chat.js');
    expect(isThinkOnlyRemainder('}')).toBe(true);
    expect(isThinkOnlyRemainder('```')).toBe(true);
    expect(isThinkOnlyRemainder('ok')).toBe(true);
    expect(isThinkOnlyRemainder('not json at all really')).toBe(false);
    expect(
      isThinkOnlyRemainder('{"turns":[{"speaker":"A","text":"ok"}]}'),
    ).toBe(false);

    expect(
      classifySocietyReply({
        text: '}',
        rawContent: '<think>planning</think>}',
        tokens: 130,
        finish: 'stop',
      }),
    ).toBe('think_only');
    expect(
      classifySocietyReply({
        text: '}',
        tokens: 4,
        finish: 'stop',
      }),
    ).toBe('empty_stub');
    expect(
      classifySocietyReply({
        text: '{"turns":[{"speaker":"A","text":"码头风大"}]}',
        tokens: 40,
        finish: 'stop',
      }),
    ).toBe('ok');
    expect(
      classifySocietyReply({
        text: '{"turns":[',
        tokens: 80,
        finish: 'length',
      }),
    ).toBe('truncated');
    resetSocietyKeyPoolState();
    const bodies: unknown[] = [];
    let n = 0;
    const prev = globalThis.fetch;
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      n += 1;
      bodies.push(JSON.parse(String(init?.body ?? '{}')));
      if (n === 1) {
        return new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: 'stop',
                message: { content: '<think>planning</think>}' },
              },
            ],
            usage: { completion_tokens: 130 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'stop',
              message: {
                content: '{"turns":[{"speaker":"A","text":"网还没干"}]}',
              },
            },
          ],
          usage: { completion_tokens: 80 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;
    try {
      const text = await chatCompletion({
        baseUrl: 'https://api.minimaxi.com/v1',
        apiKey: 'sk-test',
        model: 'MiniMax-M2.7-highspeed',
        provider: 'minimax',
        messages: [{ role: 'user', content: 'hi' }],
        maxTokens: 2048,
      });
      expect(text).toMatch(/网还没干/);
      expect(text).not.toMatch(/^}/);
      expect(n).toBe(2);
      const msgs = (bodies[1] as { messages: Array<{ content?: string }> })
        .messages;
      expect(msgs.at(-1)?.content).toMatch(/Stop thinking/i);
    } finally {
      globalThis.fetch = prev;
      resetSocietyKeyPoolState();
    }
  });

  it('chatCompletion does not treat an M3 4-token stub as think-eating', async () => {
    const { chatCompletion, resetSocietyKeyPoolState } = await import('./chat.js');
    resetSocietyKeyPoolState();
    const bodies: unknown[] = [];
    let n = 0;
    const prev = globalThis.fetch;
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      n += 1;
      bodies.push(JSON.parse(String(init?.body ?? '{}')));
      if (n === 1) {
        return new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: 'stop',
                message: { content: '好。' },
              },
            ],
            usage: { completion_tokens: 4 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'stop',
              message: {
                content: '{"turns":[{"speaker":"A","text":"炭火我盯着"}]}',
              },
            },
          ],
          usage: { completion_tokens: 48 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;
    try {
      const text = await chatCompletion({
        baseUrl: 'https://api.minimaxi.com/v1',
        apiKey: 'sk-test',
        model: 'MiniMax-M3',
        provider: 'minimax',
        messages: [{ role: 'user', content: '写两句对白' }],
        maxTokens: 2048,
      });
      expect(text).toMatch(/炭火/);
      expect(n).toBe(2);
      const second = bodies[1] as {
        messages: Array<{ role: string; content?: string }>;
      };
      expect(second.messages.some((m) => m.role === 'assistant')).toBe(false);
      expect(second.messages.at(-1)?.content).not.toMatch(/Stop thinking/i);
      expect(second.messages.at(-1)?.content).toMatch(/empty|没有正文/i);
    } finally {
      globalThis.fetch = prev;
      resetSocietyKeyPoolState();
    }
  });

  it('createSocietyLlmFn continues think-only replies without doubling the token budget', async () => {
    const prevKey = process.env['OPENGAME_REASONING_API_KEY'];
    const prevKeys = process.env['OPENGAME_REASONING_API_KEYS'];
    const prevMinimax = process.env['MINIMAX_API_KEY'];
    const prevOpenai = process.env['OPENAI_API_KEY'];
    process.env['OPENGAME_REASONING_API_KEY'] = 'sk-test';
    delete process.env['OPENGAME_REASONING_API_KEYS'];
    delete process.env['MINIMAX_API_KEY'];
    delete process.env['OPENAI_API_KEY'];
    const { createSocietyLlmFn, resetSocietyKeyPoolState } = await import(
      './chat.js'
    );
    resetSocietyKeyPoolState();
    const bodies: unknown[] = [];
    let n = 0;
    const prev = globalThis.fetch;
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      n += 1;
      bodies.push(JSON.parse(String(init?.body ?? '{}')));
      if (n === 1) {
        return new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: 'length',
                message: { content: '<think>still thinking</think>' },
              },
            ],
            usage: { completion_tokens: 2048 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'stop',
              message: {
                content:
                  '{"turns":[{"speaker":"A","text":"铁砧，今晚别只顾打铁"}]}',
              },
            },
          ],
          usage: { completion_tokens: 180 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;
    try {
      const llm = createSocietyLlmFn({ thinking: 'enabled' });
      expect(llm).toBeDefined();
      const text = await llm!('写两句对白');
      expect(text).toMatch(/铁砧/);
      expect(n).toBe(2);
      const budgets = bodies.map(
        (body) => Number((body as Record<string, unknown>)['max_completion_tokens']),
      );
      expect(budgets[0]).toBeGreaterThanOrEqual(2048);
      expect(budgets[1]).toBe(budgets[0]);
      for (const body of bodies) {
        const rec = body as Record<string, unknown>;
        expect(rec['response_format']).toBeUndefined();
        expect(rec['thinking']).toEqual({ type: 'adaptive' });
        expect(rec['reasoning_split']).toBe(true);
      }
      const follow = bodies[1] as Record<string, unknown>;
      const msgs = follow['messages'] as Array<{ role: string }>;
      expect(msgs.filter((m) => m.role === 'assistant').length).toBeGreaterThan(0);
    } finally {
      globalThis.fetch = prev;
      resetSocietyKeyPoolState();
      if (prevKey) process.env['OPENGAME_REASONING_API_KEY'] = prevKey;
      else delete process.env['OPENGAME_REASONING_API_KEY'];
      if (prevKeys) process.env['OPENGAME_REASONING_API_KEYS'] = prevKeys;
      if (prevMinimax) process.env['MINIMAX_API_KEY'] = prevMinimax;
      if (prevOpenai) process.env['OPENAI_API_KEY'] = prevOpenai;
    }
  });

  it('createSocietyLlmFn defaults to MiniMax-M3 with thinking enabled', async () => {
    const prev = {
      key: process.env['OPENGAME_REASONING_API_KEY'],
      society: process.env['OPENGAME_SOCIETY_MODEL'],
      reasoning: process.env['OPENGAME_REASONING_MODEL'],
      openai: process.env['OPENAI_MODEL'],
      minimax: process.env['MINIMAX_API_KEY'],
      openaiKey: process.env['OPENAI_API_KEY'],
    };
    process.env['OPENGAME_REASONING_API_KEY'] = 'sk-test';
    delete process.env['OPENGAME_SOCIETY_MODEL'];
    delete process.env['OPENGAME_REASONING_MODEL'];
    delete process.env['OPENAI_MODEL'];
    delete process.env['MINIMAX_API_KEY'];
    delete process.env['OPENAI_API_KEY'];
    const { createSocietyLlmFn, resetSocietyKeyPoolState } = await import(
      './chat.js'
    );
    resetSocietyKeyPoolState();
    const bodies: unknown[] = [];
    const prevFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body ?? '{}')));
      return new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'stop',
              message: {
                content: '{"turns":[{"speaker":"A","text":"码头风大"}]}',
              },
            },
          ],
          usage: { completion_tokens: 40 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;
    try {
      const llm = createSocietyLlmFn();
      expect(llm).toBeDefined();
      await llm!('写一句对白');
      expect(bodies[0]).toEqual(
        expect.objectContaining({
          model: 'MiniMax-M3',
          thinking: { type: 'disabled' },
        }),
      );
    } finally {
      globalThis.fetch = prevFetch;
      resetSocietyKeyPoolState();
      if (prev.key) process.env['OPENGAME_REASONING_API_KEY'] = prev.key;
      else delete process.env['OPENGAME_REASONING_API_KEY'];
      if (prev.society) process.env['OPENGAME_SOCIETY_MODEL'] = prev.society;
      else delete process.env['OPENGAME_SOCIETY_MODEL'];
      if (prev.reasoning) process.env['OPENGAME_REASONING_MODEL'] = prev.reasoning;
      else delete process.env['OPENGAME_REASONING_MODEL'];
      if (prev.openai) process.env['OPENAI_MODEL'] = prev.openai;
      else delete process.env['OPENAI_MODEL'];
      if (prev.minimax) process.env['MINIMAX_API_KEY'] = prev.minimax;
      if (prev.openaiKey) process.env['OPENAI_API_KEY'] = prev.openaiKey;
    }
  });

  it('prompt typology writes distinctive places onto the scaffold', () => {
    const dock = heuristicWorldFromPrompt('一座靠海的渔村，码头和晒网场');
    const kiln = heuristicWorldFromPrompt('一座矿镇，窑火通明，还有灯房');
    const dockNames = (dock.space.areas ?? []).map((a) => a.name).join(' ');
    const kilnNames = (kiln.space.areas ?? []).map((a) => a.name).join(' ');
    expect(/码头|晒网|船坞/.test(dockNames)).toBe(true);
    expect(/矿窑|灯房|选矿/.test(kilnNames)).toBe(true);
    const setOf = (xs: readonly string[]) => new Set(xs.filter(Boolean));
    const jaccard = (a: Set<string>, b: Set<string>): number => {
      const inter = [...a].filter((x) => b.has(x)).length;
      const union = new Set([...a, ...b]).size;
      return union === 0 ? 1 : inter / union;
    };
    const publicAreas = (w: typeof dock) =>
      setOf(
        (w.space.areas ?? [])
          .filter((a) => !/的家$/.test(a.name))
          .map((a) => a.name),
      );
    expect(jaccard(publicAreas(dock), publicAreas(kiln))).toBeLessThan(0.9);
    const jobsOf = (w: typeof dock) =>
      setOf(
        w.entities
          .filter((e) => e.kind === 'npc')
          .map((e) => e.identity?.occupation ?? ''),
      );
    expect(jaccard(jobsOf(dock), jobsOf(kiln))).toBeLessThan(0.85);
    expect(jobsOf(dock).has('渔民') || jobsOf(dock).has('船匠')).toBe(true);
    expect(jobsOf(kiln).has('窑工') || jobsOf(kiln).has('矿灯看守')).toBe(true);
    const regionNames = (w: typeof dock) =>
      setOf(w.space.regions.map((r) => r.name));
    expect(jaccard(regionNames(dock), regionNames(kiln))).toBeLessThan(0.75);
    expect(
      dock.space.regions.some((r) => /码头|船坞|晒网/.test(r.name)),
    ).toBe(true);
    expect(
      kiln.space.regions.some((r) => /矿窑|选矿|灯房/.test(r.name)),
    ).toBe(true);
  });

  it('keeps observatory prompts in the society pack with place topology, not the town scaffold', () => {
    expect(
      detectWorldArchetype('地牢外围营地的小型社会（观察向，不是打 Boss）'),
    ).toBe('town');
    expect(detectWorldArchetype('迷雾森林旁的聚落社会，药庐与祭坛')).toBe(
      'town',
    );
    expect(detectWorldArchetype('探索黑暗地牢与宝藏')).toBe('dungeon');
    const camp = heuristicWorldFromPrompt(
      '生成一座可观察的营地社会，补给帐、情报棚、营火圈',
    );
    expect(camp.entities.some((e) => e.kind === 'enemy')).toBe(false);
    expect(camp.narrative.quests.length).toBe(0);
    expect(camp.space.regions.every((r) => r.id !== 'town_square')).toBe(true);
    expect(camp.space.regions.every((r) => r.id !== 'home_row')).toBe(true);
    const campNames = [
      ...camp.space.regions.map((r) => r.name),
      ...(camp.space.areas ?? []).map((a) => a.name),
    ].join(' ');
    expect(/补给帐|情报棚|营火/.test(campNames)).toBe(true);
    const mist = heuristicWorldFromPrompt(
      '生成一座可观察的迷雾林边聚落社会，药庐、猎场、祭坛',
    );
    const mistNames = [
      ...mist.space.regions.map((r) => r.name),
      ...(mist.space.areas ?? []).map((a) => a.name),
    ].join(' ');
    expect(/药庐|猎场|祭坛/.test(mistNames)).toBe(true);
  });

  it('synthesizes a fishing village without town_square or 码头一带 labels', () => {
    const world = heuristicWorldFromPrompt(
      '一座靠海的渔村，码头、船坞、晒网场',
    );
    const ids = world.space.regions.map((r) => r.id);
    expect(ids).not.toContain('town_square');
    expect(ids).not.toContain('home_row');
    expect(ids).not.toContain('market_row');
    expect(world.space.regions.some((r) => r.name === '码头')).toBe(true);
    expect(world.space.regions.every((r) => !r.name.includes('一带'))).toBe(
      true,
    );
    expect(world.presentation.genreProfile?.id).toBe('society.town');
  });

  it('invalid LLM overlay still synthesizes without scaffold ids', () => {
    const merged = mergeHeuristicWithLlmHints(
      '一座靠海的渔村，码头、船坞、晒网场',
      { meta: { title: '坏掉的 JSON 渔港' } },
      ['entities.0: invalid'],
    );
    expect(merged.source).toBe('heuristic_merged');
    const ids = merged.world.space.regions.map((r) => r.id);
    expect(ids).not.toContain('town_square');
    expect(ids).not.toContain('home_row');
    expect(merged.world.meta.title).toContain('渔港');
  });

  it('classic town prompts keep the Stanford scaffold', () => {
    const world = heuristicWorldFromPrompt(
      '生成一座带城镇广场、住宅巷、学堂院的可观察社会',
    );
    expect(world.space.regions.some((r) => r.id === 'town_square')).toBe(true);
    expect(world.space.regions.some((r) => r.id === 'home_row')).toBe(true);
  });

  it('「不要塌回无名广场」 is not a classic-town request', () => {
    const prompt =
      '生成一座矿镇社会（不是RPG）。场所必须包含矿窑、选矿棚、灯房。至少22名窑工、选矿工、矿灯看守。不要塌回无名广场模板，用 society.town-pack。';
    expect(isClassicTownPrompt(prompt)).toBe(false);
    const world = heuristicWorldFromPrompt(prompt);
    expect(world.space.regions.some((r) => r.id === 'town_square')).toBe(false);
    expect(world.space.regions.some((r) => r.name === '矿窑')).toBe(true);
    expect(world.space.regions.some((r) => r.name === '选矿棚')).toBe(true);
    expect(world.space.regions.some((r) => r.name === '灯房')).toBe(true);
    const jobs = world.entities
      .filter((e) => e.kind === 'npc')
      .map((e) => e.identity?.occupation ?? '')
      .join('\n');
    expect(jobs).toMatch(/窑工/);
    expect(jobs).toMatch(/选矿工/);
    expect(jobs).toMatch(/矿灯看守/);
  });

  it('synthesizes a space station crew pack without home_row', () => {
    const world = heuristicWorldFromPrompt(
      '一座空间站社会，舰桥、温室、休眠舱，共 12 名船员',
    );
    expect(world.presentation.genreProfile?.id).toBe('society.crew');
    expect(world.entities.filter((e) => e.kind === 'npc').length).toBe(12);
    expect(world.space.regions.every((r) => r.id !== 'home_row')).toBe(true);
    expect(world.space.regions.some((r) => r.name === '舰桥')).toBe(true);
  });

  it('does not pad an explicit crew headcount to 25', () => {
    const base = heuristicWorldFromPrompt(
      '一座货船社会，甲板、船舱、厨舱，共 6 名船员',
    );
    expect(base.entities.filter((e) => e.kind === 'npc').length).toBe(6);
    const { world } = ensureWorldDepth(base, {
      profile: CREW_GENRE_PROFILE,
      populationHint: 6,
    });
    expect(world.entities.filter((e) => e.kind === 'npc').length).toBe(6);
    expect(world.space.regions.every((r) => r.id !== 'home_row')).toBe(true);
  });

  it('trims a town overflow down to a compact headcount', () => {
    const base = heuristicWorldFromPrompt(
      '至少 22 名渔民的可观察社会，码头、船坞、晒网场',
    );
    expect(base.entities.filter((e) => e.kind === 'npc').length).toBeGreaterThan(
      10,
    );
    const { world } = ensureWorldDepth(base, {
      populationHint: 10,
    });
    expect(world.entities.filter((e) => e.kind === 'npc').length).toBe(10);
    expect(world.presentation.genreProfile?.population).toEqual({
      min: 10,
      max: 10,
    });
  });

  it('heuristic planner follows 至少 10 名 even when the pack tail says 18–25', async () => {
    const result = await planWorldFromPrompt(
      '生成一座可观察的夜校粉笔巷社会。至少 10 名有名字的居民。本模板使用 society.town pack：居民有住处和职场，约 18–25 人。',
      { forceHeuristic: true },
    );
    expect(
      result.world.entities.filter((e) => e.kind === 'npc').length,
    ).toBe(10);
  });

  it('rewrites pad schedules off 广场 when the hub is a ship deck', () => {
    const base = heuristicWorldFromPrompt(
      '一座货船社会，甲板、船舱、厨舱，共 4 名船员',
    );
    const { world } = ensureWorldDepth(base, {
      profile: CREW_GENRE_PROFILE,
    });
    const hub =
      world.space.regions.find((r) => r.id === world.space.startRegionId)
        ?.name ?? '';
    const pads = world.entities.filter((e) => e.tags.includes('padded'));
    expect(pads.length).toBeGreaterThan(0);
    const copy = pads
      .flatMap((n) => [
        n.identity?.backstory ?? '',
        ...(n.schedule ?? []).map((s) => s.activity),
      ])
      .join('\n');
    expect(copy).not.toContain('广场');
    expect(copy).toContain(hub);
  });

  it('gives vague society prompts a hashed place bag so they are not blank scaffolds', () => {
    const bags = new Set<string>();
    for (const prompt of [
      '生成一座可观察的小镇社会',
      '请随便做个村庄社会世界吧某某',
      'alpha living town society please',
      'beta 居民聚落世界',
    ]) {
      const places = extractPlacePromises(prompt);
      expect(places.length).toBeGreaterThan(0);
      bags.add(places.join('|'));
    }
    expect(bags.size).toBeGreaterThan(1);
  });

  it('does not leak tea-house places into a night-market prompt', () => {
    const places = extractPlacePromises(
      '生成一座可观察的夜市灯笼巷社会，场所必须包含夜市、烤串棚、灯笼巷。巷尾摊位。',
    );
    expect(places.some((p) => p.includes('茶'))).toBe(false);
    expect(places).toEqual(expect.arrayContaining(['夜市', '烤串棚', '灯笼巷']));
  });

  it('synthesizes an English fishing village without town_square', () => {
    const world = heuristicWorldFromPrompt(
      'A seaside fishing village with a dock, boatyard, and net yard',
    );
    const ids = world.space.regions.map((r) => r.id);
    expect(ids).not.toContain('town_square');
    expect(ids).not.toContain('home_row');
    expect(ids).toEqual(expect.arrayContaining(['dock', 'boat_yard', 'net_yard']));
    expect(world.space.regions.some((r) => r.name === 'Dock')).toBe(true);
    const names = world.entities
      .filter((e) => e.kind === 'npc')
      .map((e) => e.name)
      .join(' ');
    expect(names).not.toMatch(/[\u4e00-\u9fff]/);
  });

  it('synthesizes an English space station crew pack with a headcount', () => {
    const world = heuristicWorldFromPrompt(
      'A space station society with bridge, greenhouse, sleep bay, 12 crew',
    );
    expect(world.presentation.genreProfile?.id).toBe('society.crew');
    expect(world.entities.filter((e) => e.kind === 'npc').length).toBe(12);
    expect(world.space.regions.every((r) => r.id !== 'home_row')).toBe(true);
    expect(world.space.regions.some((r) => r.id === 'bridge' || r.name === 'Bridge')).toBe(
      true,
    );
  });

  it('English space-station NPCs stay ASCII and are not a Chinese town roster', () => {
    const world = heuristicWorldFromPrompt(
      'A space station society with bridge, greenhouse, sleep bay, 12 crew',
    );
    const names = world.entities
      .filter((e) => e.kind === 'npc')
      .map((e) => e.name)
      .join(' ');
    expect(names).not.toMatch(/[\u4e00-\u9fff]/);
    expect(names).toMatch(/Vega|Nils|Mara/);
    expect(world.entities.find((e) => e.kind === 'player')?.name).toBe('Observer');
  });

  it('does not pad a crew world with town bakers', () => {
    const base = heuristicWorldFromPrompt(
      '一座货船社会，甲板、船舱、厨舱，共 4 名船员',
    );
    const { world } = ensureWorldDepth(base, {
      profile: CREW_GENRE_PROFILE,
    });
    const pads = world.entities.filter((e) => e.tags.includes('padded'));
    expect(pads.length).toBeGreaterThan(0);
    expect(
      pads.every((n) => n.identity?.occupation !== '面包师'),
    ).toBe(true);
    expect(
      pads.some((n) =>
        /值班|舱务|厨|水手|机工|医|通讯/.test(n.identity?.occupation ?? ''),
      ),
    ).toBe(true);
  });

  it('synthesizes a cloister pack without town_square', () => {
    const world = heuristicWorldFromPrompt(
      '一座修道院社会，礼拜堂、抄经房、菜园',
    );
    expect(world.presentation.genreProfile?.id).toBe('society.cloister');
    expect(world.space.regions.some((r) => r.name === '礼拜堂')).toBe(true);
    expect(world.space.regions.every((r) => r.id !== 'town_square')).toBe(true);
  });

  it('does not pad a cloister with town bakers', () => {
    const base = heuristicWorldFromPrompt(
      '一座修道院社会，礼拜堂、抄经房、菜园，共 4 人',
    );
    const { world } = ensureWorldDepth(base, {
      profile: CLOISTER_GENRE_PROFILE,
    });
    const pads = world.entities.filter((e) => e.tags.includes('padded'));
    expect(pads.length).toBeGreaterThan(0);
    expect(pads.every((n) => n.identity?.occupation !== '面包师')).toBe(true);
    expect(
      pads.some((n) =>
        /司仪|抄经|园丁|膳|敲钟|守门|装订|司香/.test(
          n.identity?.occupation ?? '',
        ),
      ),
    ).toBe(true);
  });

  it('English cloister NPCs stay ASCII', () => {
    const world = heuristicWorldFromPrompt(
      'A monastery society with chapel, scriptorium, and garden',
    );
    expect(world.presentation.genreProfile?.id).toBe('society.cloister');
    const names = world.entities
      .filter((e) => e.kind === 'npc')
      .map((e) => e.name)
      .join(' ');
    expect(names).not.toMatch(/[\u4e00-\u9fff]/);
  });

  it('English crew-of-N on a vessel stays crew pack with ASCII names', () => {
    const world = heuristicWorldFromPrompt('A crew of 8 on a vessel');
    expect(world.presentation.genreProfile?.id).toBe('society.crew');
    expect(world.entities.filter((e) => e.kind === 'npc').length).toBe(8);
    expect(world.space.regions.every((r) => r.id !== 'town_square')).toBe(true);
    const names = world.entities
      .filter((e) => e.kind === 'npc')
      .map((e) => e.name)
      .join(' ');
    expect(names).not.toMatch(/[\u4e00-\u9fff]/);
    expect(
      world.space.regions.some((r) => /deck|cabin|galley/i.test(`${r.id} ${r.name}`)),
    ).toBe(true);
  });

  it('ASCII crew pads object state with a fact, not 闲着', () => {
    const base = heuristicWorldFromPrompt('A crew of 6 on a vessel');
    const hollow = parseWorldSpec({
      ...base,
      space: { ...base.space, areas: [] },
      relations: base.relations.filter((r) => r.type !== 'located_in'),
    });
    const { world } = ensureWorldDepth(hollow, {
      profile: CREW_GENRE_PROFILE,
      populationHint: 6,
    });
    const pads = (world.space.areas ?? [])
      .flatMap((a) => a.objects ?? [])
      .filter((o) => o.id.includes('_pad'));
    expect(pads.length).toBeGreaterThan(0);
    expect(pads.every((o) => /[A-Za-z]/.test(o.state) && o.state.length > 8)).toBe(
      true,
    );
    expect(pads.map((o) => o.state)).not.toContain('闲着');
    expect(pads.map((o) => o.state)).not.toContain('idle');
  });

  it('ASCII crew homes are bunks, not 的家', () => {
    const base = heuristicWorldFromPrompt('A crew of 6 on a vessel');
    const { world } = ensureWorldDepth(base, {
      profile: CREW_GENRE_PROFILE,
      populationHint: 6,
    });
    const homes = (world.space.areas ?? []).filter((a) =>
      /'s bunk\b/i.test(a.name),
    );
    expect(homes.length).toBeGreaterThan(0);
    expect((world.space.areas ?? []).some((a) => /的家$/.test(a.name))).toBe(
      false,
    );
    const bed = homes[0]?.objects?.[0];
    expect(bed?.state).toBe('blankets folded');
  });

  it('ASCII crew pad schedules wrap places in ASCII parens', () => {
    const base = heuristicWorldFromPrompt('A crew of 8 on a vessel');
    const { world } = ensureWorldDepth(base, {
      profile: CREW_GENRE_PROFILE,
    });
    const pads = world.entities.filter((e) => e.tags.includes('padded'));
    expect(pads.length).toBeGreaterThan(0);
    const acts = pads
      .flatMap((n) => n.schedule ?? [])
      .map((s) => s.activity)
      .join('\n');
    expect(acts).toMatch(/\(/);
    expect(acts).not.toMatch(/（/);
    const blurbs = pads
      .flatMap((n) => Object.values(n.identity?.initialRelations ?? {}))
      .join('\n');
    if (blurbs) expect(blurbs).not.toMatch(/（/);
  });

  it('edit-style min pad does not inflate an explicit crew of 6 to pack max', () => {
    const base = heuristicWorldFromPrompt(
      '一座货船社会，甲板、船舱、厨舱，共 6 名船员',
    );
    expect(base.entities.filter((e) => e.kind === 'npc').length).toBe(6);
    const { world } = ensureWorldDepth(base, {
      profile: CREW_GENRE_PROFILE,
      padPopulation: 'min',
    });
    expect(world.entities.filter((e) => e.kind === 'npc').length).toBe(6);
  });

  it('coversPromisedPlace matches English region titles case-insensitively', () => {
    expect(coversPromisedPlace('Dock', 'dock')).toBe(true);
    expect(coversPromisedPlace('Net Yard', 'net yard')).toBe(true);
    expect(coversPromisedPlace('舰桥', '舰桥')).toBe(true);
    expect(coversPromisedPlace('Dock', 'chapel')).toBe(false);
  });

  it('promised 鸡舍 uses a farm fence layout, not a generic work block', () => {
    expect(placeLayoutFlavor('鸡舍')).toBe('farm');
    expect(placeLayoutFlavor('coop')).toBe('farm');
    expect(placeLayoutFlavor('铁匠铺')).toBe('work');
    const world = createEmptyTownWorld({ title: 'FenceCheck' });
    expect(world.space.areas.some((a) => a.name === '鸡舍')).toBe(false);
    const next = ensurePromisedRegions(world, ['鸡舍']);
    const coop = next.space.regions.find((r) => r.name === '鸡舍');
    expect(coop).toBeTruthy();
    const ascii = coop?.layoutAscii ?? '';
    expect(ascii).toContain('*');
    expect(ascii).toMatch(/#\.#/);
    const work = ensurePromisedRegions(world, ['工坊']);
    const shop = work.space.regions.find((r) => r.name === '工坊');
    expect(shop?.layoutAscii ?? '').not.toContain('*');
  });

  it('planWorldOps add_region for a new place', async () => {
    process.env['WORLD_PLANNER_HEURISTIC'] = 'true';
    try {
      const planned = await planWorldOps('加一个晒网场区域', 'fishing village');
      expect(planned.understood).toBe(true);
      expect(planned.ops.some((o) => o.op === 'add_region')).toBe(true);
      const add = planned.ops.find((o) => o.op === 'add_region');
      expect(add && add.op === 'add_region' ? add.region.name : '').toBe('晒网场');
    } finally {
      delete process.env['WORLD_PLANNER_HEURISTIC'];
    }
  });
});
