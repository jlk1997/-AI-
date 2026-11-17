/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Bridge World Spec JSON → SocietyState seed (identity + areas).
 */

import { createMemoryEntry } from './memory.js';
import { isSocietyRegionId } from './hydrate.js';
import { createSocietyState, type SocietyState } from './tick.js';
import { resolveSocietyPack } from './packs.js';
import {
  gatheringPromiseLine,
  openingRumorFromSpec,
  hubPlaceName,
  worldCopyAscii,
  anonymousLeadName,
} from '@opengame/world-spec';
import {
  anchorKindFromName,
  hashStr,
  type AnchorKind,
  type AnchorMap,
  type SocietyAnchor,
} from './anchors.js';
import {
  hubScore,
  nearestWalkable,
  parseRegionGrid,
  walkableCells,
  walkableRing,
  type Cell,
  type RegionGrid,
} from './grid.js';
import { objectKindFromName } from './objects.js';
import {
  isRumorMemoryText,
  isWhisperMemoryText,
  rumorMemory,
} from './copyLocale.js';
import {
  formatRelationSummary,
  specRelationKind,
} from './relations.js';

export interface SpecLikeEntity {
  readonly id: string;
  readonly kind: string;
  readonly name: string;
  readonly regionId: string;
  readonly pos: { readonly x: number; readonly y: number };
  readonly personality?: string;
  readonly dialogueSeed?: string;
  readonly schedule?: ReadonlyArray<{
    readonly hour: number;
    readonly regionId?: string;
    readonly activity: string;
  }>;
  readonly attrs?: Record<string, string | number | boolean>;
  readonly tags?: readonly string[];
  readonly identity?: {
    readonly displayName?: string;
    readonly age?: number;
    readonly occupation?: string;
    readonly backstory?: string;
    readonly traits?: readonly string[];
    readonly initialRelations?: Readonly<Record<string, string>>;
    readonly homeAreaId?: string;
    readonly workAreaId?: string;
    readonly secret?: string;
    readonly stance?: string;
    readonly withholdFrom?: readonly string[];
    readonly voice?: string;
    readonly emotionNote?: string;
    readonly goals?: ReadonlyArray<{ readonly text: string; readonly progress?: number }>;
  };
}

export interface SpecLikeArea {
  readonly id: string;
  readonly regionId?: string;
  readonly name?: string;
  readonly parentAreaId?: string;
  readonly objects?: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly state: string;
  }>;
}

export interface SpecLikeRegion {
  readonly id: string;
  readonly name?: string;
  readonly kind?: string;
  readonly width?: number;
  readonly height?: number;
  readonly layoutAscii?: string;
}

export interface SpecLikeRelation {
  readonly from: string;
  readonly to: string;
  readonly type?: string;
  readonly strength?: number;
  readonly meta?: Record<string, unknown>;
}

export interface SpecLike {
  readonly meta?: { readonly version?: number };
  readonly timeHours?: number;
  readonly entities: readonly SpecLikeEntity[];
  readonly presentation?: {
    readonly genreProfile?: {
      readonly id?: string;
      readonly hubKind?: 'plaza' | 'mess' | 'bridge' | 'none';
      readonly clock?: { readonly kind?: 'diurnal' | 'watch' | 'event' };
    } | null;
  };
  readonly space?: {
    readonly areas?: readonly SpecLikeArea[];
    readonly regions?: readonly SpecLikeRegion[];
    readonly startRegionId?: string;
    readonly portals?: ReadonlyArray<{
      readonly id: string;
      readonly fromRegionId: string;
      readonly toRegionId: string;
      readonly fromPos: { readonly x: number; readonly y: number };
      readonly toPos: { readonly x: number; readonly y: number };
      readonly label?: string;
    }>;
  };
  readonly relations?: readonly SpecLikeRelation[];
}

/**
 * Which region is the town's gathering place. Planners send the evening social
 * block here, so getting this wrong (e.g. a four-tile café) means the town never
 * assembles. Prefer the declared start region, else the roomiest region that
 * actually has a social anchor.
 */
