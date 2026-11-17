/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { deflateSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createEmptyTownWorld,
  createSocietyTownWorld,
  CREW_GENRE_PROFILE,
} from '@opengame/world-spec';
import { ensureWorldDepth } from '@opengame/world-planner';
import {
  regionIdsRequiringL3Slots,
  runWorldAssetDiskGate,
  runWorldQualityGate,
} from './worldQualityGate.js';

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function fakeRichPng(): Buffer {
  const w = 96;
  const h = 96;
  const stride = w * 3 + 1;
  const raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0;
    for (let x = 0; x < w; x++) {
      const i = y * stride + 1 + x * 3;
      raw[i] = (x * 37 + y * 13) & 0xff;
      raw[i + 1] = (x * 19 + y * 29) & 0xff;
      raw[i + 2] = (x * 7 + y * 53) & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

async function writeTownWorkspace(options: {
  readonly livingTown: boolean;
  readonly assetQuality: string;
  readonly includeEnemyItem: boolean;
}): Promise<string> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'og-world-gate-'));
  const assets = path.join(dir, 'public', 'assets');
  await fsp.mkdir(assets, { recursive: true });
  const world = options.livingTown
    ? createSocietyTownWorld({ title: 'GateSociety' })
    : createEmptyTownWorld({ title: 'GateRpg' });
  await fsp.writeFile(
    path.join(dir, 'public', 'world.json'),
    JSON.stringify(world),
    'utf8',
  );
  await fsp.writeFile(
    path.join(dir, 'public', 'ASSET_BRIEF.json'),
    JSON.stringify({ assetQuality: options.assetQuality }),
    'utf8',
  );
  const png = fakeRichPng();
  const names = options.includeEnemyItem
    ? ['player.png', 'npc.png', 'enemy.png', 'item.png', 'ground.png', 'wall.png']
    : ['player.png', 'npc.png', 'ground.png', 'wall.png'];
  for (const name of names) {
    await fsp.writeFile(path.join(assets, name), png);
  }
  const audio = Buffer.alloc(9_000, 7);
  for (const name of ['bgm.mp3', 'sfx_win.mp3', 'sfx_lose.mp3']) {
    await fsp.writeFile(path.join(assets, name), audio);
  }
  return dir;
}

