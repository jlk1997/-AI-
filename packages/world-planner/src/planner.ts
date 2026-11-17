/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  artStyleProfile,
  createDungeonWorld,
  createEmptyTownWorld,
  createForestWorld,
  createSocietyTownWorld,
  isScaffoldTownRegionId,
  parseWorldSpec,
  shortDisplayTitle,
  TOWN_GENRE_PROFILE,
  validateWorldSpec,
  type WorldSpec,
} from '@opengame/world-spec';
import { WorldOpSchema, type WorldOp } from '@opengame/world-ops';

import {
  chatCompletion,
  extractJsonObject,
  resolveChatEnv,
  SocietyLlmKeysExhaustedError,
} from './chat.js';
import {
  parseIntentFromPrompt,
  type IntentPackId,
  type IntentParseOptions,
} from './intent.js';
import { extractPlacePromises, isMostlyAsciiText } from './locale/extractPlaces.js';
import {
  ensurePromisedRegions,
  stampPromisedOccupations,
  stampPromisedResidents,
  stampMissingStanceCards,
  synthesizeSocietyWorld,
} from './synthesize.js';

export {
  coversPromisedPlace,
  coversPromisedPlaceLoose,
  coversPromisedOccupation,
  extractPlacePromises,
} from './locale/extractPlaces.js';
export {
  coversPromisedResident,
  extractResidentPromises,
  type ResidentPromise,
} from './locale/extractResidents.js';
export {
  parseIntentFromPrompt,
  isClassicTownPrompt,
  type IntentIR,
  type IntentPackId,
  type IntentParseOptions,
} from './intent.js';
export {
  synthesizeSocietyWorld,
  ensurePromisedRegions,
  placeLayoutFlavor,
  stampPromisedOccupations,
  stampPromisedResidents,
  stampMissingStanceCards,
} from './synthesize.js';

export type PlannerSource = 'llm' | 'heuristic' | 'heuristic_merged';

export interface PlanWorldResult {
  readonly world: WorldSpec;
  readonly source: PlannerSource;
  readonly rawModelText?: string;
  readonly issues: string[];
}

export interface PlanOpResult {
  readonly op: WorldOp;
  readonly source: 'llm' | 'heuristic';
  readonly issues: string[];
}

export interface PlanOpsResult {
  readonly ops: WorldOp[];
  readonly source: 'llm' | 'heuristic';
  readonly issues: string[];
  /** False when the request looks substantial but only weak/empty ops mapped. */
  readonly understood: boolean;
}

export type WorldArchetype = 'town' | 'dungeon' | 'forest';

/** Pick a full template — dungeon/forest replace the town seed, not append unused regions. */
export function detectWorldArchetype(prompt: string): WorldArchetype {
  const societyFirst =
    /观察|社会|居民日常|不是通关|不是打怪|不是.*RPG|living town|observatory|whisper/i.test(
      prompt,
    );
  if (societyFirst) return 'town';
  if (/castle|城堡|dungeon|地牢|地下城|crypt|墓穴|delve|迷宫/i.test(prompt)) {
    return 'dungeon';
  }
  const forestish = /forest|森林|woods|jungle|丛林|wilderness|密林/i.test(prompt);
  const townish = /town|village|小镇|村庄|smith|铁匠|plaza|广场/i.test(prompt);
  if (forestish && !townish) return 'forest';
  return 'town';
}