function pickHubRegion(
  spec: SpecLike,
  anchors: AnchorMap,
): string | undefined {
  const regions = spec.space?.regions ?? [];
  const declared = spec.space?.startRegionId;
  const hubKind = spec.presentation?.genreProfile?.hubKind ?? 'plaza';
  if (hubKind === 'none') return declared ?? regions[0]?.id;
  const social = [...anchors.values()].filter((a) => a.kind === 'social');
  const socialRegions = new Set(social.map((a) => a.regionId));
  if (hubKind === 'bridge' || hubKind === 'mess') {
    return declared ?? regions[0]?.id;
  }
  if (declared && socialRegions.has(declared)) return declared;
  const ranked = regions
    .filter((r) => socialRegions.has(r.id))
    .sort(
      (a, b) =>
        (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0) ||
        a.id.localeCompare(b.id),
    );
  return ranked[0]?.id ?? declared ?? regions[0]?.id;
}

const RELATION_LABEL: Record<string, string> = {
  knows: '认识',
  allies: '交好',
  rivals: '不对付',
  owns: '有往来',
  quest_giver: '有托付',
  custom: '有关系',
};

const RELATION_LABEL_EN: Record<string, string> = {
  knows: 'knows',
  allies: 'allies',
  rivals: 'at odds',
  owns: 'has dealings',
  quest_giver: 'asked a favor',
  custom: 'tied',
};

/**
 * Seed the relationship graph from the Spec. Without this every resident met
 * every other resident as a stranger on day one, so no conversation could refer
 * to shared history and affinity always started from zero.
 */
function seedRelations(
  spec: SpecLike,
  state: SocietyState,
  ascii: boolean,
): void {
  const npcIds = new Set(
    spec.entities.filter((e) => e.kind === 'npc').map((e) => e.id),
  );
  const fallback = ascii ? RELATION_LABEL_EN : RELATION_LABEL;
  for (const rel of spec.relations ?? []) {
    if (!npcIds.has(rel.from) || !npcIds.has(rel.to)) continue;
    const key = [rel.from, rel.to].sort().join('|');
    if (state.relations.has(key)) continue;
    const label =
      (typeof rel.meta?.['label'] === 'string'
        ? String(rel.meta['label'])
        : undefined) ??
      fallback[rel.type ?? 'knows'] ??
      (ascii ? 'knows' : '认识');
    const fromEnt = spec.entities.find((e) => e.id === rel.from);
    const toEnt = spec.entities.find((e) => e.id === rel.to);
    const fromName = fromEnt?.name ?? rel.from;
    const toName = toEnt?.name ?? rel.to;
    const kind = specRelationKind({
      type: rel.type,
      meta: rel.meta,
      sameRegion: fromEnt?.regionId === toEnt?.regionId,
      sameOccupation:
        fromEnt?.identity?.occupation === toEnt?.identity?.occupation &&
        Boolean(fromEnt?.identity?.occupation),
    });
    state.relations.set(key, {
      summary: formatRelationSummary(
        kind,
        ascii
          ? `${fromName} and ${toName}: ${label}`
          : `${fromName} 与 ${toName} ${label}`,
      ),
      affinity: Math.max(-1, Math.min(1, rel.strength ?? 0.3)),
      kind,
    });
  }
  for (const e of spec.entities.filter((ent) => ent.kind === 'npc')) {
    for (const [to, blurb] of Object.entries(
      e.identity?.initialRelations ?? {},
    )) {
      if (!npcIds.has(to) || !blurb) continue;
      const key = [e.id, to].sort().join('|');
      if (state.relations.has(key)) continue;
      const toName =
        spec.entities.find((x) => x.id === to)?.name ?? to;
      state.relations.set(key, {
        summary: formatRelationSummary(
          'acquaintance',
          ascii
            ? `${e.name} and ${toName}: ${blurb}`
            : `${e.name} 与 ${toName}：${blurb}`,
        ),
        affinity: 0.4,
        kind: 'acquaintance',
      });
    }
  }
}

