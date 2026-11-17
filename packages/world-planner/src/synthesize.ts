/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Build a living-society World Spec from Intent IR — unique region ids,
 * never the Stanford-town scaffold ids.
 */

import {
  artStyleProfile,
  isScaffoldTownRegionId,
  parseWorldSpec,
  shortDisplayTitle,
  TOWN_GENRE_PROFILE,
  type GenreProfile,
  type WorldSpec,
} from '@opengame/world-spec';
import type { IntentIR } from './intent.js';
import {
  isMostlyAsciiText,
  occupationForPlace,
  PLACE_SLUGS,
  coversPromisedPlaceLoose,
  coversPromisedOccupation,
} from './locale/extractPlaces.js';
import {
  coversPromisedResident,
  type ResidentPromise,
} from './locale/extractResidents.js';
import {
  defaultOccupation,
  emptyPlacesFor,
  fillerPlacesFor,
  npcProse,
  residentPool,
  societyMetaCopy,
} from './locale/residents.js';
import { stanceCardFor } from './locale/stanceCard.js';

export { stanceCardFor, stampMissingStanceCards } from './locale/stanceCard.js';

function slugForPlace(name: string, index: number): string {
  const known = PLACE_SLUGS[name] ?? PLACE_SLUGS[name.toLowerCase()];
  if (known && !isScaffoldTownRegionId(known)) return known;
  const ascii = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 24);
  if (ascii.length >= 2 && !isScaffoldTownRegionId(ascii)) return ascii;
  let h = index + 1;
  for (const ch of name) h = (Math.imul(h, 33) + ch.charCodeAt(0)) >>> 0;
  const id = `place_${h.toString(36)}`;
  return isScaffoldTownRegionId(id) ? `place_x_${index}` : id;
}

function displayPlaceName(name: string): string {
  if (/[^\x00-\x7F]/.test(name)) return name;
  return name.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

function placeDescription(name: string): string {
  if (/[^\x00-\x7F]/.test(name)) return `${name}一带，居民日常会路过。`;
  return `People pass through ${name} every day.`;
}

function isMostlyAsciiPlaces(places: readonly string[]): boolean {
  return isMostlyAsciiText(places.join(''));
}

function npcKey(name: string, index: number): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 24);
  return `npc_syn_${index}_${slug || 'r'}`;
}

function isFarmPlaceName(name: string): boolean {
  if (/宿舍/.test(name) && !/鸡/.test(name)) return false;
  return /鸡|窝|coop|hen|chicken|田|垄|稻|farm|field/i.test(name) ||
    (/舍/.test(name) && !/宿舍/.test(name));
}

export function placeLayoutFlavor(
  name: string,
): 'hub' | 'work' | 'rest' | 'farm' {
  if (isFarmPlaceName(name)) return 'farm';
  if (
    /巷|宅|家|休眠|船舱|菜园|宿舍|sleep|cabin|bay|garden|home|quarters/i.test(
      name,
    )
  ) {
    return 'rest';
  }
  return 'work';
}

function layoutAscii(
  width: number,
  height: number,
  flavor: 'hub' | 'work' | 'rest' | 'farm',
): string {
  const rows: string[] = [];
  const mid = Math.floor(height / 2);
  for (let y = 0; y < height; y++) {
    if (y === 0 || y === height - 1) {
      rows.push('#'.repeat(width));
      continue;
    }
    const cells: string[] = Array.from({ length: width }, (_, x) =>
      x === 0 || x === width - 1 ? '#' : '.',
    );
    if (y === mid || y === mid + 1) {
      for (let x = 1; x < width - 1; x++) cells[x] = '=';
    }
    if (flavor === 'farm' && y >= 2 && y <= 6) {
      const left = 2;
      const right = Math.min(8, width - 3);
      const doorX = Math.floor((left + right) / 2);
      if (y === 2 || y === 6) {
        for (let x = left; x <= right; x++) {
          cells[x] = y === 6 && x === doorX ? '.' : '#';
        }
      } else {
        cells[left] = '#';
        cells[right] = '#';
        for (let x = left + 1; x < right; x++) {
          cells[x] = (x + y) % 2 === 0 ? '*' : '.';
        }
      }
    } else if ((flavor === 'work' || flavor === 'rest') && y >= 2 && y <= 5) {
      for (let x = 2; x <= Math.min(7, width - 3); x++) {
        cells[x] = y === 5 && x === 4 ? '.' : '#';
      }
    }
    if (flavor === 'hub' && y === mid - 1) {
      for (let x = Math.floor(width / 2) - 2; x <= Math.floor(width / 2) + 2; x++) {
        if (x > 0 && x < width - 1) cells[x] = '*';
      }
    }
    rows.push(cells.join(''));
  }
  return rows.join('\n');
}