function titleFromPrompt(prompt: string): string {
  const titleMatch = prompt.match(
    /(?:world|town|village|dungeon|forest|世界|小镇|地牢|森林)[:：\s]+["']?([^"'.\n]{2,40})/i,
  );
  const raw =
    titleMatch?.[1]?.trim() ||
    prompt.slice(0, 40).replace(/\s+/g, ' ').trim() ||
    'Generated World';
  return shortDisplayTitle(raw, 28);
}

function withPlannerSource(
  world: WorldSpec,
  source: PlannerSource,
): WorldSpec {
  return parseWorldSpec({
    ...world,
    presentation: {
      ...world.presentation,
      plannerSource: source,
    },
  });
}

function intentOpts(options?: {
  readonly worldPopulation?: number;
  readonly packId?: IntentPackId;
  readonly places?: readonly string[];
  readonly useCase?: string;
}): IntentParseOptions {
  return {
    ...(options?.worldPopulation != null
      ? { populationHint: options.worldPopulation }
      : {}),
    ...(options?.packId ? { packId: options.packId } : {}),
    ...(options?.places?.length ? { places: options.places } : {}),
  };
}

function stampCreateBrief(
  world: WorldSpec,
  options?: {
    readonly packId?: IntentPackId;
    readonly places?: readonly string[];
    readonly useCase?: string;
    readonly scale?: string;
    readonly livedIn?: string;
    readonly note?: string;
  },
): WorldSpec {
  if (
    !options?.packId &&
    !options?.places?.length &&
    !options?.useCase &&
    !options?.scale &&
    !options?.livedIn &&
    !options?.note
  ) {
    return world;
  }
  return parseWorldSpec({
    ...world,
    presentation: {
      ...world.presentation,
      worldBrief: {
        ...(options?.packId ? { packId: options.packId } : {}),
        ...(options?.useCase ? { useCase: options.useCase } : {}),
        ...(options?.places?.length ? { venues: [...options.places] } : {}),
        ...(options?.scale ? { scale: options.scale } : {}),
        ...(options?.livedIn ? { livedIn: options.livedIn } : {}),
        ...(options?.note ? { note: options.note.slice(0, 200) } : {}),
      },
    },
  });
}

function heuristicWorldFromPrompt(
  prompt: string,
  options?: {
    readonly artStyleId?: string;
    readonly worldPopulation?: number;
    readonly packId?: IntentPackId;
    readonly places?: readonly string[];
    readonly useCase?: string;
    readonly scale?: string;
    readonly livedIn?: string;
    readonly note?: string;
  },
): WorldSpec {
  const title = titleFromPrompt(prompt);
  const archetype = detectWorldArchetype(prompt);
  const wantRpg =
    /\b(胜负|通关|打怪|战斗循环|win\/?lose|combat loop|boss|raid|野狼|ore quest)\b/i.test(
      prompt,
    );
  const ir = parseIntentFromPrompt(prompt, intentOpts(options));
  const style = options?.artStyleId ? { artStyleId: options.artStyleId } : {};
  let world: WorldSpec;
  if (archetype === 'dungeon') {
    world = createDungeonWorld({ title, ...style });
  } else if (wantRpg && archetype === 'forest') {
    world = createForestWorld({ title, ...style });
  } else if (wantRpg) {
    world = createEmptyTownWorld({ title, ...style });
  } else if (ir.classicTown) {
    world = createSocietyTownWorld({ title, ...style });
    world = parseWorldSpec({
      ...world,
      presentation: {
        ...world.presentation,
        genreProfile: world.presentation.genreProfile ?? TOWN_GENRE_PROFILE,
      },
    });
  } else {
    world = synthesizeSocietyWorld({ title, prompt, ir, ...style });
  }

  if (/traitor|叛徒|betray/i.test(prompt)) {
    const smith =
      world.entities.find((e) => e.id === 'npc_smith') ??
      world.entities.find((e) => e.kind === 'npc');
    if (smith) {
      smith.name = `${smith.name}（叛徒）`;
      smith.personality = '表面上张罗聚会，心里在盘算怎么利用周围的人';
      smith.dialogueSeed = '今晚的聚会……有些话不能当众说。';
    }
  }

  world.meta.summary = shortDisplayTitle(prompt, 240);
  return stampCreateBrief(withPlannerSource(world, 'heuristic'), options);
}

/**
 * Soft-repair common LLM Spec issues so we do not discard the whole draft.
 */
function softenLlmWorld(obj: Record<string, unknown>): Record<string, unknown> {
  const next = { ...obj };
  const meta = {
    ...((next['meta'] as Record<string, unknown>) ?? {}),
  };
  if (!meta['id']) meta['id'] = `world_${Date.now().toString(36)}`;
  if (!meta['version']) meta['version'] = 1;
  if (typeof meta['title'] === 'string') {
    meta['title'] = shortDisplayTitle(String(meta['title']), 40);
  }
  next['meta'] = meta;
  if (!next['presentation']) {
    next['presentation'] = { mode: 'phaser2d', tileSize: 32 };
  }
  if (next['timeHours'] === undefined) next['timeHours'] = 8;

  const space = {
    ...((next['space'] as Record<string, unknown>) ?? {}),
  };
  const regions = Array.isArray(space['regions'])
    ? (space['regions'] as Array<Record<string, unknown>>)
    : [];
  const regionIds = new Set(
    regions
      .map((r) => (typeof r['id'] === 'string' ? r['id'] : ''))
      .filter(Boolean),
  );
  if (regions.length && typeof space['startRegionId'] === 'string') {
    if (!regionIds.has(space['startRegionId'] as string)) {
      space['startRegionId'] = regions[0]!['id'];
    }
  } else if (regions.length) {
    space['startRegionId'] = regions[0]!['id'];
  }
  const startId = space['startRegionId'] as string | undefined;

  if (Array.isArray(space['portals'])) {
    space['portals'] = (space['portals'] as Array<Record<string, unknown>>).filter(
      (p) =>
        regionIds.has(String(p['fromRegionId'] ?? '')) &&
        regionIds.has(String(p['toRegionId'] ?? '')),
    );
  }
  next['space'] = space;

  if (Array.isArray(next['entities']) && startId) {
    next['entities'] = (next['entities'] as Array<Record<string, unknown>>).map(
      (e) => {
        if (!regionIds.has(String(e['regionId'] ?? ''))) {
          return { ...e, regionId: startId };
        }
        return e;
      },
    );
  }
  return next;
}

function stampIntentProfile(
  world: WorldSpec,
  prompt: string,
  populationHint?: number,
  extras?: Pick<IntentParseOptions, 'packId' | 'places'>,
): WorldSpec {
  const ir = parseIntentFromPrompt(prompt, {
    ...(populationHint != null ? { populationHint } : {}),
    ...extras,
  });
  const currentId = world.presentation.genreProfile?.id;
  const currentPop = world.presentation.genreProfile?.population;
  const popChanged =
    ir.populationHint != null &&
    (currentPop?.min !== ir.profile.population.min ||
      currentPop?.max !== ir.profile.population.max);
  if (ir.classicTown) {
    if (currentId && !popChanged) return world;
  } else if (currentId === ir.packId && !popChanged) {
    return world;
  }
  return parseWorldSpec({
    ...world,
    presentation: {
      ...world.presentation,
      genreProfile: ir.profile,
    },
  });
}

/** LLM Spec that reused Stanford-town ids is not a custom world — resynthesize. */
function adoptSocietySpec(
  prompt: string,
  world: WorldSpec,
  populationHint?: number,
  extras?: Pick<IntentParseOptions, 'packId' | 'places'>,
): WorldSpec {
  if (detectWorldArchetype(prompt) === 'dungeon') return world;
  const ir = parseIntentFromPrompt(prompt, {
    ...(populationHint != null ? { populationHint } : {}),
    ...extras,
  });
  if (ir.classicTown) {
    return stampIntentProfile(
      fulfillSocietyPromises(world, prompt, { populationHint, ...extras }),
      prompt,
      populationHint,
      extras,
    );
  }
  const usedScaffold = world.space.regions.some((r) =>
    isScaffoldTownRegionId(r.id),
  );
  if (usedScaffold) {
    return synthesizeSocietyWorld({
      title: world.meta.title || titleFromPrompt(prompt),
      prompt,
      ir,
    });
  }
  return stampIntentProfile(
    fulfillSocietyPromises(world, prompt, { populationHint, ...extras }),
    prompt,
    populationHint,
    extras,
  );
}

/** Stamp promised places and jobs onto any Spec (LLM or heuristic) before the gate. */
export function fulfillSocietyPromises(
  world: WorldSpec,
  prompt: string,
  options?: IntentParseOptions,
): WorldSpec {
  const ir = parseIntentFromPrompt(prompt, options);
  const placed = ensurePromisedRegions(world, ir.places);
  return stampMissingStanceCards(
    stampPromisedResidents(
      stampPromisedOccupations(placed, ir.occupations),
      ir.residents,
    ),
  );
}

/**
 * Overlay LLM title/style onto a synthesized world when validation still fails.
 * Never merge back onto createSocietyTownWorld.
 */
export function mergeHeuristicWithLlmHints(
  prompt: string,
  rawObj: Record<string, unknown>,
  issues: string[],
  picked?: {
    readonly artStyleId?: string;
    readonly worldPopulation?: number;
    readonly packId?: IntentPackId;
    readonly places?: readonly string[];
    readonly useCase?: string;
    readonly scale?: string;
    readonly livedIn?: string;
    readonly note?: string;
  },
): PlanWorldResult {
  const base = heuristicWorldFromPrompt(prompt, picked);
  const meta = rawObj['meta'] as Record<string, unknown> | undefined;
  if (meta && typeof meta['title'] === 'string' && meta['title'].trim()) {
    base.meta.title = shortDisplayTitle(String(meta['title']), 40);
  }
  if (meta && typeof meta['summary'] === 'string' && meta['summary'].trim()) {
    base.meta.summary = String(meta['summary']).slice(0, 240);
  }
  const style = rawObj['styleAnchor'] as Record<string, unknown> | undefined;
  if (style) {
    // A picked style is not a suggestion — only take the model's technique when
    // the user did not choose one.
    if (!picked?.artStyleId && typeof style['artStyle'] === 'string') {
      base.styleAnchor.artStyle = String(style['artStyle']).slice(0, 80);
    }
    if (typeof style['mood'] === 'string') {
      base.styleAnchor.mood = String(style['mood']).slice(0, 80);
    }
    if (Array.isArray(style['palette'])) {
      const palette = style['palette']
        .filter((c): c is string => typeof c === 'string')
        .slice(0, 6);
      if (palette.length) base.styleAnchor.palette = palette;
    }
  }
  const space = rawObj['space'] as Record<string, unknown> | undefined;
  if (space && typeof space['startRegionId'] === 'string') {
    const sid = space['startRegionId'];
    if (base.space.regions.some((r) => r.id === sid)) {
      base.space.startRegionId = sid;
      const player = base.entities.find((e) => e.kind === 'player');
      if (player) player.regionId = sid;
    }
  }
  const llmAreas = Array.isArray(space?.['areas'])
    ? (space!['areas'] as Array<Record<string, unknown>>)
    : [];
  const llmPlaceNames = llmAreas
    .map((a) => (typeof a['name'] === 'string' ? String(a['name']).trim() : ''))
    .filter((n) => n.length >= 2 && n.length <= 12 && /[\u4e00-\u9fff]/.test(n))
    .slice(0, 5);
  const mergedPlaces = [
    ...(picked?.places?.length ? picked.places : extractPlacePromises(prompt)),
    ...llmPlaceNames,
  ];
  const ir = parseIntentFromPrompt(prompt, intentOpts(picked));
  const topology = ir.classicTown
    ? base
    : ensurePromisedRegions(base, mergedPlaces);
  const flavored = fulfillSocietyPromises(topology, prompt, intentOpts(picked));
  const world = withPlannerSource(parseWorldSpec(flavored), 'heuristic_merged');
  return {
    world,
    source: 'heuristic_merged',
    issues: [
      ...issues.slice(0, 8),
      'LLM Spec invalid — synthesized topology from prompt places (title/style overlaid)',
    ],
  };
}

const WORLD_SYSTEM = `You are a World Spec planner for a persistent generative-agent society (observe/intervene, not a one-shot mini-game).
Return ONLY a JSON object matching this shape:
{
  "meta": { "id": string, "title": string (short, ≤40 chars), "version": 1, "summary": string },
  "styleAnchor": { "artStyle": string, "palette": string[], "mood": string },
  "space": {
    "regions": [{ "id", "name", "kind": "town"|"dungeon"|"wilderness"|"interior"|"arena"|"other", "width", "height", "description", "layoutAscii?" }],
    "portals": [{ "id", "fromRegionId", "toRegionId", "fromPos": {"x","y"}, "toPos": {"x","y"} }],
    "startRegionId": string,
    "startPos": {"x","y"},
    "areas": [{ "id", "regionId", "name", "objects": [{ "id", "name", "state" }] }]
  },
  "entities": [{ "id", "kind": "player"|"npc"|"item"|"prop"|"enemy"|"trigger", "name", "regionId", "pos", "attrs", "inventory", "personality?", "dialogueSeed?", "schedule?", "spriteKey?", "identity?": { "displayName", "age", "occupation", "traits": string[], "backstory" } }],
  "relations": [{ "id", "from", "to", "type", "strength" }],
  "rules": [{ "id", "when": Condition, "then": [Effect], "once": boolean, "priority": number }],
  "narrative": { "quests": [...], "beats": [...], "flags": {} },
  "presentation": { "mode": "phaser2d", "tileSize": 32, "openingRumor?": "one concrete who/what/where sentence", "genreProfile?": { "id": "society.town"|"society.crew"|"society.cloister", "clock": { "kind": "diurnal"|"watch"|"event" }, "population": { "min", "max" }, "topology": { "minRegions", "maxRegions" }, "hubKind": "plaza"|"mess"|"bridge"|"none" } },
  "timeHours": 8
}
Condition ops: always | flag | attr | has_item | in_region | quest_status | and | or | not
Effect kinds: set_flag | set_attr | give_item | remove_item | move_entity | start_quest | complete_quest | fail_quest | emit | advance_time
Rules:
- Exactly one entity with kind "player"
- All regionIds / portal endpoints must exist
- Region ids MUST be unique slugs derived from the prompt's places (dock, boat_yard, net_yard, kiln…). NEVER emit town_square, market_row, school_yard, home_row, inn_lane unless the user asked for 城镇广场/斯坦福小镇
- Region names are the place names themselves (码头, 船坞) — not "码头一带"
- NPC count: if the prompt names a headcount (至少 N 名 / about N people), emit exactly that many named NPCs — do not expand compact towns to the pack default. Pack defaults only when unspecified: society.town 18–25; society.crew 6–14; society.cloister 8–18. Stamp presentation.genreProfile.population.min/max to that headcount.
- NPC names, occupations, and backstories MUST match the prompt language (Chinese prompt → Chinese prose; English prompt → English prose). Never emit filler like "Padded resident"
- Each NPC has a unique name, occupation bound to a place, 2–3 distinct traits, and a backstory of at least 3 autobiographical facts
- Each NPC identity must include homeAreaId and workAreaId pointing at space.areas ids; add relations of type located_in (meta.role home|work)
- Seed relations so every NPC has at least one knows/allies/rivals edge with another named resident
- Default to an observable society: gossip/seed event, notice-board objects, NPC relations — NOT win/lose quests or combat enemies unless the user explicitly asks for an RPG/combat loop
- Emit presentation.openingRumor: one concrete sentence (who / what / where). Never "{name} is hosting a gathering" or "{name} 正在广场组织一场聚会"
- At least one notice-board or worked object whose state is a fact (not idle / 闲着 / 刚有人来过)
- Secrets must differ across NPCs; at least two stances should disagree about the opening rumor
- quests and enemies are OPTIONAL; leave narrative.quests empty for society-first worlds
- Include space.areas with parentAreaId nested rooms (building → room → object) and mutable object state strings
- Pull 3–6 distinctive places from the user prompt into region ids AND names
- Dungeon RPG only if they ask for boss/raid/打怪; otherwise living society with prompt topology
- Make the world a living society — NPCs have schedules and gossip, not a linear VN script
- Include a short styleAnchor (artStyle + palette) for art coupling
- spriteKey may be a single emoji for 2D presenter icons`;

export async function planWorldFromPrompt(
  prompt: string,
  options?: {
    readonly signal?: AbortSignal;
    readonly forceHeuristic?: boolean;
    /** Art style the user picked; overrides whatever the model suggests. */
    readonly artStyleId?: string;
    /** Named-resident target; overrides prompt-parsed population. */
    readonly worldPopulation?: number;
    readonly packId?: IntentPackId;
    readonly places?: readonly string[];
    readonly useCase?: string;
    readonly scale?: string;
    readonly livedIn?: string;
    readonly note?: string;
  },
): Promise<PlanWorldResult> {
  const style = options?.artStyleId
    ? { artStyleId: options.artStyleId }
    : undefined;
  const population =
    options?.worldPopulation != null
      ? { worldPopulation: options.worldPopulation }
      : {};
  const brief = {
    ...(options?.packId ? { packId: options.packId } : {}),
    ...(options?.places?.length ? { places: options.places } : {}),
    ...(options?.useCase ? { useCase: options.useCase } : {}),
    ...(options?.scale ? { scale: options.scale } : {}),
    ...(options?.livedIn ? { livedIn: options.livedIn } : {}),
    ...(options?.note ? { note: options.note.slice(0, 200) } : {}),
  };
  if (options?.forceHeuristic || process.env['WORLD_PLANNER_HEURISTIC'] === 'true') {
    return {
      world: heuristicWorldFromPrompt(prompt, { ...style, ...population, ...brief }),
      source: 'heuristic',
      issues: [],
    };
  }

  const env = resolveChatEnv();
  if (!env) {
    return {
      world: heuristicWorldFromPrompt(prompt, { ...style, ...population, ...brief }),
      source: 'heuristic',
      issues: ['No LLM API key — used heuristic planner'],
    };
  }

  const ir = parseIntentFromPrompt(prompt, intentOpts(options));
  const locale = isMostlyAsciiText(prompt) ? 'en' : 'zh';
  const archetype = detectWorldArchetype(prompt);
  const populationLine =
    ir.populationHint != null
      ? ` Named residents: exactly ${ir.populationHint}. Set presentation.genreProfile.population to {min:${ir.populationHint},max:${ir.populationHint}}. Do not expand to the pack default range.`
      : '';

  try {
    const raw = await chatCompletion({
      ...env,
      messages: [
        { role: 'system', content: WORLD_SYSTEM },
        {
          role: 'user',
          content: `Create a World Spec for:\n${prompt}\n\nDetected pack: ${ir.packId}. Locale: ${locale}. Archetype hint: ${archetype}.${populationLine} Region ids must come from the prompt's places (never town_square/home_row unless they asked for 城镇广场). Dungeon hall only if they asked for a combat dungeon. Keep meta.title short (≤28 chars). Names and prose in ${locale === 'en' ? 'English' : 'Chinese'}.`,
        },
      ],
      temperature: 0.5,
      maxTokens: 8192,
      jsonMode: true,
      signal: options?.signal,
    });
    const parsed = extractJsonObject(raw);
    const softened = softenLlmWorld(parsed as Record<string, unknown>);

    const validated = validateWorldSpec(softened);
    if (!validated.ok || !validated.world) {
      const issues = validated.issues.map((i) => `${i.path}: ${i.message}`);
      const merged = mergeHeuristicWithLlmHints(prompt, softened, issues, {
        ...style,
        ...population,
        ...brief,
      });
      return {
        ...merged,
        rawModelText: raw.slice(0, 2000),
      };
    }
    return {
      world: stampCreateBrief(
        withPlannerSource(
          applyPickedArtStyle(
            adoptSocietySpec(
              prompt,
              validated.world,
              options?.worldPopulation,
              brief,
            ),
            options?.artStyleId,
          ),
          'llm',
        ),
        brief,
      ),
      source: 'llm',
      rawModelText: raw.slice(0, 2000),
      issues: [],
    };
  } catch (err) {
    if (err instanceof SocietyLlmKeysExhaustedError) throw err;
    return {
      world: heuristicWorldFromPrompt(prompt, { ...style, ...population, ...brief }),
      source: 'heuristic',
      issues: [err instanceof Error ? err.message : String(err)],
    };
  }
}

/**
 * The picker is the user's decision, so it wins over the planner's suggestion.
 * The model may still contribute mood and palette — those read as flavour, not
 * as the rendering technique.
 */
export function applyPickedArtStyle(
  world: WorldSpec,
  artStyleId?: string,
): WorldSpec {
  if (!artStyleId) return world;
  const profile = artStyleProfile(artStyleId);
  return parseWorldSpec({
    ...world,
    styleAnchor: {
      ...world.styleAnchor,
      artStyle: profile.artStyle,
      artStyleId: profile.id,
      palette: world.styleAnchor.palette?.length
        ? world.styleAnchor.palette
        : [...profile.palette],
    },
  });
}

const OP_SYSTEM = `You convert a natural-language world edit into ONE JSON WorldOp.
Allowed ops:
{ "op":"expand_region", "region": { id, name, kind, width, height, description? } }
{ "op":"add_region", "region": { id, name, kind, width, height, description? } }
{ "op":"edit_entity", "entityId": string, "patch": { name?, personality?, dialogueSeed?, attrs?, ... } }
{ "op":"add_entity", "entity": { ... } }
{ "op":"remove_entity", "entityId": string }
{ "op":"add_quest", "quest": { id, title, description?, giverEntityId?, status?, steps?, onComplete? } }
{ "op":"edit_dialogue", "entityId": string, "dialogueSeed": string }
{ "op":"set_flag", "flag": string, "value": boolean }
{ "op":"set_fact", "fact": string, "value": string|number|boolean }
{ "op":"reshape_layout", "regionId": string, "layoutAscii": string }
{ "op":"edit_region", "regionId": string, "patch": { name?, description?, ... } }
{ "op":"set_genre_profile", "profile": { id, clock, population, topology, hubKind, verbs? } }
{ "op":"set_clock", "clock": { "kind":"diurnal"|"watch"|"event", hoursPerDay?, shifts? } }
Prefer add_region when the user asks to add a reachable place (portals to the hub). Prefer expand_region for wilderness append. Prefer add_quest when the user asks for a quest/任务; prefer edit_dialogue for 台词/对话/三句.
Return ONLY the JSON object.`;

const OPS_SYSTEM = `You convert a natural-language world edit into 1–5 JSON WorldOps.
Return ONLY: { "ops": [ WorldOp, ... ] } with at most 5 ops.
Allowed ops:
{ "op":"expand_region", "region": { id, name, kind, width, height, description? } }
{ "op":"add_region", "region": { id, name, kind, width, height, description? } }
{ "op":"edit_entity", "entityId": string, "patch": { name?, personality?, dialogueSeed?, attrs?, ... } }
{ "op":"add_entity", "entity": { ... } }
{ "op":"remove_entity", "entityId": string }
{ "op":"add_quest", "quest": { id, title, description?, giverEntityId?, status?, steps?, onComplete? } }
{ "op":"edit_dialogue", "entityId": string, "dialogueSeed": string }
{ "op":"set_flag", "flag": string, "value": boolean }
{ "op":"set_fact", "fact": string, "value": string|number|boolean }
{ "op":"reshape_layout", "regionId": string, "layoutAscii": string }
{ "op":"edit_region", "regionId": string, "patch": { name?, description?, ... } }
{ "op":"set_genre_profile", "profile": { id, clock, population, topology, hubKind, verbs? } }
{ "op":"set_clock", "clock": { "kind":"diurnal"|"watch"|"event", hoursPerDay?, shifts? } }
Prefer add_region for a reachable new place (hub portals). Prefer expand_region for wilderness. Prefer concrete expand/edit/add/add_quest/edit_dialogue ops. Do NOT use set_flag as a catch-all when the user asked for world content changes.
If you cannot map the request to real ops, return { "ops": [] }.`;

function regionNameFromEditPrompt(prompt: string): string {
  const zh = prompt.match(/加(?:一个|一座)?\s*([^。\n]{2,16}?)\s*(?:区域|场所)/);
  const zhName = zh?.[1]?.trim();
  if (zhName && !/^(一个|一座)$/.test(zhName)) return zhName;
  const en = prompt.match(
    /add (?:a |an |the )?([^.\n]{2,24}?)(?:\s+region|\s+place)\b/i,
  );
  const enName = en?.[1]?.trim();
  if (enName && !/^(a|an|the)$/i.test(enName)) return enName;
  if (/forest|森林/i.test(prompt)) {
    return isMostlyAsciiText(prompt) ? 'Woods' : '密林';
  }
  return isMostlyAsciiText(prompt) ? 'New place' : '新场所';
}

function heuristicOpFromPrompt(prompt: string): WorldOp {
  if (/任务|quest|支线/i.test(prompt)) {
    return {
      op: 'add_quest',
      quest: {
        id: `q_${Date.now().toString(36)}`,
        title: /铁匠|smith/i.test(prompt) ? 'Smith favor' : 'Town favor',
        description: prompt.slice(0, 160),
        giverEntityId: /铁匠|smith/i.test(prompt) ? 'npc_smith' : 'npc_guide',
        status: 'available',
        steps: [],
        onComplete: [],
      },
    };
  }
  if (/台词|对话|三句|dialogue|tell|speak/i.test(prompt)) {
    const entityId = /铁匠|smith/i.test(prompt)
      ? 'npc_smith'
      : /向导|guide/i.test(prompt)
        ? 'npc_guide'
        : 'npc_smith';
    return {
      op: 'edit_dialogue',
      entityId,
      dialogueSeed: prompt.slice(0, 240) || 'A new line of dialogue.',
    };
  }
  if (/traitor|叛徒/i.test(prompt) && /smith|铁匠/i.test(prompt)) {
    return {
      op: 'edit_entity',
      entityId: 'npc_smith',
      patch: {
        name: '铁砧（叛徒）',
        personality: '表面上张罗聚会，心里另有盘算',
        dialogueSeed: '今晚的聚会……有些话不能当众说。',
      },
    };
  }
  if (/genre.?profile|类型包|set_genre/i.test(prompt)) {
    return {
      op: 'set_genre_profile',
      profile: parseIntentFromPrompt(prompt).profile,
    };
  }
  if (/add.?region|加(?:一个)?[^。\n]{0,12}?(区域|场所)|新场所/i.test(prompt)) {
    return {
      op: 'add_region',
      region: {
        id: `region_${Date.now().toString(36)}`,
        name: regionNameFromEditPrompt(prompt),
        kind: 'interior',
        width: 18,
        height: 14,
        description: prompt.slice(0, 120),
        tags: [],
      },
    };
  }
  if (/set_clock|值班钟|作息钟/i.test(prompt)) {
    return {
      op: 'set_clock',
      clock: /值班|班次|watch/i.test(prompt)
        ? { kind: 'watch', shifts: 3 }
        : { kind: 'diurnal', hoursPerDay: 24 },
    };
  }
  if (/expand|forest|森林|扩/i.test(prompt)) {
    return {
      op: 'expand_region',
      region: {
        id: `region_${Date.now().toString(36)}`,
        name: '新边地',
        kind: 'wilderness',
        width: 18,
        height: 14,
        description: prompt.slice(0, 120),
        tags: [],
      },
    };
  }
  return { op: 'set_flag', flag: 'edited', value: true };
}

function looksLikeSubstantialEdit(prompt: string): boolean {
  const p = prompt.trim();
  if (p.length < 6) return false;
  return /扩|加|改|换|删|森林|区域|npc|敌人|布局|任务|quest|对话|台词|expand|add|edit|remove|forest|region|boss|quest|叛徒|dialogue/i.test(
    p,
  );
}

function isWeakEditedFlag(ops: WorldOp[]): boolean {
  return (
    ops.length === 1 &&
    ops[0]!.op === 'set_flag' &&
    ops[0]!.flag === 'edited'
  );
}

function heuristicOpsFromPrompt(prompt: string): WorldOp[] {
  const ops: WorldOp[] = [];
  if (/任务|quest|支线/i.test(prompt)) {
    ops.push({
      op: 'add_quest',
      quest: {
        id: `q_${Date.now().toString(36)}`,
        title: /铁匠|smith/i.test(prompt) ? 'Smith favor' : 'Town favor',
        description: prompt.slice(0, 160),
        giverEntityId: /铁匠|smith/i.test(prompt) ? 'npc_smith' : 'npc_guide',
        status: 'available',
        steps: [],
        onComplete: [],
      },
    });
  }
  if (/台词|对话|三句|dialogue/i.test(prompt)) {
    ops.push({
      op: 'edit_dialogue',
      entityId: /铁匠|smith/i.test(prompt) ? 'npc_smith' : 'npc_guide',
      dialogueSeed: prompt.slice(0, 240) || 'A new line of dialogue.',
    });
  }
  if (/traitor|叛徒/i.test(prompt) && /smith|铁匠/i.test(prompt)) {
    ops.push({
      op: 'edit_entity',
      entityId: 'npc_smith',
      patch: {
        name: '铁砧（叛徒）',
        personality: '表面上张罗聚会，心里另有盘算',
        dialogueSeed: '今晚的聚会……有些话不能当众说。',
      },
    });
  }
  if (/genre.?profile|类型包|set_genre/i.test(prompt)) {
    ops.push({
      op: 'set_genre_profile',
      profile: parseIntentFromPrompt(prompt).profile,
    });
  }
  if (/set_clock|值班钟|作息钟/i.test(prompt) && ops.length < 5) {
    ops.push({
      op: 'set_clock',
      clock: /值班|班次|watch/i.test(prompt)
        ? { kind: 'watch', shifts: 3 }
        : { kind: 'diurnal', hoursPerDay: 24 },
    });
  }
  if (/add.?region|加(?:一个)?[^。\n]{0,12}?(区域|场所)|新场所/i.test(prompt) && ops.length < 5) {
    ops.push({
      op: 'add_region',
      region: {
        id: `region_${Date.now().toString(36)}`,
        name: regionNameFromEditPrompt(prompt),
        kind: 'interior',
        width: 18,
        height: 14,
        description: prompt.slice(0, 120),
        tags: [],
      },
    });
  } else if (/expand|forest|森林|扩/i.test(prompt)) {
    ops.push({
      op: 'expand_region',
      region: {
        id: `region_${Date.now().toString(36)}`,
        name: /forest|森林/i.test(prompt) ? '密林' : '新边地',
        kind: 'wilderness',
        width: 18,
        height: 14,
        description: prompt.slice(0, 120),
        tags: [],
      },
    });
  }
  if (/npc|商人|村民|add\s*(an?\s*)?(npc|merchant)/i.test(prompt) && ops.length < 5) {
    ops.push({
      op: 'add_entity',
      entity: {
        id: `npc_${Date.now().toString(36)}`,
        kind: 'npc',
        name: 'New Settler',
        regionId: '_hub_',
        pos: { x: 4, y: 4 },
        attrs: {},
        inventory: [],
        tags: [],
        schedule: [],
        personality: 'friendly newcomer',
        dialogueSeed: 'The frontier needs hands.',
      },
    });
  }
  return ops;
}

export async function planWorldOp(
  prompt: string,
  worldSummary: string,
  options?: { readonly signal?: AbortSignal },
): Promise<PlanOpResult> {
  const env = resolveChatEnv();
  if (!env || process.env['WORLD_PLANNER_HEURISTIC'] === 'true') {
    return { op: heuristicOpFromPrompt(prompt), source: 'heuristic', issues: [] };
  }
  try {
    const raw = await chatCompletion({
      ...env,
      messages: [
        { role: 'system', content: OP_SYSTEM },
        {
          role: 'user',
          content: `Current world:\n${worldSummary}\n\nEdit request:\n${prompt}`,
        },
      ],
      temperature: 0.2,
      maxTokens: 1500,
      jsonMode: true,
      signal: options?.signal,
    });
    const parsed = WorldOpSchema.safeParse(extractJsonObject(raw));
    if (!parsed.success) {
      return {
        op: heuristicOpFromPrompt(prompt),
        source: 'heuristic',
        issues: parsed.error.issues.map((i) => i.message),
      };
    }
    return { op: parsed.data, source: 'llm', issues: [] };
  } catch (err) {
    return {
      op: heuristicOpFromPrompt(prompt),
      source: 'heuristic',
      issues: [err instanceof Error ? err.message : String(err)],
    };
  }
}

/**
 * Bounded multi-Op planner (2–5 when complex). Refuses weak set_flag catch-alls
 * when the user clearly asked for content changes.
 */
export async function planWorldOps(
  prompt: string,
  worldSummary: string,
  options?: { readonly signal?: AbortSignal; readonly maxOps?: number },
): Promise<PlanOpsResult> {
  const maxOps = Math.min(5, Math.max(1, options?.maxOps ?? 5));
  const env = resolveChatEnv();
  const finish = (
    ops: WorldOp[],
    source: 'llm' | 'heuristic',
    issues: string[],
  ): PlanOpsResult => {
    let clipped = ops.slice(0, maxOps);
    // Substantial edits: try to pad to ≥2 concrete ops when only one expand landed
    if (
      looksLikeSubstantialEdit(prompt) &&
      clipped.length === 1 &&
      (clipped[0]!.op === 'expand_region' || clipped[0]!.op === 'add_region') &&
      /npc|商人|叛徒|smith|铁匠|quest|任务/i.test(prompt)
    ) {
      const extra = heuristicOpsFromPrompt(prompt).filter(
        (o) => o.op !== clipped[0]!.op,
      );
      clipped = [...clipped, ...extra].slice(0, maxOps);
    }
    const weak =
      clipped.length === 0 ||
      (isWeakEditedFlag(clipped) && looksLikeSubstantialEdit(prompt));
    return {
      ops: weak && looksLikeSubstantialEdit(prompt) ? [] : clipped,
      source,
      issues: weak
        ? [...issues, 'ununderstood_world_edit']
        : issues,
      understood: !weak,
    };
  };

  if (!env || process.env['WORLD_PLANNER_HEURISTIC'] === 'true') {
    const heur = heuristicOpsFromPrompt(prompt);
    if (heur.length) return finish(heur, 'heuristic', []);
    return finish([heuristicOpFromPrompt(prompt)], 'heuristic', []);
  }

  try {
    const raw = await chatCompletion({
      ...env,
      messages: [
        { role: 'system', content: OPS_SYSTEM },
        {
          role: 'user',
          content: `Current world:\n${worldSummary}\n\nEdit request (return 1–${maxOps} ops):\n${prompt}`,
        },
      ],
      temperature: 0.2,
      maxTokens: 2500,
      jsonMode: true,
      signal: options?.signal,
    });
    const obj = extractJsonObject(raw) as { ops?: unknown };
    const list = Array.isArray(obj?.ops)
      ? obj.ops
      : Array.isArray(obj)
        ? obj
        : [obj];
    const ops: WorldOp[] = [];
    const issues: string[] = [];
    for (const item of list.slice(0, maxOps)) {
      const parsed = WorldOpSchema.safeParse(item);
      if (parsed.success) ops.push(parsed.data);
      else issues.push(...parsed.error.issues.map((i) => i.message));
    }
    if (ops.length) return finish(ops, 'llm', issues);
    const heur = heuristicOpsFromPrompt(prompt);
    if (heur.length) return finish(heur, 'heuristic', issues);
    return finish([], 'heuristic', [...issues, 'empty_ops']);
  } catch (err) {
    const heur = heuristicOpsFromPrompt(prompt);
    const msg = err instanceof Error ? err.message : String(err);
    if (heur.length) return finish(heur, 'heuristic', [msg]);
    return finish([], 'heuristic', [msg]);
  }
}

export { heuristicWorldFromPrompt, detectWorldArchetype as detectArchetype };