describe('worldQualityGate', () => {
  it('passes thickened town template', () => {
    const world = createEmptyTownWorld({ title: 'GateTown' });
    const gate = runWorldQualityGate(world);
    expect(gate.ok).toBe(true);
    expect(gate.metrics.regions).toBeGreaterThanOrEqual(3);
    expect(gate.metrics.quests).toBeGreaterThanOrEqual(2);
  });

  it('ensureWorldDepth pads thin worlds', () => {
    const thin = createEmptyTownWorld({ title: 'Thin' });
    // strip to 1 region artificially via ensure on already-thick world is no-op
    const { world, after } = ensureWorldDepth(thin);
    expect(after.regions).toBeGreaterThanOrEqual(3);
    expect(runWorldQualityGate(world).ok).toBe(true);
  });

  it('societyFirst gate requires an area tree; ensureDepth satisfies it', () => {
    const thin = createEmptyTownWorld({ title: 'SocAreas' });
    thin.space.areas = [];
    const fail = runWorldQualityGate(thin, {
      societyFirst: true,
      checkL3: false,
    });
    expect(fail.ok).toBe(false);
    expect(fail.issues.some((i) => i.includes('space.areas'))).toBe(true);
    const { world } = ensureWorldDepth(thin, { mode: 'society' });
    const ok = runWorldQualityGate(world, {
      societyFirst: true,
      checkL3: false,
    });
    expect(ok.issues.filter((i) => i.includes('space.areas')).length).toBe(0);
  });

  it('societyFirst quality gate requires 18 NPCs', () => {
    const thin = createEmptyTownWorld({ title: 'SocFew' });
    const fail = runWorldQualityGate(thin, {
      societyFirst: true,
      checkL3: false,
    });
    expect(fail.issues.some((i) => i.includes('至少需要 18'))).toBe(true);
    const { world } = ensureWorldDepth(thin, { mode: 'society' });
    const ok = runWorldQualityGate(world, {
      societyFirst: true,
      checkL3: false,
    });
    expect(ok.issues.filter((i) => i.includes('至少需要')).length).toBe(0);
    expect(world.entities.filter((e) => e.kind === 'npc').length).toBeGreaterThanOrEqual(
      18,
    );
  });

  it('rejects L3 cinematic without playable startRegion media', () => {
    const world = createEmptyTownWorld({ title: 'L3Thin' });
    world.presentation.cinematicEnabled = true;
    world.presentation.spatialBackend = 'lingbot';
    world.presentation.lingbotMode = 'mock';
    world.presentation.spatialAssets = {
      [world.space.startRegionId]: {
        backend: 'lingbot',
        // JSON-only is not playable
        assetUrl: 'data:application/json,%7B%22x%22%3A1%7D',
      },
    };
    const gate = runWorldQualityGate(world);
    expect(gate.ok).toBe(false);
    expect(gate.issues.some((i) => i.includes('可播') || i.includes('槽位'))).toBe(
      true,
    );
  });

  it('rejects L3 when only startRegion has poster (expand/pad sync)', () => {
    const world = createEmptyTownWorld({ title: 'L3Partial' });
    world.presentation.cinematicEnabled = true;
    world.presentation.spatialBackend = 'lingbot';
    world.presentation.lingbotMode = 'mock';
    const png =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    world.presentation.spatialAssets = {
      [world.space.startRegionId]: { backend: 'lingbot', assetUrl: png },
    };
    const gate = runWorldQualityGate(world);
    expect(gate.ok).toBe(false);
    expect(
      gate.issues.some(
        (i) => i.includes('L3 区域=') && i.includes('缺少'),
      ),
    ).toBe(true);
  });

  it('skips L3 slot checks for the pre-asset content gate (checkL3=false)', () => {
    const world = createEmptyTownWorld({ title: 'PreAsset' });
    world.presentation.cinematicEnabled = true;
    world.presentation.spatialBackend = 'lingbot';
    world.presentation.lingbotMode = 'mock';
    world.presentation.spatialAssets = {};
    const gate = runWorldQualityGate(world, { checkL3: false });
    expect(gate.issues.some((i) => i.includes('L3 区域='))).toBe(false);
  });

  it('accepts L3 with png poster on all regions', () => {
    const world = createEmptyTownWorld({ title: 'L3Ok' });
    world.presentation.cinematicEnabled = true;
    world.presentation.spatialBackend = 'lingbot';
    world.presentation.lingbotMode = 'mock';
    const png =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    world.presentation.spatialAssets = Object.fromEntries(
      world.space.regions.map((r) => [
        r.id,
        { backend: 'lingbot', assetUrl: png },
      ]),
    );
    const gate = runWorldQualityGate(world);
    expect(gate.ok).toBe(true);
  });

  it('requires agenticDiff when WORLD_AGENTIC_ON_GENERATE=true', () => {
    const prev = process.env['WORLD_AGENTIC_ON_GENERATE'];
    process.env['WORLD_AGENTIC_ON_GENERATE'] = 'true';
    try {
      const world = createEmptyTownWorld({ title: 'NeedDiff' });
      const missing = runWorldQualityGate(world);
      expect(missing.ok).toBe(false);
      expect(missing.issues.some((i) => i.includes('agenticDiff'))).toBe(true);

      world.presentation.agenticDiff = {
        beforeRegions: 3,
        afterRegions: 3,
        beforeQuests: 2,
        afterQuests: 2,
        beforeRules: 2,
        afterRules: 2,
        opsApplied: 0,
      };
      const stamped = runWorldQualityGate(world);
      expect(stamped.issues.some((i) => i.includes('agenticDiff'))).toBe(false);
    } finally {
      if (prev === undefined) delete process.env['WORLD_AGENTIC_ON_GENERATE'];
      else process.env['WORLD_AGENTIC_ON_GENERATE'] = prev;
    }
  });

  it('requires posters for every region on a small society town', () => {
    const world = createSocietyTownWorld({ title: 'SocietySlots' });
    const ids = regionIdsRequiringL3Slots(world);
    expect(ids).toEqual(expect.arrayContaining(['forest', 'inn_lane']));
    expect(ids.length).toBe(world.space.regions.length);
  });
});