function buildRegionGrids(
  spec: SpecLike,
  bounds: Map<string, { width: number; height: number }>,
): Map<string, RegionGrid> {
  const grids = new Map<string, RegionGrid>();
  for (const r of spec.space?.regions ?? []) {
    const b = bounds.get(r.id) ?? { width: 32, height: 24 };
    grids.set(
      r.id,
      parseRegionGrid({
        width: b.width,
        height: b.height,
        layoutAscii: r.layoutAscii,
      }),
    );
  }
  return grids;
}

/** Farthest-point pick so two areas never land on the same tile. */
function spreadPick(
  candidates: readonly Cell[],
  taken: readonly Cell[],
  seed: string,
): Cell | undefined {
  if (!candidates.length) return undefined;
  if (!taken.length) {
    return candidates[Math.abs(hashStr(seed)) % candidates.length];
  }
  let best: Cell | undefined;
  let bestScore = -Infinity;
  const jitter = Math.abs(hashStr(seed)) % 100;
  for (const c of candidates) {
    let nearest = Infinity;
    for (const t of taken) {
      nearest = Math.min(nearest, Math.hypot(c.x - t.x, c.y - t.y));
    }
    // Jitter breaks ties deterministically instead of always favouring row 1.
    const score = nearest + ((c.x * 7 + c.y * 13 + jitter) % 10) / 100;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

/**
 * Put every area and object on a real walkable tile. Each region also gets a
 * hub anchor keyed by its own id, so `resolveActivityGoal` always has a
 * gathering point even for regions the Spec left without areas.
 */
export function placeAnchors(
  spec: SpecLike,
  grids: Map<string, RegionGrid>,
): AnchorMap {
  const anchors: AnchorMap = new Map();
  const areasByRegion = new Map<string, SpecLikeArea[]>();
  for (const a of spec.space?.areas ?? []) {
    const regionId = a.regionId ?? a.id;
    const list = areasByRegion.get(regionId) ?? [];
    list.push(a);
    areasByRegion.set(regionId, list);
  }

  const regions: SpecLikeRegion[] = [...(spec.space?.regions ?? [])];
  for (const regionId of areasByRegion.keys()) {
    if (!regions.some((r) => r.id === regionId)) regions.push({ id: regionId });
  }

  for (const region of regions) {
    const grid =
      grids.get(region.id) ??
      parseRegionGrid({
        width: region.width ?? 32,
        height: region.height ?? 24,
        layoutAscii: region.layoutAscii,
      });
    const cells = walkableCells(grid);
    const byHub = [...cells].sort((a, b) => hubScore(grid, a) - hubScore(grid, b));
    const taken: Cell[] = [];

    // Region hub first: the plaza-like tile everyone can converge on.
    const hub = byHub[0] ?? { x: 1, y: 1 };
    const regionName = region.name ?? region.id;
    const regionKind = anchorKindFromName(regionName);
    anchors.set(region.id, {
      regionId: region.id,
      x: hub.x,
      y: hub.y,
      name: regionName,
      kind: regionKind === 'other' ? 'social' : regionKind,
    });
    taken.push(hub);

    const areas = [...(areasByRegion.get(region.id) ?? [])].sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    let socialPlaced = false;
    for (const area of areas) {
      const label = area.name ?? area.id;
      const kind: AnchorKind = anchorKindFromName(label);
      let cell: Cell | undefined;
      if (kind === 'social' && !socialPlaced) {
        // The town's social heart belongs on the plaza, not off in a corner.
        cell = byHub.find(
          (c) => !taken.some((t) => t.x === c.x && t.y === c.y),
        );
        socialPlaced = true;
      }
      cell ??= spreadPick(cells, taken, `${region.id}:${area.id}`);
      if (!cell) continue;
      taken.push(cell);
      anchors.set(area.id, {
        regionId: region.id,
        x: cell.x,
        y: cell.y,
        name: label,
        kind,
        parentAreaId: area.parentAreaId,
      });

      const ring = walkableRing(grid, cell, 3);
      let ri = 0;
      for (const obj of area.objects ?? []) {
        const spot =
          ring.find(
            (c, i) => i >= ri && !taken.some((t) => t.x === c.x && t.y === c.y),
          ) ?? cell;
        ri = ring.indexOf(spot) + 1;
        taken.push(spot);
        const objAnchor: SocietyAnchor = {
          regionId: region.id,
          x: spot.x,
          y: spot.y,
          name: obj.name,
          kind: anchorKindFromName(obj.name),
        };
        anchors.set(obj.id, objAnchor);
      }
    }
  }

  return anchors;
}

export function identitySummaryFromEntity(n: SpecLikeEntity): string {
  const parts = [
    n.identity?.displayName,
    n.identity?.occupation,
    n.identity?.backstory,
    n.personality,
    ...(n.identity?.traits ?? []),
    n.dialogueSeed,
  ].filter(Boolean);
  return parts.join('; ') || n.name;
}

function seedLifeFacts(
  entity: SpecLikeEntity,
  name: string,
  hub: string,
  ascii: boolean,
): string[] {
  const facts: string[] = [];
  const backstory = entity.identity?.backstory?.trim() ?? '';
  if (backstory && !/Padded resident/i.test(backstory)) {
    const parts = backstory
      .split(/[。！？；;\n]+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 4);
    facts.push(...parts.slice(0, 3));
  }
  const traits = (entity.identity?.traits ?? []).filter(
    (t) =>
      t &&
      !/^local$/i.test(t) &&
      !/^talkative$/i.test(t) &&
      !/^padded$/i.test(t),
  );
  if (traits.length) {
    facts.push(
      ascii
        ? `${name}'s manner is ${traits.join(', ')}`
        : `${name} 的性子是${traits.join('、')}`,
    );
  }
  for (const blurb of Object.values(entity.identity?.initialRelations ?? {})) {
    if (blurb) {
      facts.push(
        ascii ? `${name} remembers: ${blurb}` : `${name} 记得：${blurb}`,
      );
    }
  }
  const occ = entity.identity?.occupation ?? '';
  const secret = entity.identity?.secret?.trim();
  if (secret && secret.length >= 6 && facts.length < 3) {
    facts.push(
      ascii
        ? `${name} still has not told anyone: ${secret}`
        : `${name} 还没对人说过：${secret}`,
    );
  }
  const stance = entity.identity?.stance?.trim();
  if (stance && facts.length < 3) {
    facts.push(
      ascii ? `${name} holds that ${stance}` : `${name} 认的理是：${stance}`,
    );
  }
  if (occ && facts.length < 3) {
    facts.push(
      ascii
        ? `${name} makes a living as ${occ}; people here know those hands`
        : `${name} 靠${occ}吃饭，这边的人都认得出这双手`,
    );
  }
  const personality = entity.personality?.trim();
  if (personality && facts.length < 3) {
    facts.push(`${name} ${personality}`);
  }
  if (facts.length < 3) {
    for (const extra of hashedLifeFacts(
      name,
      occ || (ascii ? 'craft' : '手艺'),
      entity.id,
      hub,
      ascii,
    )) {
      if (facts.length >= 3) break;
      if (!facts.includes(extra)) facts.push(extra);
    }
  }
  return [...new Set(facts)].slice(0, 4);
}

function hashedLifeFacts(
  name: string,
  occupation: string,
  seed: string,
  hub: string,
  ascii: boolean,
): string[] {
  const n = Math.abs(hashStr(seed)) % 3;
  const sets = ascii
    ? [
        [
          `${name} left a ${occupation} job half-done at ${hub}`,
          `${name} saw the latch at ${hub} undone after midnight`,
          `${name} kept a note under the ${occupation} bench`,
        ],
        [
          `${name} found wet footprints at ${hub} that were not theirs`,
          `${name} shorted a ${occupation} measure once and hopes nobody recounts`,
          `${name} heard two names in a fight at ${hub}`,
        ],
        [
          `${name} hid a key that does not open their door at ${hub}`,
          `${name} still owes a reply from the last ${occupation} watch`,
          `${name} saw tools at ${hub} moved after everyone left`,
        ],
      ]
    : [
        [
          `${name} 在${hub}留着没干完的${occupation}活`,
          `${name} 半夜看见${hub}的门闩没扣上`,
          `${name} 把一张条子压在${occupation}的位子底下`,
        ],
        [
          `${name} 在${hub}看见一串不是自己的湿脚印`,
          `${name} ${occupation}的份量少过一次，怕人再称`,
          `${name} 在${hub}听见两个名字拌过嘴`,
        ],
        [
          `${name} 在${hub}藏着一把对不上自己门的钥匙`,
          `${name} 上一班${occupation}的回话还没写`,
          `${name} 看见${hub}的家伙在人都走后被挪过`,
        ],
      ];
  return sets[n]!;
}

/** Build a society state from a World Spec–like document. */
export function societyStateFromSpec(
  spec: SpecLike,
  options?: { readonly seedText?: string },
): SocietyState {
  const npcs = spec.entities.filter((e) => e.kind === 'npc');
  const objects =
    spec.space?.areas?.flatMap((a) =>
      (a.objects ?? []).map((o) => ({
        id: o.id,
        areaId: a.id,
        regionId: a.regionId ?? a.id,
        areaName: a.name,
        name: o.name,
        state: o.state,
        kind: objectKindFromName(o.name),
      })),
    ) ?? [];

  const regionBounds = new Map<string, { width: number; height: number }>();
  for (const r of spec.space?.regions ?? []) {
    regionBounds.set(r.id, {
      width: r.width ?? 32,
      height: r.height ?? 24,
    });
  }

  const grids = buildRegionGrids(spec, regionBounds);
  const anchors = placeAnchors(spec, grids);

  const pack = resolveSocietyPack(spec);
  const state = createSocietyState({
    seed: (spec.meta?.version ?? 1) * 97 + npcs.length,
    simTime: spec.timeHours ?? 8,
    agents: npcs.map((n) => {
      // Spec authors (and LLM planners) routinely place NPCs inside walls.
      const grid = grids.get(n.regionId);
      const at = grid ? nearestWalkable(grid, n.pos.x, n.pos.y) : n.pos;
      return {
        id: n.id,
        name: n.identity?.displayName ?? n.name,
        identitySummary: identitySummaryFromEntity(n),
        regionId: n.regionId,
        x: at.x,
        y: at.y,
        occupation:
          n.identity?.occupation ??
          (typeof n.attrs?.['role'] === 'string'
            ? String(n.attrs['role'])
            : undefined),
        homeAreaId: n.identity?.homeAreaId,
        workAreaId: n.identity?.workAreaId,
        schedule: n.schedule,
        secret: n.identity?.secret,
        stance: n.identity?.stance,
        withholdFrom: n.identity?.withholdFrom,
        voiceNote: n.identity?.voice,
        emotionNote: n.identity?.emotionNote,
        goalsNote: n.identity?.goals?.map((g) => g.text).join('；'),
        padded: n.tags?.includes('padded'),
      };
    }),
    objects,
    regionBounds,
    regionGrids: grids,
    anchors,
    hubRegionId: pickHubRegion(spec, anchors),
    packId: pack.id,
    clockKind: pack.clockKind,
    copyAscii: worldCopyAscii(spec),
    portals: (spec.space?.portals ?? []).map((p) => ({
      id: p.id,
      fromRegionId: p.fromRegionId,
      toRegionId: p.toRegionId,
      fromPos: { x: p.fromPos.x, y: p.fromPos.y },
      toPos: { x: p.toPos.x, y: p.toPos.y },
      label: p.label,
    })),
  });

  const fallbackRegion =
    state.hubRegionId ?? spec.space?.startRegionId ?? state.agents[0]?.regionId;
  for (const a of state.agents) {
    if (fallbackRegion && !isSocietyRegionId(state, a.regionId)) {
      a.regionId = fallbackRegion;
    }
  }

  seedRelations(spec, state, worldCopyAscii(spec));

  const ascii = worldCopyAscii(spec);
  const hubLabel = hubPlaceName(spec);
  for (const entity of npcs) {
    const a = state.agents.find((x) => x.id === entity.id);
    if (!a) continue;
    // 【身份】 is retrieval-only bookkeeping. 【往事】 is autobiography and may
    // be spoken; the dialogue layer only strips identity / ToM / meet notes.
    state.stream.add(
      createMemoryEntry({
        id: `boot_${a.id}`,
        agentId: a.id,
        kind: 'observation',
        text: `【身份】${a.name}${ascii ? ': ' : '：'}${a.identitySummary}`,
        simTime: state.simTime,
        importance: 5,
      }),
    );
    const known = [...state.relations.entries()]
      .filter(([key]) => key.split('|').includes(a.id))
      .map(([, rel]) => rel.summary);
    if (known.length) {
      state.stream.add(
        createMemoryEntry({
          id: `boot_rel_${a.id}`,
          agentId: a.id,
          kind: 'observation',
          text: `【熟人】${known.join(ascii ? '; ' : '；')}`,
          simTime: state.simTime,
          importance: 4,
        }),
      );
    }
    for (const [i, fact] of seedLifeFacts(
      entity,
      a.name,
      hubLabel,
      ascii,
    ).entries()) {
      state.stream.add(
        createMemoryEntry({
          id: `boot_life_${a.id}_${i}`,
          agentId: a.id,
          kind: 'observation',
          text: `【往事】${fact}`,
          simTime: state.simTime - 24 * (i + 1),
          importance: 6,
        }),
      );
    }
    const homeArea = spec.space?.areas?.find(
      (ar) => ar.id === entity.identity?.homeAreaId,
    );
    const workArea = spec.space?.areas?.find(
      (ar) => ar.id === entity.identity?.workAreaId,
    );
    const placeBits = [
      homeArea?.name
        ? ascii
          ? `home at ${homeArea.name}`
          : `家在${homeArea.name}`
        : '',
      workArea?.name
        ? ascii
          ? `works at ${workArea.name}`
          : `在${workArea.name}做事`
        : '',
    ].filter(Boolean);
    if (placeBits.length) {
      state.stream.add(
        createMemoryEntry({
          id: `boot_place_${a.id}`,
          agentId: a.id,
          kind: 'observation',
          text: `【身份】${placeBits.join(ascii ? '. ' : '、')}`,
          simTime: state.simTime,
          importance: 3,
        }),
      );
    }
  }

  const seedText =
    options?.seedText ??
    openingRumorFromSpec(npcs[0]?.name ?? anonymousLeadName(spec), spec);
  const seeders = [state.agents[0], state.agents[1]].filter(
    (a): a is NonNullable<typeof a> => Boolean(a),
  );
  const messenger = state.agents.find(
    (a) =>
      /跑腿|信使|messenger|皮普|errand|孩/i.test(
        `${a.name} ${a.occupation ?? ''} ${a.identitySummary}`,
      ),
  );
  if (messenger && !seeders.some((s) => s.id === messenger.id)) {
    seeders.push(messenger);
  }
  for (const seeder of seeders) {
    state.stream.add(
      createMemoryEntry({
        id: `seed_rumor_${seeder.id}`,
        agentId: seeder.id,
        kind: 'observation',
        text:
          isRumorMemoryText(seedText) || isWhisperMemoryText(seedText)
            ? seedText
            : rumorMemory(seedText, ascii),
        simTime: state.simTime,
        importance: 9,
      }),
    );
  }
  for (const npc of npcs) {
    const secret = npc.identity?.secret?.trim();
    if (!secret || secret.length < 6) continue;
    const agent = state.agents.find((a) => a.id === npc.id);
    if (!agent) continue;
    if (
      state.stream
        .list(agent.id)
        .some((m) => m.text.includes(secret.slice(0, 16)))
    ) {
      continue;
    }
    state.stream.add(
      createMemoryEntry({
        id: `boot_secret_${agent.id}`,
        agentId: agent.id,
        kind: 'observation',
        text: secret,
        simTime: state.simTime,
        importance: 7,
      }),
    );
  }
  if (seeders.length >= 2) {
    const a = seeders[0]!;
    const b = seeders[1]!;
    const key = [a.id, b.id].sort().join('|');
    const prev = state.relations.get(key);
    if (!prev || prev.kind !== 'family') {
      state.relations.set(key, {
        summary: formatRelationSummary(
          'promise',
          gatheringPromiseLine(a.name, b.name, spec),
        ),
        affinity: Math.max(prev?.affinity ?? 0.35, 0.45),
        kind: 'promise',
      });
    }
  }

  return state;
}
