/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  createEmptyTownWorld,
  createSocietyTownWorld,
  CREW_GENRE_PROFILE,
  diffWorldSpecs,
  evaluateEmergenceGate,
  evaluateSocietySeedGate,
  societySeedUsedFallback,
  formatWorldClock,
  gatheringInvitationText,
  gatheringSeedText,
  openingRumorFromSpec,
  genreProfileWithPopulation,
  hubPlaceName,
  parseWorldSpec,
  stampResidentPlaces,
  summarizeWorldSpec,
  toL3PresentationManifest,
  TOWN_GENRE_PROFILE,
  validateWorldSpec,
} from './schema.js';

describe('world-spec', () => {
  it('creates a valid empty town world', () => {
    const world = createEmptyTownWorld({ title: 'Testville' });
    expect(world.meta.title).toBe('Testville');
    expect(world.space.regions.length).toBeGreaterThan(0);
    expect(world.entities.some((e) => e.kind === 'player')).toBe(true);
    expect(world.space.portals.length).toBeGreaterThan(0);
  });

  it('society town has plaza paths and forest/inn layouts', () => {
    const world = createSocietyTownWorld({ title: '生活小镇' });
    const square = world.space.regions.find((r) => r.id === 'town_square');
    const forest = world.space.regions.find((r) => r.id === 'forest');
    const inn = world.space.regions.find((r) => r.id === 'inn_lane');
    expect(square?.layoutAscii).toContain('=');
    expect(square?.layoutAscii).toContain('*');
    expect(forest?.layoutAscii).toContain('=');
    expect(inn?.layoutAscii).toContain('=');
    expect(world.space.areas.some((a) => a.id === 'area_coop')).toBe(true);
    expect(
      world.space.areas.flatMap((a) => a.objects).some((o) => o.id === 'obj_coop' && o.name === '鸡舍'),
    ).toBe(true);
    const farmer = world.entities.find((e) => e.id === 'npc_farmer');
    expect(farmer?.schedule?.some((s) => /鸡舍/.test(s.activity))).toBe(true);
    expect(world.entities.filter((e) => e.kind === 'npc').length).toBeGreaterThanOrEqual(4);
  });

  it('society town is a village: 12+ residents across 6 regions', () => {
    const world = createSocietyTownWorld();
    const npcs = world.entities.filter((e) => e.kind === 'npc');
    expect(npcs.length).toBeGreaterThanOrEqual(18);
    expect(world.space.regions.length).toBeGreaterThanOrEqual(5);

    // Every resident needs a distinct occupation-bearing identity, otherwise
    // the occupation planner hands them all the same day.
    const occupations = new Set(
      npcs.map((n) => n.identity?.occupation).filter(Boolean),
    );
    expect(occupations.size).toBeGreaterThanOrEqual(14);

    // Residents must start spread out, not all in the plaza.
    const homeRegions = new Set(npcs.map((n) => n.regionId));
    expect(homeRegions.size).toBeGreaterThanOrEqual(4);

    // Seeded social graph so first meetings are not all identical.
    expect(world.relations.length).toBeGreaterThanOrEqual(18);
    expect(world.presentation.cinematicEnabled).toBe(false);
    const ids = new Set(world.entities.map((e) => e.id));
    const areaIds = new Set((world.space.areas ?? []).map((a) => a.id));
    for (const rel of world.relations) {
      expect(ids.has(rel.from)).toBe(true);
      if (rel.type === 'located_in') {
        expect(areaIds.has(rel.to) || ids.has(rel.to)).toBe(true);
      } else {
        expect(ids.has(rel.to)).toBe(true);
      }
    }
  });

  it('society town nests rooms and stamps home/work located_in', () => {
    const world = createSocietyTownWorld();
    expect(world.space.areas.some((a) => a.parentAreaId)).toBe(true);
    const npcs = world.entities.filter((e) => e.kind === 'npc');
    expect(npcs.every((n) => n.identity?.homeAreaId)).toBe(true);
    expect(npcs.every((n) => n.identity?.workAreaId)).toBe(true);
    expect(world.relations.some((r) => r.type === 'located_in')).toBe(true);
    expect(world.space.areas.some((a) => /的家$/.test(a.name))).toBe(true);
    expect(
      world.space.areas.some((a) => /的(炉|铺|案板|工位|课桌|诊桌|网位|窑口)$/.test(a.name)),
    ).toBe(true);
  });

  it('stamps English bunks and stations on an ASCII crew world', () => {
    const world = stampResidentPlaces(
      parseWorldSpec({
        meta: { id: 'crew-ascii', title: 'Vessel', version: 1 },
        presentation: { genreProfile: CREW_GENRE_PROFILE },
        space: {
          startRegionId: 'bridge',
          regions: [
            { id: 'bridge', name: 'Bridge', kind: 'interior', width: 12, height: 10 },
            {
              id: 'sleep_bay',
              name: 'Sleep bay',
              kind: 'interior',
              width: 12,
              height: 10,
            },
          ],
          areas: [
            { id: 'area_bridge', name: 'Bridge', regionId: 'bridge', objects: [] },
            {
              id: 'area_bunks',
              name: 'Sleep bay',
              regionId: 'sleep_bay',
              objects: [],
            },
          ],
        },
        entities: [
          {
            id: 'n1',
            kind: 'npc',
            name: 'Vega',
            regionId: 'sleep_bay',
            identity: { occupation: 'helmsman', traits: ['steady'] },
          },
        ],
      }),
    );
    expect(world.space.areas.some((a) => a.name === "Vega's bunk")).toBe(true);
    expect(world.space.areas.some((a) => /的家$/.test(a.name))).toBe(false);
    const bed = world.space.areas
      .flatMap((a) => a.objects ?? [])
      .find((o) => o.id === 'obj_bed_n1');
    expect(bed?.state).toBe('blankets folded');
    const work = world.space.areas.find((a) => a.id === 'area_work_n1');
    expect(work?.name).toBe("Vega's station");
    expect(work?.objects[0]?.state).toMatch(/half-done|helmsman/);
  });

  it('society town layouts are rectangular with walkable interiors and doors', () => {
    const world = createSocietyTownWorld();
    for (const region of world.space.regions) {
      const rows = (region.layoutAscii ?? '').split('\n');
      expect(rows.length).toBe(region.height);
      for (const row of rows) {
        expect(row.length).toBe(region.width);
      }
      // Enough open ground that residents are not squeezed into corridors.
      const walkable = rows
        .join('')
        .split('')
        .filter((c) => c !== '#' && c !== '~').length;
      expect(walkable / (region.width * region.height)).toBeGreaterThan(0.4);
    }
  });

  it('every region has areas and each portal pair is bidirectional', () => {
    const world = createSocietyTownWorld();
    const regionIds = world.space.regions.map((r) => r.id);
    for (const regionId of regionIds) {
      expect(
        world.space.areas.some((a) => a.regionId === regionId),
      ).toBe(true);
    }
    for (const portal of world.space.portals) {
      expect(regionIds).toContain(portal.fromRegionId);
      expect(regionIds).toContain(portal.toRegionId);
      const back = world.space.portals.some(
        (p) =>
          p.fromRegionId === portal.toRegionId &&
          p.toRegionId === portal.fromRegionId,
      );
      expect(back).toBe(true);
    }
    // Object ids must be unique — anchors are keyed by them.
    const objectIds = world.space.areas.flatMap((a) => a.objects.map((o) => o.id));
    expect(new Set(objectIds).size).toBe(objectIds.length);
  });

  it('rejects unknown start region', () => {
    const base = createEmptyTownWorld();
    const bad = {
      ...base,
      space: { ...base.space, startRegionId: 'missing' },
    };
    const result = validateWorldSpec(bad);
    expect(result.ok).toBe(false);
  });

  it('summarizes for LLM context', () => {
    const world = createEmptyTownWorld();
    const s = summarizeWorldSpec(world, 500);
    expect(s).toContain('World:');
    expect(s.length).toBeLessThanOrEqual(500);
  });

  it('diffs region/quest deltas between specs', () => {
    const before = createEmptyTownWorld({ title: 'Before' });
    const after = parseWorldSpec({
      ...before,
      space: {
        ...before.space,
        regions: [
          ...before.space.regions,
          {
            id: 'forest_east',
            name: 'East Forest',
            kind: 'wilderness',
            width: 16,
            height: 12,
            description: 'A new grove',
            tags: ['forest'],
          },
        ],
      },
      narrative: {
        ...before.narrative,
        quests: [
          ...before.narrative.quests,
          {
            id: 'q_forest',
            title: 'Scout the forest',
            description: 'Enter the eastern grove',
            status: 'available',
            steps: [
              {
                id: 's1',
                description: 'Enter forest_east',
                when: { op: 'always' },
                then: [],
              },
            ],
          },
        ],
      },
    });
    const d = diffWorldSpecs(before, after);
    expect(d.addedRegions).toContain('forest_east');
    expect(d.addedQuests).toContain('q_forest');
    expect(d.regionsAfter).toBe(d.regionsBefore + 1);
    expect(d.summaryLines.some((l) => l.includes('+regions'))).toBe(true);
  });

  it('diffs entity and rule id lists', () => {
    const before = createEmptyTownWorld({ title: 'Before' });
    const after = parseWorldSpec({
      ...before,
      entities: [
        ...before.entities,
        {
          id: 'npc_new',
          kind: 'npc',
          name: 'Newcomer',
          regionId: before.space.startRegionId,
          pos: { x: 2, y: 2 },
          attrs: {},
          inventory: [],
        },
      ],
      rules: [
        ...before.rules,
        {
          id: 'rule_welcome',
          when: { op: 'always' },
          then: [{ kind: 'set_flag', flag: 'welcomed', value: true }],
          once: true,
          priority: 0,
        },
      ],
    });
    const d = diffWorldSpecs(before, after);
    expect(d.addedEntities).toContain('npc_new');
    expect(d.addedRules).toContain('rule_welcome');
    expect(d.summaryLines.some((l) => l.includes('+entities'))).toBe(true);
    expect(d.summaryLines.some((l) => l.includes('+rules'))).toBe(true);
  });

  it('round-trips JSON', () => {
    const world = createEmptyTownWorld();
    const again = parseWorldSpec(JSON.parse(JSON.stringify(world)));
    expect(again.meta.id).toBe(world.meta.id);
  });

  it('exposes L3 presentation tip (档 B SSOT summary)', () => {
    const base = createEmptyTownWorld();
    const regionId = base.space.startRegionId;
    const world = parseWorldSpec({
      ...base,
      presentation: {
        ...base.presentation,
        spatialBackend: 'lingbot',
        cinematicEnabled: true,
        lingbotMode: 'mock',
        spatialAssets: {
          [regionId]: {
            backend: 'lingbot',
            videoUrl: './spatial/start.mp4',
            licenseNote: 'CC BY-NC-SA 4.0',
          },
        },
      },
    });
    const l3 = toL3PresentationManifest(world);
    expect(l3.backend).toBe('lingbot');
    expect(l3.lingbotMode).toBe('mock');
    expect(l3.cinematicEnabled).toBe(true);
    expect(l3.clipCount).toBe(1);
    expect(l3.regionsWithVideo).toContain(regionId);
  });

  it('round-trips presentation.worldBrief', () => {
    const base = createSocietyTownWorld({ title: 'BriefTown' });
    const world = parseWorldSpec({
      ...base,
      presentation: {
        ...base.presentation,
        worldBrief: {
          packId: 'society.town',
          useCase: 'xiangyi',
          venues: ['夜市', '茶馆'],
        },
      },
    });
    const again = parseWorldSpec(JSON.parse(JSON.stringify(world)));
    expect(again.presentation.worldBrief).toEqual({
      packId: 'society.town',
      useCase: 'xiangyi',
      venues: ['夜市', '茶馆'],
    });
  });

  it('round-trips presentation.genreProfile', () => {
    const world = createSocietyTownWorld({ title: 'ProfileTown' });
    expect(world.presentation.genreProfile?.id).toBe('society.town');
    const again = parseWorldSpec(JSON.parse(JSON.stringify(world)));
    expect(again.presentation.genreProfile?.id).toBe('society.town');
    expect(again.presentation.genreProfile?.population.max).toBe(25);
  });

  it('pins pack population to an explicit compact headcount', () => {
    const compact = genreProfileWithPopulation(TOWN_GENRE_PROFILE, 10);
    expect(compact.id).toBe('society.town');
    expect(compact.population).toEqual({ min: 10, max: 10 });
    const crowded = genreProfileWithPopulation(TOWN_GENRE_PROFILE, 36);
    expect(crowded.population).toEqual({ min: 36, max: 36 });
  });

  it('formatWorldClock distinguishes diurnal and watch', () => {
    expect(formatWorldClock(4)).toMatch(/凌晨/);
    expect(formatWorldClock(4, { kind: 'watch', shifts: 3 })).toMatch(/第.+班/);
  });

  it('formatWorldClock can speak English without changing the default', () => {
    expect(formatWorldClock(4, undefined, { ascii: true })).toBe(
      'Day 1 dawn 4:00',
    );
    expect(
      formatWorldClock(4, { kind: 'watch', shifts: 3 }, { ascii: true }),
    ).toMatch(/Watch 1/);
    expect(
      formatWorldClock(4, { kind: 'watch', shifts: 3 }, { ascii: true }),
    ).toMatch(/shift 1/);
    expect(formatWorldClock(4)).toMatch(/凌晨/);
  });

  it('gathering copy and emergence follow the genre pack, not 广场', () => {
    const town = createSocietyTownWorld();
    expect(hubPlaceName(town)).toBe('城镇广场');
    expect(gatheringSeedText('玛拉', town)).toContain('城镇广场');
    expect(gatheringSeedText('玛拉', town)).not.toMatch(/正在广场/);
    expect(evaluateEmergenceGate(24, 0.69, town.presentation.genreProfile).gateFailed).toBe(
      true,
    );
    expect(evaluateEmergenceGate(24, 0.7, town.presentation.genreProfile).gateFailed).toBe(
      false,
    );

    const crewLike = {
      presentation: { genreProfile: CREW_GENRE_PROFILE },
      space: {
        startRegionId: 'bridge',
        regions: [{ id: 'bridge', name: '舰桥', kind: 'interior' as const }],
      },
    };
    expect(gatheringSeedText('值班官', crewLike)).toContain('舰桥');
    expect(gatheringSeedText('值班官', crewLike)).toContain('交班');
    expect(gatheringSeedText('值班官', crewLike)).not.toContain('广场');

    const briefTown = {
      presentation: {
        genreProfile: town.presentation.genreProfile,
        worldBrief: {
          packId: 'society.town' as const,
          useCase: 'xiangyi',
          venues: ['夜市', '茶馆'],
        },
      },
      space: {
        startRegionId: 'night_market',
        regions: [
          { id: 'night_market', name: '夜市', kind: 'town' as const },
          { id: 'teahouse', name: '茶馆', kind: 'interior' as const },
        ],
      },
    };
    expect(hubPlaceName(briefTown)).toBe('夜市');
    expect(gatheringSeedText('阿禾', briefTown)).toContain('夜市');
    expect(gatheringSeedText('阿禾', briefTown)).toContain('巷议');
    expect(gatheringInvitationText(briefTown)).toBe('巷议');
    expect(
      evaluateEmergenceGate(12, 0.49, CREW_GENRE_PROFILE).gateFailed,
    ).toBe(true);
    expect(
      evaluateEmergenceGate(11, 0.49, CREW_GENRE_PROFILE).gateFailed,
    ).toBe(false);

    const crewEn = {
      presentation: { genreProfile: CREW_GENRE_PROFILE },
      space: {
        startRegionId: 'bridge',
        regions: [{ id: 'bridge', name: 'Bridge', kind: 'interior' as const }],
      },
    };
    expect(gatheringSeedText('Vega', crewEn)).toBe(
      'Vega is organizing a watch handoff at Bridge',
    );
    expect(gatheringSeedText('Vega', crewEn)).not.toMatch(/广场|交班/);
    expect(gatheringInvitationText(crewEn)).toBe('handoff');
  });

  it('opening rumor prefers a notice-board fact over a gathering verb', () => {
    const town = createSocietyTownWorld();
    const rumor = openingRumorFromSpec('玛拉', town);
    expect(rumor).toMatch(/告示|铁砧|聚会/);
    expect(rumor).not.toMatch(/正在城镇广场组织一场聚会/);
    expect(town.presentation.openingRumor).toMatch(/告示|铁砧/);
    expect(
      openingRumorFromSpec('Ada', {
        presentation: { openingRumor: 'The kiln went cold before dawn' },
        space: { startRegionId: 'kiln', regions: [{ id: 'kiln', name: 'Kiln' }] },
      }),
    ).toBe('The kiln went cold before dawn');
    expect(
      openingRumorFromSpec('玛拉', {
        presentation: { openingRumor: '玛拉正在广场组织一场聚会' },
        space: {
          areas: [
            {
              objects: [
                { name: '布告栏', state: '窑火天亮前就灭了' },
              ],
            },
          ],
        },
      }),
    ).toBe('窑火天亮前就灭了');
  });

  it('seed gate fails on zero real dialogue without waiting for the 24h window', () => {
    const zero = evaluateSocietySeedGate({
      hours: 6,
      spreadRate: 0.9,
      dialogues: 0,
      profile: TOWN_GENRE_PROFILE,
    });
    expect(zero.gateFailed).toBe(true);
    expect(zero.reason).toBe('dialogue');

    const thinSpread = evaluateSocietySeedGate({
      hours: 6,
      spreadRate: 0.2,
      dialogues: 3,
      profile: TOWN_GENRE_PROFILE,
    });
    expect(thinSpread.gateFailed).toBe(true);
    expect(thinSpread.reason).toBe('spread');

    const ok = evaluateSocietySeedGate({
      hours: 6,
      spreadRate: 0.7,
      dialogues: 4,
      profile: TOWN_GENRE_PROFILE,
    });
    expect(ok.gateFailed).toBe(false);
    expect(ok.reason).toBe('ok');

    expect(
      societySeedUsedFallback({
        dialogues: 4,
        degraded: true,
        reason: 'ok',
      }),
    ).toBe(false);
    expect(
      societySeedUsedFallback({
        dialogues: 0,
        degraded: true,
        reason: 'dialogue',
      }),
    ).toBe(true);

    const recited = evaluateSocietySeedGate({
      hours: 6,
      spreadRate: 0.8,
      dialogues: 4,
      profile: TOWN_GENRE_PROFILE,
      citesMemory: 0,
      followsLast: 0,
    });
    expect(recited.gateFailed).toBe(true);
    expect(recited.reason).toBe('judge');
  });
});