describe('runWorldAssetDiskGate living town', () => {
  const prevReq = process.env['WORLD_REQUIRE_REAL_ASSETS'];
  const dirs: string[] = [];

  afterEach(() => {
    if (prevReq === undefined) delete process.env['WORLD_REQUIRE_REAL_ASSETS'];
    else process.env['WORLD_REQUIRE_REAL_ASSETS'] = prevReq;
    for (const dir of dirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  it('does not require enemy.png / item.png for a society town', async () => {
    process.env['WORLD_REQUIRE_REAL_ASSETS'] = 'true';
    const dir = await writeTownWorkspace({
      livingTown: true,
      assetQuality: 'minimax',
      includeEnemyItem: false,
    });
    dirs.push(dir);
    const gate = runWorldAssetDiskGate(dir);
    expect(gate.issues).toEqual([]);
    expect(gate.ok).toBe(true);
  });

  it('accepts mixed-failover when MiniMax images shipped with seed audio', async () => {
    process.env['WORLD_REQUIRE_REAL_ASSETS'] = 'true';
    const dir = await writeTownWorkspace({
      livingTown: true,
      assetQuality: 'mixed-failover',
      includeEnemyItem: false,
    });
    dirs.push(dir);
    const gate = runWorldAssetDiskGate(dir);
    expect(gate.ok).toBe(true);
  });

  it('still requires enemy.png / item.png for an RPG town', async () => {
    process.env['WORLD_REQUIRE_REAL_ASSETS'] = 'true';
    const dir = await writeTownWorkspace({
      livingTown: false,
      assetQuality: 'minimax',
      includeEnemyItem: false,
    });
    dirs.push(dir);
    const gate = runWorldAssetDiskGate(dir);
    expect(gate.ok).toBe(false);
    expect(gate.issues.some((i) => i.includes('enemy.png'))).toBe(true);
    expect(gate.issues.some((i) => i.includes('item.png'))).toBe(true);
  });

  it('crew profile allows 6 NPCs and rejects missing place promises', () => {
    const world = createSocietyTownWorld({ title: 'CrewGate' });
    const thin = {
      ...world,
      entities: world.entities.filter((e) => e.kind !== 'npc').concat(
        world.entities.filter((e) => e.kind === 'npc').slice(0, 6),
      ),
      presentation: {
        ...world.presentation,
        genreProfile: CREW_GENRE_PROFILE,
      },
    };
    const parsed = thin;
    const ok = runWorldQualityGate(parsed as typeof world, {
      profile: CREW_GENRE_PROFILE,
      checkL3: false,
    });
    expect(ok.issues.filter((i) => i.includes('至少需要')).length).toBe(0);
    const miss = runWorldQualityGate(world, {
      societyFirst: true,
      placePromises: ['不存在的神殿'],
      checkL3: false,
    });
    expect(miss.issues.some((i) => i.includes('场所承诺未覆盖'))).toBe(true);
    const hit = runWorldQualityGate(world, {
      societyFirst: true,
      placePromises: ['城镇广场'],
      checkL3: false,
    });
    expect(hit.issues.filter((i) => i.includes('场所承诺')).length).toBe(0);
    const docked = {
      ...world,
      space: {
        ...world.space,
        regions: world.space.regions.map((r, i) =>
          i === 0 ? { ...r, name: 'Dock' } : r,
        ),
      },
    };
    const enHit = runWorldQualityGate(docked as typeof world, {
      societyFirst: true,
      placePromises: ['dock'],
      checkL3: false,
    });
    expect(enHit.issues.filter((i) => i.includes('场所承诺')).length).toBe(0);
  });

  it('rejects scaffold town ids when the prompt promised a dock, not a plaza', () => {
    const world = createSocietyTownWorld({ title: 'HarborStamp' });
    const stamped = runWorldQualityGate(world, {
      societyFirst: true,
      placePromises: ['码头'],
      checkL3: false,
    });
    expect(
      stamped.issues.some((i) => i.includes('脚手架区域')),
    ).toBe(true);
    const classic = runWorldQualityGate(world, {
      societyFirst: true,
      placePromises: ['城镇广场'],
      allowScaffoldTown: true,
      checkL3: false,
    });
    expect(classic.issues.filter((i) => i.includes('脚手架区域')).length).toBe(
      0,
    );
  });

  it('fails when a brief-named place is missing', () => {
    const world = createSocietyTownWorld({ title: 'BriefPlace' });
    const miss = runWorldQualityGate(world, {
      societyFirst: true,
      briefPlaces: ['夜市'],
      checkL3: false,
    });
    expect(miss.issues.some((i) => i.includes('点名场所未出现：夜市'))).toBe(
      true,
    );
  });

  it('fails when the synthesized pack does not match the brief', () => {
    const world = createSocietyTownWorld({ title: 'BriefPack' });
    const miss = runWorldQualityGate(world, {
      societyFirst: true,
      briefPackId: 'society.crew',
      briefPlaces: ['舰桥'],
      checkL3: false,
    });
    expect(miss.issues.some((i) => i.includes('简报 pack 冲突'))).toBe(true);
    expect(miss.issues.some((i) => i.includes('点名场所未出现：舰桥'))).toBe(
      true,
    );
  });

  it('fails when brief venues and pack belong to different families', () => {
    const world = createSocietyTownWorld({ title: 'FamilyClash' });
    const miss = runWorldQualityGate(world, {
      societyFirst: true,
      briefPackId: 'society.town',
      briefPlaces: ['舰桥'],
      checkL3: false,
    });
    expect(miss.issues.some((i) => i.includes('简报场所与 pack 冲突'))).toBe(
      true,
    );
  });

  it('rejects occupation promises that miss the entire roster', () => {
    const world = createSocietyTownWorld({ title: 'Jobs' });
    const miss = runWorldQualityGate(world, {
      societyFirst: true,
      occupationPromises: ['helmsman', 'botanist'],
      checkL3: false,
    });
    expect(miss.issues.some((i) => i.includes('职业承诺未覆盖'))).toBe(true);
    const hit = runWorldQualityGate(world, {
      societyFirst: true,
      occupationPromises: ['铁匠'],
      checkL3: false,
    });
    expect(hit.issues.filter((i) => i.includes('职业承诺')).length).toBe(0);
    expect(hit.metrics.authoredNpcs).toBeGreaterThan(0);
    expect((hit.metrics.authoredNpcs ?? 0) + (hit.metrics.paddedNpcs ?? 0)).toBe(
      hit.metrics.npcs,
    );
  });

  it('rejects NPC and schedule regionIds that are not map regions', () => {
    const world = createSocietyTownWorld({ title: 'RegionGate' });
    const npc = world.entities.find((e) => e.kind === 'npc');
    expect(npc).toBeTruthy();
    const broken = {
      ...world,
      entities: world.entities.map((e) =>
        e.id === npc!.id
          ? {
              ...e,
              regionId: 'forge_not_a_region',
              schedule: [
                { hour: 9, regionId: 'also_not_a_region', activity: 'work' },
              ],
            }
          : e,
      ),
    } as typeof world;
    const gate = runWorldQualityGate(broken, {
      societyFirst: true,
      checkL3: false,
    });
    expect(gate.ok).toBe(false);
    expect(gate.issues.some((i) => i.includes('精灵 regionId 无效'))).toBe(true);
    expect(gate.issues.some((i) => i.includes('日程 regionId 无效'))).toBe(true);
  });

  it('requires stance cards on planner-authored society rosters', () => {
    const world = createSocietyTownWorld({ title: 'StanceGate' });
    const tagged = {
      ...world,
      entities: world.entities.map((e) =>
        e.kind === 'npc' ? { ...e, tags: ['authored'] } : e,
      ),
    } as typeof world;
    const miss = runWorldQualityGate(tagged, {
      societyFirst: true,
      checkL3: false,
    });
    expect(miss.issues.some((i) => i.includes('立场卡缺失'))).toBe(true);
  });

  it('rejects a gathering-verb rumor and idle object states', () => {
    const world = createSocietyTownWorld({ title: 'EmptyRumor' });
    world.presentation.openingRumor = '玛拉正在广场组织一场聚会';
    world.space.areas = (world.space.areas ?? []).map((a) => ({
      ...a,
      objects: (a.objects ?? []).map((o) => ({ ...o, state: '闲着' })),
    }));
    const fail = runWorldQualityGate(world, {
      societyFirst: true,
      checkL3: false,
    });
    expect(fail.issues.some((i) => i.includes('开场传闻太空'))).toBe(true);
    expect(fail.issues.some((i) => i.includes('物件状态全是套话'))).toBe(true);
  });

  it('ensureWorldDepth stamps a speakable rumor and disagreeing secrets', () => {
    const thin = createEmptyTownWorld({ title: 'StampRumor' });
    const { world } = ensureWorldDepth(thin, { mode: 'society' });
    const gate = runWorldQualityGate(world, {
      societyFirst: true,
      checkL3: false,
    });
    expect(
      gate.issues.filter(
        (i) =>
          i.includes('开场传闻') ||
          i.includes('物件状态') ||
          i.includes('秘密互相') ||
          i.includes('立场没有'),
      ).length,
    ).toBe(0);
    expect(world.presentation.openingRumor).toMatch(/party invitation|告示|embers|Forge/i);
    const clones = {
      ...world,
      entities: world.entities.map((e) =>
        e.kind === 'npc'
          ? {
              ...e,
              identity: {
                ...e.identity,
                secret: 'same secret everyone knows',
                stance: 'same stance',
              },
            }
          : e,
      ),
    };
    const same = runWorldQualityGate(clones as typeof world, {
      societyFirst: true,
      checkL3: false,
    });
    expect(same.issues.some((i) => i.includes('秘密互相复读'))).toBe(true);
    expect(same.issues.some((i) => i.includes('立场没有分歧'))).toBe(true);
  });

  it('accepts temple-square synonyms, incense objects, and 庙祝 for incense jobs', () => {
    const world = createSocietyTownWorld({ title: 'TempleGate' });
    const areas = (world.space.areas ?? []).map((a, i) =>
      i === 0
        ? {
            ...a,
            name: '大雄宝殿',
            objects: [
              ...(a.objects ?? []),
              {
                id: 'obj_incense',
                name: '香炉',
                state: '刚有人添过香',
                tags: [],
              },
            ],
          }
        : a,
    );
    const renamed = {
      ...world,
      space: {
        ...world.space,
        regions: world.space.regions.map((r, i) =>
          i === 0 ? { ...r, id: 'temple_gate', name: '庙门广场' } : r,
        ),
        startRegionId:
          world.space.startRegionId === 'town_square'
            ? 'temple_gate'
            : world.space.startRegionId,
        portals: world.space.portals.map((p) => ({
          ...p,
          fromRegionId:
            p.fromRegionId === 'town_square' ? 'temple_gate' : p.fromRegionId,
          toRegionId:
            p.toRegionId === 'town_square' ? 'temple_gate' : p.toRegionId,
        })),
        areas: areas.map((a) => ({
          ...a,
          regionId: a.regionId === 'town_square' ? 'temple_gate' : a.regionId,
        })),
      },
      entities: world.entities.map((e) => ({
        ...e,
        regionId: e.regionId === 'town_square' ? 'temple_gate' : e.regionId,
        identity:
          e.id === 'npc_smith'
            ? { ...e.identity, occupation: '庙祝' }
            : e.identity,
      })),
    };
    const gate = runWorldQualityGate(renamed as typeof world, {
      societyFirst: true,
      placePromises: ['庙宇', '香案'],
      occupationPromises: ['香火看守', '司香'],
      allowScaffoldTown: true,
      checkL3: false,
    });
    expect(gate.issues.filter((i) => i.includes('场所承诺')).length).toBe(0);
    expect(gate.issues.filter((i) => i.includes('职业承诺')).length).toBe(0);
  });

  it('accepts mining-town synonyms for 矿窑/选矿棚/灯房', () => {
    const world = createSocietyTownWorld({ title: 'KilnGate' });
    const areas = (world.space.areas ?? []).map((a, i) =>
      i === 0
        ? { ...a, name: '选矿场', objects: a.objects ?? [] }
        : i === 1
          ? { ...a, name: '矿灯房', objects: a.objects ?? [] }
          : a,
    );
    const renamed = {
      ...world,
      space: {
        ...world.space,
        regions: world.space.regions.map((r, i) =>
          i === 0 ? { ...r, id: 'kiln', name: '矿井' } : r,
        ),
        startRegionId:
          world.space.startRegionId === 'town_square'
            ? 'kiln'
            : world.space.startRegionId,
        portals: world.space.portals.map((p) => ({
          ...p,
          fromRegionId: p.fromRegionId === 'town_square' ? 'kiln' : p.fromRegionId,
          toRegionId: p.toRegionId === 'town_square' ? 'kiln' : p.toRegionId,
        })),
        areas: areas.map((a) => ({
          ...a,
          regionId: a.regionId === 'town_square' ? 'kiln' : a.regionId,
        })),
      },
      entities: world.entities.map((e) => ({
        ...e,
        regionId: e.regionId === 'town_square' ? 'kiln' : e.regionId,
        identity:
          e.id === 'npc_smith'
            ? { ...e.identity, occupation: '矿工' }
            : e.identity,
      })),
    };
    const gate = runWorldQualityGate(renamed as typeof world, {
      societyFirst: true,
      placePromises: ['矿窑', '选矿棚', '灯房'],
      occupationPromises: ['窑工', '选矿工', '矿灯看守'],
      allowScaffoldTown: true,
      checkL3: false,
    });
    expect(gate.issues.filter((i) => i.includes('场所承诺')).length).toBe(0);
    expect(gate.issues.filter((i) => i.includes('职业承诺')).length).toBe(0);
  });
});