function flavorOf(name: string, index: number, last: number): 'hub' | 'work' | 'rest' | 'farm' {
  if (index === 0) return 'hub';
  if (isFarmPlaceName(name)) return 'farm';
  if (
    index === last ||
    /巷|宅|家|休眠|船舱|菜园|宿舍|sleep|cabin|bay|garden|home|quarters/i.test(name)
  ) {
    return 'rest';
  }
  return 'work';
}

export function synthesizeSocietyWorld(input: {
  readonly title: string;
  readonly prompt: string;
  readonly ir: IntentIR;
  /** Art style picked by the user; omit to keep the high-fidelity default. */
  readonly artStyleId?: string;
}): WorldSpec {
  const ir = input.ir;
  const profile: GenreProfile = ir.profile;
  let places = [...ir.places];
  const asciiLocale = isMostlyAsciiText(input.prompt) || isMostlyAsciiPlaces(places);
  if (places.length < profile.topology.minRegions) {
    const extra = fillerPlacesFor(profile.id, asciiLocale);
    for (const p of extra) {
      if (places.length >= profile.topology.minRegions) break;
      if (!places.includes(p)) places.push(p);
    }
  }
  places = places.slice(0, profile.topology.maxRegions);
  if (!places.length) {
    places = [...emptyPlacesFor(profile.id, asciiLocale)];
  }

  const styleProfile = artStyleProfile(input.artStyleId);
  const pool = residentPool(profile.id, asciiLocale);
  const copy = societyMetaCopy(profile.id, asciiLocale, places);

  const usedIds = new Set<string>();
  const regions = places.map((name, i) => {
    let id = slugForPlace(name, i);
    if (
      usedIds.has(id) ||
      isScaffoldTownRegionId(id) ||
      ir.forbiddenIds?.includes(id)
    ) {
      id = `${id}_${i}`;
    }
    usedIds.add(id);
    const flavor = flavorOf(name, i, places.length - 1);
    const width = flavor === 'hub' ? 24 : 20;
    const height = flavor === 'hub' ? 18 : 16;
    const label = displayPlaceName(name);
    return {
      id,
      name: label,
      kind:
        profile.id === 'society.crew'
          ? ('interior' as const)
          : flavor === 'hub'
            ? ('town' as const)
            : ('interior' as const),
      width,
      height,
      description: placeDescription(label),
      tags: [flavor === 'hub' ? 'social' : flavor],
      layoutAscii: layoutAscii(width, height, flavor),
    };
  });

  const hub = regions[0]!;
  const portals = regions.slice(1).flatMap((r) => [
    {
      id: `portal_${hub.id}_${r.id}`,
      fromRegionId: hub.id,
      toRegionId: r.id,
      fromPos: { x: hub.width - 2, y: Math.floor(hub.height / 2) },
      toPos: { x: 2, y: Math.floor(r.height / 2) },
      label: r.name,
    },
    {
      id: `portal_${r.id}_${hub.id}`,
      fromRegionId: r.id,
      toRegionId: hub.id,
      fromPos: { x: 2, y: Math.floor(r.height / 2) },
      toPos: { x: hub.width - 3, y: Math.floor(hub.height / 2) },
      label: hub.name,
    },
  ]);

  const areas = regions.map((r, i) => ({
    id: `area_${r.id}`,
    name: r.name,
    regionId: r.id,
    objects:
      i === 0
        ? [
            {
              id: `obj_${r.id}_notice`,
              name: asciiLocale ? 'notice board' : '布告栏',
              state: copy.talked,
              tags: [],
            },
            {
              id: `obj_${r.id}_main`,
              name: r.name,
              state: copy.passed,
              tags: [],
            },
          ]
        : [
            {
              id: `obj_${r.id}_main`,
              name: r.name,
              state: copy.passed,
              tags: [],
            },
          ],
  }));

  const restRegion = regions[regions.length - 1] ?? hub;
  const targetNpcs =
    ir.populationHint != null
      ? Math.max(2, ir.populationHint)
      : Math.min(profile.population.max, profile.population.min);

  const npcs: Array<{
    id: string;
    kind: 'npc';
    name: string;
    regionId: string;
    pos: { x: number; y: number };
    personality: string;
    dialogueSeed: string;
    identity: {
      displayName: string;
      age: number;
      occupation: string;
      traits: string[];
      backstory: string;
      homeAreaId: string;
      workAreaId: string;
      initialRelations: Record<string, string>;
      secret?: string;
      stance?: string;
      withholdFrom?: string[];
    };
    schedule: Array<{ hour: number; regionId: string; activity: string }>;
    tags: string[];
  }> = [];
  const named = ir.residents ?? [];
  const usedNames = new Set(named.map((r) => r.name));
  let poolCursor = 0;
  for (let i = 0; i < targetNpcs; i++) {
    const promised = named[i];
    let who = pool[i % pool.length]!;
    let name: string;
    if (promised) {
      name = promised.name;
    } else {
      let poolName = '';
      for (let tries = 0; tries < pool.length * 4; tries++) {
        who = pool[poolCursor % pool.length]!;
        const gen = Math.floor(poolCursor / pool.length);
        poolName =
          gen === 0
            ? who.name
            : asciiLocale
              ? `${who.name} ${gen + 1}`
              : `${who.name}${gen + 1}`;
        poolCursor += 1;
        if (!usedNames.has(poolName)) break;
      }
      name = poolName || `pad_${i}`;
    }
    usedNames.add(name);
    const padded = !promised;
    const place = places[i % places.length]!;
    const workRegion = regions[i % regions.length]!;
    const workArea = areas.find((a) => a.regionId === workRegion.id)!;
    const homeArea =
      areas.find((a) => a.regionId === restRegion.id) ?? workArea;
    const occupation =
      promised?.occupation ??
      (ir.occupations.length
        ? ir.occupations[i % ir.occupations.length]
        : undefined) ??
      occupationForPlace(place) ??
      defaultOccupation(profile.id, asciiLocale);
    const card = stanceCardFor(name, occupation, i, asciiLocale);
    const prose = npcProse({
      ascii: asciiLocale,
      packId: profile.id,
      name,
      trait: who.traits[0] ?? occupation,
      occupation,
      place,
      hub: hub.name,
    });
    const id = npcKey(name, i);
    npcs.push({
      id,
      kind: 'npc' as const,
      name,
      regionId: workRegion.id,
      pos: {
        x: 3 + (i % 8),
        y: 4 + (i % 6),
      },
      personality: prose.personality,
      dialogueSeed: prose.dialogueSeed,
      identity: {
        displayName: name,
        age: 20 + ((i * 7) % 40),
        occupation,
        traits: [...who.traits],
        backstory: prose.backstory,
        homeAreaId: homeArea.id,
        workAreaId: workArea.id,
        initialRelations: {},
        secret: card.secret,
        stance: card.stance,
      },
      schedule: [
        {
          hour: 8,
          regionId: workRegion.id,
          activity: prose.morning,
        },
        {
          hour: 18,
          regionId: hub.id,
          activity: prose.evening,
        },
      ],
      tags: padded ? ['padded'] : ['authored'],
    });
  }

  for (let i = 0; i < npcs.length; i++) {
    if (i % 3 !== 0) continue;
    const buddy = npcs[(i + 1) % npcs.length];
    if (buddy && buddy.id !== npcs[i]!.id) {
      npcs[i]!.identity.withholdFrom = [buddy.id];
    }
  }

  const relations = npcs.flatMap((n, i) => {
    const buddy = npcs[(i + 1) % npcs.length]!;
    if (buddy.id === n.id) return [];
    return [
      {
        id: `rel_${n.id}_${buddy.id}`,
        from: n.id,
        to: buddy.id,
        type: 'knows' as const,
        strength: 0.35,
        meta: { label: copy.knows },
      },
      {
        id: `loc_home_${n.id}`,
        from: n.id,
        to: n.identity.homeAreaId,
        type: 'located_in' as const,
        strength: 0.9,
        meta: { role: 'home' },
      },
      {
        id: `loc_work_${n.id}`,
        from: n.id,
        to: n.identity.workAreaId,
        type: 'located_in' as const,
        strength: 0.8,
        meta: { role: 'work' },
      },
    ];
  });

  return parseWorldSpec({
    meta: {
      id: `world_${Math.abs(hashString(input.prompt)).toString(36)}`,
      title: shortDisplayTitle(input.title, 28),
      version: 1,
      summary: copy.summary,
    },
    styleAnchor: {
      artStyle: styleProfile.artStyle,
      artStyleId: styleProfile.id,
      palette: input.artStyleId
        ? [...styleProfile.palette]
        : ['#2d6a4f', '#d8f3dc', '#f4a261'],
      mood: copy.mood,
    },
    space: {
      regions,
      portals,
      startRegionId: hub.id,
      startPos: { x: Math.floor(hub.width / 2), y: Math.floor(hub.height / 2) },
      areas,
    },
    entities: [
      {
        id: 'player',
        kind: 'player',
        name: copy.playerName,
        regionId: hub.id,
        pos: { x: Math.floor(hub.width / 2), y: Math.floor(hub.height / 2) },
        attrs: { hp: 10, role: 'observer' },
        inventory: [],
        spriteKey: '👁',
      },
      ...npcs,
    ],
    relations,
    rules: [
      {
        id: 'rule_society_alive',
        name: '社会在运转',
        when: { op: 'always' },
        then: [{ kind: 'set_flag', flag: 'society_alive', value: true }],
        once: true,
        priority: 0,
      },
      {
        id: 'rule_notice',
        name: '有人把话传开',
        when: { op: 'always' },
        then: [{ kind: 'set_flag', flag: 'party_invitation_posted', value: true }],
        once: true,
        priority: 1,
      },
    ],
    narrative: {
      flags: {
        society_alive: false,
        party_invitation_posted: false,
        gathering_started: false,
      },
      beats: [],
      quests: [],
    },
    presentation: {
      mode: 'phaser2d',
      cameraFollowPlayer: true,
      tileSize: 32,
      narrativeSeed: 'society-gathering-observe',
      openingRumor: copy.talked.slice(0, 120),
      cinematicEnabled: false,
      genreProfile: profile,
      plannerSource: 'heuristic',
    },
    timeHours: 8,
  });
}

/** Add missing promised places as new regions (never rename town_square). */
export function ensurePromisedRegions(
  world: WorldSpec,
  places: readonly string[],
): WorldSpec {
  if (!places.length) return world;
  let next = world;
  const names = new Set([
    ...next.space.regions.map((r) => r.name),
    ...(next.space.areas ?? []).map((a) => a.name),
  ]);
  const hub =
    next.space.regions.find((r) => r.id === next.space.startRegionId) ??
    next.space.regions[0];
  if (!hub) return next;
  for (const [i, place] of places.entries()) {
    const label = displayPlaceName(place);
    if ([...names].some((n) => coversPromisedPlaceLoose(n, place) || coversPromisedPlaceLoose(n, label))) {
      continue;
    }
    let id = slugForPlace(place, 80 + i);
    if (next.space.regions.some((r) => r.id === id) || isScaffoldTownRegionId(id)) {
      id = `${id}_p${i}`;
    }
    const width = 18;
    const height = 14;
    next = parseWorldSpec({
      ...next,
      space: {
        ...next.space,
        regions: [
          ...next.space.regions,
          {
            id,
            name: label,
            kind: 'interior',
            width,
            height,
            description: placeDescription(label),
            tags: ['promised'],
            layoutAscii: layoutAscii(
              width,
              height,
              isFarmPlaceName(label) ? 'farm' : 'work',
            ),
          },
        ],
        portals: [
          ...next.space.portals,
          {
            id: `portal_${hub.id}_${id}`,
            fromRegionId: hub.id,
            toRegionId: id,
            fromPos: { x: Math.max(1, hub.width - 2), y: Math.floor(hub.height / 2) },
            toPos: { x: 2, y: 7 },
            label,
          },
          {
            id: `portal_${id}_${hub.id}`,
            fromRegionId: id,
            toRegionId: hub.id,
            fromPos: { x: 2, y: 7 },
            toPos: { x: Math.max(1, hub.width - 3), y: Math.floor(hub.height / 2) },
            label: hub.name,
          },
        ],
        areas: [
          ...(next.space.areas ?? []),
          {
            id: `area_${id}`,
            name: label,
            regionId: id,
            objects: [
              {
                id: `obj_${id}_main`,
                name: label,
                state: /[^\x00-\x7F]/.test(label)
                  ? `${label}的脚印还没干`
                  : `footprints still wet at ${label}`,
                tags: [],
              },
            ],
          },
        ],
      },
    });
    names.add(place);
    names.add(label);
  }
  return next;
}

/** Make sure at least one NPC carries each promised job title. */
export function stampPromisedOccupations(
  world: WorldSpec,
  occupations: readonly string[],
): WorldSpec {
  const wanted = occupations.map((o) => o.trim()).filter(Boolean);
  if (!wanted.length) return world;
  const npcs = world.entities.filter((e) => e.kind === 'npc');
  if (!npcs.length) return world;
  const blobOf = (e: (typeof npcs)[number]) =>
    `${e.name} ${e.identity?.occupation ?? ''} ${e.identity?.backstory ?? ''} ${e.attrs['role'] ?? ''}`;
  const missing = wanted.filter(
    (occ) => !npcs.some((e) => coversPromisedOccupation(blobOf(e), occ)),
  );
  if (!missing.length) return world;
  const padded = npcs.filter((e) => (e.tags ?? []).includes('padded'));
  const authored = npcs.filter((e) => !(e.tags ?? []).includes('padded'));
  // Never overwrite a prompt-named resident's job just to satisfy a place-implied title.
  const pool = padded.length ? padded : authored.length ? authored : npcs;
  const patchedIds = new Map<string, string>();
  missing.forEach((occ, i) => {
    const target = pool[i % pool.length]!;
    patchedIds.set(target.id, occ);
  });
  return parseWorldSpec({
    ...world,
    entities: world.entities.map((e) => {
      const occ = patchedIds.get(e.id);
      if (!occ) return e;
      return {
        ...e,
        identity: {
          ...(e.identity ?? {}),
          occupation: occ,
        },
      };
    }),
  });
}

/** Add prompt-named residents the LLM/heuristic omitted. Never rename authored people. */
export function stampPromisedResidents(
  world: WorldSpec,
  residents: readonly ResidentPromise[],
): WorldSpec {
  const wanted = residents.filter((r) => r.name.trim());
  if (!wanted.length) return world;
  const npcs = world.entities.filter((e) => e.kind === 'npc');
  const missing = wanted.filter(
    (r) => !npcs.some((e) => coversPromisedResident(e.name, r.name)),
  );
  if (!missing.length) return world;
  const regions = world.space.regions;
  const hub = regions[0];
  if (!hub) return world;
  const areas = world.space.areas ?? [];
  const workArea = areas.find((a) => a.regionId === hub.id) ?? areas[0];
  const extra = missing.map((who, i) => {
    const id = npcKey(who.name, npcs.length + i);
    const occupation = who.occupation ?? 'resident';
    const card = stanceCardFor(who.name, occupation, npcs.length + i, false);
    return {
      id,
      kind: 'npc' as const,
      name: who.name,
      regionId: hub.id,
      pos: { x: 3 + ((npcs.length + i) % 8), y: 4 + ((npcs.length + i) % 6) },
      personality: occupation,
      dialogueSeed: `${who.name} has something to say.`,
      identity: {
        displayName: who.name,
        age: 24 + ((i * 5) % 30),
        occupation,
        traits: [],
        backstory: `${who.name} was named in the prompt.`,
        homeAreaId: workArea?.id,
        workAreaId: workArea?.id,
        initialRelations: {},
        secret: card.secret,
        stance: card.stance,
      },
      attrs: { role: occupation },
      inventory: [],
      schedule: [
        { hour: 9, regionId: hub.id, activity: occupation },
        { hour: 18, regionId: hub.id, activity: 'gather' },
      ],
      tags: ['authored'],
    };
  });
  return parseWorldSpec({
    ...world,
    entities: [...world.entities, ...extra],
  });
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h;
}

export { TOWN_GENRE_PROFILE };
