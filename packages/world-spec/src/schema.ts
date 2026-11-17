/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';
import {
  artStyleProfile,
  DEFAULT_ART_STYLE_ID,
  type ArtStyleProfile,
} from './artStyle.js';
import {
  GenreProfileSchema,
  TOWN_GENRE_PROFILE,
  resolveGenreProfile,
  worldCopyAscii,
} from './genreProfile.js';

export {
  CLOISTER_GENRE_PROFILE,
  CREW_GENRE_PROFILE,
  GenreClockSchema,
  GenreProfileSchema,
  SCAFFOLD_TOWN_REGION_IDS,
  TOWN_GENRE_PROFILE,
  evaluateEmergenceGate,
  evaluateSocietySeedGate,
  societySeedUsedFallback,
  societySeedSoftEnabled,
  anonymousLeadName,
  formatWorldClock,
  gatheringInvitationText,
  gatheringPromiseLine,
  gatheringSeedText,
  openingRumorFromSpec,
  isConcreteWorldCue,
  isGenericGatheringLine,
  clampNamedResidentCount,
  maxNamedResidents,
  genreProfileById,
  genreProfileWithPopulation,
  hubPlaceName,
  worldBriefOf,
  worldCopyAscii,
  isScaffoldTownRegionId,
  resolveGenreProfile,
  type GenreClock,
  type GenreProfile,
  type WorldBriefLike,
  type WorldLike,
} from './genreProfile.js';

const DEFAULT_ART_STYLE: ArtStyleProfile = artStyleProfile(
  DEFAULT_ART_STYLE_ID,
);

/**
 * Style anchor for the scaffold worlds. Each scaffold keeps its own hand-picked
 * palette and mood, but only while the caller has not chosen a style: once
 * someone picks neon noir, a cozy green palette is the wrong answer.
 */
function scaffoldStyleAnchor(input: {
  readonly artStyleId?: string;
  /** Subject flavour appended to the technique, e.g. `'underground dungeon'`. */
  readonly flavour?: string;
  readonly palette: readonly string[];
  readonly mood: string;
}): {
  artStyle: string;
  artStyleId: string;
  palette: string[];
  mood: string;
} {
  const chosen = Boolean(input.artStyleId);
  const profile = artStyleProfile(input.artStyleId ?? DEFAULT_ART_STYLE_ID);
  return {
    artStyle: input.flavour
      ? `${profile.artStyle}, ${input.flavour}`
      : profile.artStyle,
    artStyleId: profile.id,
    palette: chosen ? [...profile.palette] : [...input.palette],
    mood: chosen ? profile.mood : input.mood,
  };
}

export const Vec2Schema = z.object({
  x: z.number(),
  y: z.number(),
});

export const StyleAnchorSchema = z.object({
  /**
   * Free text handed to the image models. Defaults to high fidelity — the old
   * `'pixel'` default is why worlds nobody asked for came out 8-bit.
   */
  artStyle: z.string().default(DEFAULT_ART_STYLE.artStyle),
  /**
   * The picked {@link ArtStyleId}. Optional so pre-picker specs still parse;
   * when absent, consumers sniff {@link artStyle} via `resolveArtStyle`.
   */
  artStyleId: z.string().optional(),
  palette: z.array(z.string()).default([]),
  mood: z.string().optional(),
  referenceNotes: z.string().optional(),
});

export const RegionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z
    .enum(['town', 'dungeon', 'wilderness', 'interior', 'arena', 'other'])
    .default('town'),
  width: z.number().int().positive().default(32),
  height: z.number().int().positive().default(24),
  tileKey: z.string().optional(),
  backgroundKey: z.string().optional(),
  description: z.string().optional(),
  layoutAscii: z.string().optional(),
  tags: z.array(z.string()).default([]),
});

export const PortalSchema = z.object({
  id: z.string().min(1),
  fromRegionId: z.string().min(1),
  toRegionId: z.string().min(1),
  fromPos: Vec2Schema,
  toPos: Vec2Schema,
  label: z.string().optional(),
});

export const EntityScheduleEntrySchema = z.object({
  hour: z.number().int().min(0).max(23),
  regionId: z.string(),
  activity: z.string(),
});

/** Generative-agent identity (Smallville-style). Optional for backward compat. */
export const AgentIdentitySchema = z.object({
  displayName: z.string().optional(),
  age: z.number().int().positive().optional(),
  traits: z.array(z.string()).default([]),
  occupation: z.string().optional(),
  backstory: z.string().optional(),
  /** Own dwelling in the area tree. */
  homeAreaId: z.string().optional(),
  /** Workplace / shop the resident reports to. */
  workAreaId: z.string().optional(),
  /** Map of otherEntityId → relationship blurb */
  initialRelations: z.record(z.string()).default({}),
  /** A fact this resident will not volunteer. Tick-only; never overwritten live. */
  secret: z.string().max(160).optional(),
  /** Public-enough opinion that can conflict with a neighbor's. */
  stance: z.string().max(160).optional(),
  /** Agent ids / names this resident will not pass gossip to. */
  withholdFrom: z.array(z.string()).default([]),
  /** Optional inner life. Absent on older towns. */
  values: z.array(z.string()).optional(),
  goals: z
    .array(
      z.object({
        text: z.string(),
        progress: z.number().min(0).max(1).optional(),
      }),
    )
    .optional(),
  fears: z.array(z.string()).optional(),
  voice: z.string().max(160).optional(),
  emotionNote: z.string().max(80).optional(),
  grievance: z.number().min(0).max(1).optional(),
  legitimacy: z.number().min(0).max(1).optional(),
  efficacy: z.number().min(0).max(1).optional(),
  riskTolerance: z.number().min(0).max(1).optional(),
  identityGroup: z.string().max(40).optional(),
});

export const EntitySchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['player', 'npc', 'item', 'prop', 'enemy', 'trigger']),
  name: z.string().min(1),
  regionId: z.string().min(1),
  pos: Vec2Schema.default({ x: 1, y: 1 }),
  attrs: z.record(z.union([z.string(), z.number(), z.boolean()])).default({}),
  inventory: z.array(z.string()).default([]),
  personality: z.string().optional(),
  dialogueSeed: z.string().optional(),
  schedule: z.array(EntityScheduleEntrySchema).default([]),
  spriteKey: z.string().optional(),
  tags: z.array(z.string()).default([]),
  identity: AgentIdentitySchema.optional(),
});

/** Region → sub-area → object tree for agent perception. */
export const WorldObjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Mutable state string, e.g. "stove: on" */
  state: z.string().default('idle'),
  tags: z.array(z.string()).default([]),
});

export const WorldAreaSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  regionId: z.string().min(1),
  parentAreaId: z.string().optional(),
  description: z.string().optional(),
  objects: z.array(WorldObjectSchema).default([]),
});

export const RelationSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  type: z.enum([
    'knows',
    'allies',
    'rivals',
    'owns',
    'located_in',
    'quest_giver',
    'custom',
  ]),
  strength: z.number().min(-1).max(1).default(0),
  meta: z.record(z.unknown()).optional(),
});

/** Flat condition atom — compound ops use `all` / `any` / `not` string refs or nested objects. */
export type Condition =
  | { op: 'always' }
  | { op: 'flag'; flag: string; equals?: boolean }
  | {
      op: 'attr';
      entityId: string;
      key: string;
      equals: string | number | boolean;
    }
  | { op: 'has_item'; entityId: string; itemId: string }
  | { op: 'in_region'; entityId: string; regionId: string }
  | { op: 'quest_status'; questId: string; status: string }
  | { op: 'and'; all: Condition[] }
  | { op: 'or'; any: Condition[] }
  | { op: 'not'; not: Condition };

export const ConditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.object({ op: z.literal('always') }),
    z.object({
      op: z.literal('flag'),
      flag: z.string(),
      equals: z.boolean().optional(),
    }),
    z.object({
      op: z.literal('attr'),
      entityId: z.string(),
      key: z.string(),
      equals: z.union([z.string(), z.number(), z.boolean()]),
    }),
    z.object({
      op: z.literal('has_item'),
      entityId: z.string(),
      itemId: z.string(),
    }),
    z.object({
      op: z.literal('in_region'),
      entityId: z.string(),
      regionId: z.string(),
    }),
    z.object({
      op: z.literal('quest_status'),
      questId: z.string(),
      status: z.string(),
    }),
    z.object({ op: z.literal('and'), all: z.array(ConditionSchema) }),
    z.object({ op: z.literal('or'), any: z.array(ConditionSchema) }),
    z.object({ op: z.literal('not'), not: ConditionSchema }),
  ]),
);

export const EffectSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('set_flag'),
    flag: z.string(),
    value: z.boolean(),
  }),
  z.object({
    kind: z.literal('set_attr'),
    entityId: z.string(),
    key: z.string(),
    value: z.union([z.string(), z.number(), z.boolean()]),
  }),
  z.object({
    kind: z.literal('give_item'),
    entityId: z.string(),
    itemId: z.string(),
  }),
  z.object({
    kind: z.literal('remove_item'),
    entityId: z.string(),
    itemId: z.string(),
  }),
  z.object({
    kind: z.literal('move_entity'),
    entityId: z.string(),
    regionId: z.string(),
    pos: Vec2Schema.optional(),
  }),
  z.object({ kind: z.literal('start_quest'), questId: z.string() }),
  z.object({ kind: z.literal('complete_quest'), questId: z.string() }),
  z.object({ kind: z.literal('fail_quest'), questId: z.string() }),
  z.object({
    kind: z.literal('emit'),
    event: z.string(),
    payload: z.record(z.unknown()).optional(),
  }),
  z.object({ kind: z.literal('advance_time'), hours: z.number().positive() }),
]);

export type Effect = z.infer<typeof EffectSchema>;

export const RuleSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  when: ConditionSchema,
  then: z.array(EffectSchema).min(1),
  once: z.boolean().default(false),
  priority: z.number().int().default(0),
});

export const QuestStepSchema = z.object({
  id: z.string().min(1),
  description: z.string(),
  when: ConditionSchema.default({ op: 'always' }),
  then: z.array(EffectSchema).default([]),
});

export const QuestSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().default(''),
  giverEntityId: z.string().optional(),
  status: z
    .enum(['locked', 'available', 'active', 'completed', 'failed'])
    .default('available'),
  steps: z.array(QuestStepSchema).default([]),
  onComplete: z.array(EffectSchema).default([]),
});

export const NarrativeBeatSchema = z.object({
  id: z.string().min(1),
  text: z.string(),
  when: ConditionSchema.default({ op: 'always' }),
});

export const NarrativeSchema = z.object({
  quests: z.array(QuestSchema).default([]),
  beats: z.array(NarrativeBeatSchema).default([]),
  flags: z.record(z.boolean()).default({}),
});

export const SpatialAssetRefSchema = z.object({
  backend: z.string().optional(),
  assetUrl: z.string().optional(),
  videoUrl: z.string().optional(),
  prompt: z.string().optional(),
  licenseNote: z.string().optional(),
});

export const AgenticDiffSchema = z.object({
  beforeRegions: z.number().int().nonnegative(),
  afterRegions: z.number().int().nonnegative(),
  beforeQuests: z.number().int().nonnegative(),
  afterQuests: z.number().int().nonnegative(),
  beforeRules: z.number().int().nonnegative(),
  afterRules: z.number().int().nonnegative(),
  opsApplied: z.number().int().nonnegative(),
});

export const PresentationSchema = z.object({
  mode: z.enum(['phaser2d', 'three3d']).default('phaser2d'),
  cameraFollowPlayer: z.boolean().default(true),
  /**
   * On-screen tile size in CSS pixels. 48 rather than the old 32 because the
   * canvas base is now 1280x720 — keeping 32 would have shown more tiles at the
   * same tiny scale instead of drawing the same view larger.
   */
  tileSize: z.number().int().positive().default(48),
  /**
   * Source frame size of `tileset.png`. Decoupled from {@link tileSize} so a
   * high-fidelity style can ship 128px tiles and let the GPU downscale them —
   * the two used to be the same number, which capped texture detail at the
   * display size.
   */
  tileSourceSize: z.number().int().positive().optional(),
  spatialBackend: z.string().optional(),
  /** When true, Phaser title/explore may play region cinematic video. */
  cinematicEnabled: z.boolean().default(false),
  /** Per-region spatial / video assets from L3 backends (LingBot, Three, …). */
  spatialAssets: z.record(SpatialAssetRefSchema).default({}),
  /** How the Spec was produced — surfaced in worker logs / World panel. */
  plannerSource: z.enum(['llm', 'heuristic', 'heuristic_merged']).optional(),
  /** L3 LingBot session mode hint for Phaser CinematicLayer (mock|real). */
  lingbotMode: z.enum(['mock', 'real']).optional(),
  /** L2 Pilot/Director expansion metrics — product-visible world-model gain. */
  agenticDiff: AgenticDiffSchema.optional(),
  /**
   * Difficulty knobs derived from the L2 neural model (enemy speed, hp scale,
   * …). Consumed by `compileWorldToGameSeed` so the neural pass changes actual
   * gameplay instead of only logging.
   */
  difficultyTunables: z.record(z.number()).optional(),
  /** Provenance for `difficultyTunables`, e.g. `l2-hybrid-world-model`. */
  difficultyTunablesSource: z.string().optional(),
  /** Shared narrative seed for game↔world coupling. */
  narrativeSeed: z.string().optional(),
  /** One concrete opening rumor (who / what / where) — not a gathering verb. */
  openingRumor: z.string().min(4).max(120).optional(),
  /** Living-society pack. Missing = society.town (old worlds keep working). */
  genreProfile: GenreProfileSchema.optional(),
  /**
   * Structured create brief. Seed rumor, hub copy, and the generate strip
   * read this — it is not just a prompt leftover.
   */
  worldBrief: z
    .object({
      packId: z
        .enum(['society.town', 'society.crew', 'society.cloister'])
        .optional(),
      useCase: z.string().min(1).optional(),
      venues: z.array(z.string().min(1)).max(8).optional(),
      scale: z.string().min(1).optional(),
      livedIn: z.string().min(1).optional(),
      note: z.string().min(1).max(200).optional(),
    })
    .optional(),
  /**
   * Resolved art style knobs baked in for the Phaser scaffold, which cannot
   * import this package. Absent on pre-picker worlds — the scaffold then sniffs
   * {@link StyleAnchorSchema.artStyle}.
   */
  artStyleId: z.string().optional(),
  /** Drives Phaser `pixelArt` / `roundPixels` and nearest-neighbour scaling. */
  pixelPerfect: z.boolean().optional(),
  /**
   * Speech pacing overrides. These were read by the scaffold but not declared
   * here, so `parseWorldSpec` stripped them and the override never applied.
   */
  speechStaggerMs: z.number().int().positive().optional(),
  maxLiveSpeech: z.number().int().positive().optional(),
});

/** Short UI / title-screen label — never paste a full user prompt. */
export function shortDisplayTitle(raw: string, maxChars = 28): string {
  const t = raw.replace(/\s+/g, ' ').trim();
  if (!t) return 'World';
  if (t.length <= maxChars) return t;
  return `${t.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

export const WorldMetaSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  seed: z.string().optional(),
  version: z.number().int().positive().default(1),
  createdAt: z.string().optional(),
  summary: z.string().optional(),
});

export const SpaceSchema = z.object({
  regions: z.array(RegionSchema).min(1),
  portals: z.array(PortalSchema).default([]),
  startRegionId: z.string().min(1),
  startPos: Vec2Schema.default({ x: 2, y: 2 }),
  /** Optional area/object tree for generative agents. */
  areas: z.array(WorldAreaSchema).default([]),
});

export const WorldSpecSchema = z.object({
  meta: WorldMetaSchema,
  styleAnchor: StyleAnchorSchema.default({}),
  space: SpaceSchema,
  entities: z.array(EntitySchema).default([]),
  relations: z.array(RelationSchema).default([]),
  rules: z.array(RuleSchema).default([]),
  narrative: NarrativeSchema.default({}),
  presentation: PresentationSchema.default({}),
  timeHours: z.number().nonnegative().default(8),
});

export type Vec2 = z.infer<typeof Vec2Schema>;
export type StyleAnchor = z.infer<typeof StyleAnchorSchema>;
export type Region = z.infer<typeof RegionSchema>;
export type Portal = z.infer<typeof PortalSchema>;
export type Entity = z.infer<typeof EntitySchema>;
export type AgentIdentity = z.infer<typeof AgentIdentitySchema>;
export type WorldObject = z.infer<typeof WorldObjectSchema>;
export type WorldArea = z.infer<typeof WorldAreaSchema>;
export type Relation = z.infer<typeof RelationSchema>;
export type Rule = z.infer<typeof RuleSchema>;
export type Quest = z.infer<typeof QuestSchema>;
export type Narrative = z.infer<typeof NarrativeSchema>;
export type Presentation = z.infer<typeof PresentationSchema>;
export type SpatialAssetRef = z.infer<typeof SpatialAssetRefSchema>;
export type WorldMeta = z.infer<typeof WorldMetaSchema>;
export type WorldSpec = z.infer<typeof WorldSpecSchema>;

export interface WorldValidationIssue {
  readonly path: string;
  readonly message: string;
}

export interface WorldValidationResult {
  readonly ok: boolean;
  readonly world?: WorldSpec;
  readonly issues: WorldValidationIssue[];
}

export function validateWorldSpec(input: unknown): WorldValidationResult {
  const parsed = WorldSpecSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join('.') || '(root)',
        message: i.message,
      })),
    };
  }
  const world = parsed.data;
  const issues: WorldValidationIssue[] = [];
  const regionIds = new Set(world.space.regions.map((r) => r.id));
  if (!regionIds.has(world.space.startRegionId)) {
    issues.push({
      path: 'space.startRegionId',
      message: `startRegionId "${world.space.startRegionId}" not in regions`,
    });
  }
  for (const e of world.entities) {
    if (!regionIds.has(e.regionId)) {
      issues.push({
        path: `entities.${e.id}.regionId`,
        message: `region "${e.regionId}" missing`,
      });
    }
  }
  for (const p of world.space.portals) {
    if (!regionIds.has(p.fromRegionId) || !regionIds.has(p.toRegionId)) {
      issues.push({
        path: `space.portals.${p.id}`,
        message: 'portal references unknown region',
      });
    }
  }
  const entityIds = new Set(world.entities.map((e) => e.id));
  const areaIds = new Set((world.space.areas ?? []).map((a) => a.id));
  for (const r of world.relations) {
    if (!entityIds.has(r.from)) {
      issues.push({
        path: `relations.${r.id}`,
        message: 'relation references unknown entity',
      });
      continue;
    }
    if (r.type === 'located_in') {
      if (!areaIds.has(r.to) && !entityIds.has(r.to)) {
        issues.push({
          path: `relations.${r.id}`,
          message: 'located_in target is not an area or entity',
        });
      }
      continue;
    }
    if (!entityIds.has(r.to)) {
      issues.push({
        path: `relations.${r.id}`,
        message: 'relation references unknown entity',
      });
    }
  }
  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return { ok: true, world, issues: [] };
}

export function parseWorldSpec(input: unknown): WorldSpec {
  const result = validateWorldSpec(input);
  if (!result.ok || !result.world) {
    const msg = result.issues.map((i) => `${i.path}: ${i.message}`).join('; ');
    throw new Error(`Invalid World Spec: ${msg}`);
  }
  return result.world;
}

export function summarizeWorldSpec(world: WorldSpec, maxChars = 2000): string {
  const lines = [
    `World: ${world.meta.title} (v${world.meta.version})`,
    world.meta.summary ? `Summary: ${world.meta.summary}` : '',
    world.presentation.openingRumor
      ? `Opening: ${world.presentation.openingRumor}`
      : '',
    `Time: ${world.timeHours}h | Mode: ${world.presentation.mode}`,
    `Regions: ${world.space.regions.map((r) => r.id).join(', ')}`,
    `Entities: ${world.entities.map((e) => `${e.id}(${e.kind}/${e.regionId})`).join(', ')}`,
    `Quests: ${world.narrative.quests.map((q) => `${q.id}:${q.status}`).join(', ') || '(none)'}`,
    `Flags: ${JSON.stringify(world.narrative.flags)}`,
    `Rules: ${world.rules.length}`,
  ].filter(Boolean);
  return lines.join('\n').slice(0, maxChars);
}

/** Compact before/after Spec delta for revision history + product UI. */
export function diffWorldSpecs(
  before: WorldSpec,
  after: WorldSpec,
): {
  readonly regionsBefore: number;
  readonly regionsAfter: number;
  readonly questsBefore: number;
  readonly questsAfter: number;
  readonly entitiesBefore: number;
  readonly entitiesAfter: number;
  readonly rulesBefore: number;
  readonly rulesAfter: number;
  readonly addedRegions: string[];
  readonly removedRegions: string[];
  readonly addedQuests: string[];
  readonly removedQuests: string[];
  readonly addedEntities: string[];
  readonly removedEntities: string[];
  readonly addedRules: string[];
  readonly removedRules: string[];
  readonly summaryLines: string[];
} {
  const beforeRegionIds = new Set(before.space.regions.map((r) => r.id));
  const afterRegionIds = new Set(after.space.regions.map((r) => r.id));
  const beforeQuestIds = new Set(before.narrative.quests.map((q) => q.id));
  const afterQuestIds = new Set(after.narrative.quests.map((q) => q.id));
  const beforeEntityIds = new Set(before.entities.map((e) => e.id));
  const afterEntityIds = new Set(after.entities.map((e) => e.id));
  const beforeRuleIds = new Set(before.rules.map((r) => r.id));
  const afterRuleIds = new Set(after.rules.map((r) => r.id));
  const addedRegions = [...afterRegionIds].filter((id) => !beforeRegionIds.has(id));
  const removedRegions = [...beforeRegionIds].filter((id) => !afterRegionIds.has(id));
  const addedQuests = [...afterQuestIds].filter((id) => !beforeQuestIds.has(id));
  const removedQuests = [...beforeQuestIds].filter((id) => !afterQuestIds.has(id));
  const addedEntities = [...afterEntityIds].filter((id) => !beforeEntityIds.has(id));
  const removedEntities = [...beforeEntityIds].filter((id) => !afterEntityIds.has(id));
  const addedRules = [...afterRuleIds].filter((id) => !beforeRuleIds.has(id));
  const removedRules = [...beforeRuleIds].filter((id) => !afterRuleIds.has(id));
  const summaryLines = [
    `regions ${before.space.regions.length}→${after.space.regions.length}`,
    `quests ${before.narrative.quests.length}→${after.narrative.quests.length}`,
    `entities ${before.entities.length}→${after.entities.length}`,
    `rules ${before.rules.length}→${after.rules.length}`,
  ];
  if (addedRegions.length) {
    summaryLines.push(`+regions: ${addedRegions.slice(0, 6).join(', ')}`);
  }
  if (removedRegions.length) {
    summaryLines.push(`-regions: ${removedRegions.slice(0, 6).join(', ')}`);
  }
  if (addedQuests.length) {
    summaryLines.push(`+quests: ${addedQuests.slice(0, 6).join(', ')}`);
  }
  if (removedQuests.length) {
    summaryLines.push(`-quests: ${removedQuests.slice(0, 6).join(', ')}`);
  }
  if (addedEntities.length) {
    summaryLines.push(`+entities: ${addedEntities.slice(0, 6).join(', ')}`);
  }
  if (removedEntities.length) {
    summaryLines.push(`-entities: ${removedEntities.slice(0, 6).join(', ')}`);
  }
  if (addedRules.length) {
    summaryLines.push(`+rules: ${addedRules.slice(0, 6).join(', ')}`);
  }
  if (removedRules.length) {
    summaryLines.push(`-rules: ${removedRules.slice(0, 6).join(', ')}`);
  }
  return {
    regionsBefore: before.space.regions.length,
    regionsAfter: after.space.regions.length,
    questsBefore: before.narrative.quests.length,
    questsAfter: after.narrative.quests.length,
    entitiesBefore: before.entities.length,
    entitiesAfter: after.entities.length,
    rulesBefore: before.rules.length,
    rulesAfter: after.rules.length,
    addedRegions,
    removedRegions,
    addedQuests,
    removedQuests,
    addedEntities,
    removedEntities,
    addedRules,
    removedRules,
    summaryLines,
  };
}

export function createEmptyTownWorld(options?: {
  readonly title?: string;
  readonly id?: string;
  readonly artStyleId?: string;
}): WorldSpec {
  const id = options?.id ?? `world_${Date.now().toString(36)}`;
  return parseWorldSpec({
    meta: {
      id,
      title: options?.title ?? 'New Town',
      version: 1,
      summary: 'Explore the square, gather ore, aid the smith — and survive the woods.',
    },
    styleAnchor: scaffoldStyleAnchor({
      ...(options?.artStyleId ? { artStyleId: options.artStyleId } : {}),
      palette: ['#2d6a4f', '#d8f3dc', '#f4a261'],
      mood: 'cozy adventure',
    }),
    space: {
      regions: [
        {
          id: 'town_square',
          name: 'Town Square',
          kind: 'town',
          width: 24,
          height: 18,
          description: 'Central plaza with a fountain and forge.',
          layoutAscii: [
            '########################',
            '#......................#',
            '#......................#',
            '#......................#',
            '#......................#',
            '#......................#',
            '#......................#',
            '#......................#',
            '#......................#',
            '#......................#',
            '#......................#',
            '#......................#',
            '#......................#',
            '#......................#',
            '#......................#',
            '#......................#',
            '#......................#',
            '########################',
          ].join('\n'),
        },
        {
          id: 'forest',
          name: 'Whisper Forest',
          kind: 'wilderness',
          width: 18,
          height: 14,
          description: 'Misty woods beyond the east gate.',
          tags: ['forest', 'danger'],
        },
        {
          id: 'mine',
          name: 'Ash Mine',
          kind: 'dungeon',
          width: 16,
          height: 12,
          description: 'Collapsed tunnels with richer ore — and worse things.',
          tags: ['mine', 'danger'],
        },
      ],
      portals: [
        {
          id: 'portal_town_forest',
          fromRegionId: 'town_square',
          toRegionId: 'forest',
          fromPos: { x: 22, y: 8 },
          toPos: { x: 1, y: 7 },
          label: 'Forest',
        },
        {
          id: 'portal_forest_town',
          fromRegionId: 'forest',
          toRegionId: 'town_square',
          fromPos: { x: 1, y: 7 },
          toPos: { x: 21, y: 8 },
          label: 'Town',
        },
        {
          id: 'portal_forest_mine',
          fromRegionId: 'forest',
          toRegionId: 'mine',
          fromPos: { x: 16, y: 7 },
          toPos: { x: 1, y: 6 },
          label: 'Mine',
        },
        {
          id: 'portal_mine_forest',
          fromRegionId: 'mine',
          toRegionId: 'forest',
          fromPos: { x: 1, y: 6 },
          toPos: { x: 15, y: 7 },
          label: 'Forest',
        },
      ],
      startRegionId: 'town_square',
      startPos: { x: 4, y: 4 },
      areas: [
        {
          id: 'area_square',
          regionId: 'town_square',
          name: 'Fountain Plaza',
          objects: [
            { id: 'obj_fountain', name: 'Fountain', state: 'flowing' },
            { id: 'obj_forge', name: 'Forge', state: 'embers low' },
            { id: 'obj_notice', name: 'Notice board', state: 'party invitation posted' },
          ],
        },
        {
          id: 'area_forest_edge',
          regionId: 'forest',
          name: 'Forest Edge',
          objects: [
            { id: 'obj_campfire', name: 'Campfire', state: 'cold ashes' },
          ],
        },
      ],
    },
    entities: [
      {
        id: 'player',
        kind: 'player',
        name: 'Traveler',
        regionId: 'town_square',
        pos: { x: 4, y: 4 },
        attrs: { hp: 12, atk: 3 },
        inventory: [],
        spriteKey: '🚶',
      },
      {
        id: 'npc_smith',
        kind: 'npc',
        name: 'Ironforge',
        regionId: 'town_square',
        pos: { x: 10, y: 6 },
        personality: 'gruff but kind blacksmith',
        dialogueSeed: 'Bring me iron ore — then prove yourself against the Ash Wolf.',
        identity: {
          displayName: 'Ironforge',
          age: 54,
          occupation: 'blacksmith',
          traits: ['gruff', 'loyal', 'secretive'],
          backstory: 'Runs the town forge; knows every rumor that passes the anvil.',
        },
        attrs: { role: 'blacksmith' },
        inventory: [],
        spriteKey: '🔨',
        schedule: [
          { hour: 8, regionId: 'town_square', activity: 'smithing' },
          { hour: 17, regionId: 'town_square', activity: 'socializes in the square' },
        ],
      },
      {
        id: 'npc_scout',
        kind: 'npc',
        name: 'Lira the Scout',
        regionId: 'town_square',
        pos: { x: 6, y: 12 },
        personality: 'wary pathfinder',
        dialogueSeed: 'The mine east of the woods holds better ore — and worse beasts.',
        identity: {
          displayName: 'Lira',
          age: 28,
          occupation: 'scout',
          traits: ['wary', 'curious', 'brave'],
          backstory: 'Maps the Whisper Forest; first to hear of gatherings and threats.',
        },
        attrs: { role: 'scout' },
        inventory: [],
        spriteKey: '🧭',
        schedule: [
          { hour: 9, regionId: 'town_square', activity: 'briefing travelers' },
          { hour: 14, regionId: 'forest', activity: 'scouting trails' },
        ],
      },
      {
        id: 'npc_innkeep',
        kind: 'npc',
        name: 'Mara',
        regionId: 'town_square',
        pos: { x: 14, y: 8 },
        personality: 'warm gossip',
        dialogueSeed: 'Stay for stew — and tell me what you heard on the road.',
        identity: {
          displayName: 'Mara',
          age: 41,
          occupation: 'innkeeper',
          traits: ['warm', 'gossipy', 'observant'],
          backstory: 'Owns the square tavern; information hub of the town.',
        },
        attrs: { role: 'innkeeper' },
        inventory: [],
        spriteKey: '🍲',
        schedule: [
          { hour: 10, regionId: 'town_square', activity: 'serving patrons' },
          { hour: 18, regionId: 'town_square', activity: 'evening gathering' },
        ],
      },
      {
        id: 'item_ore',
        kind: 'item',
        name: 'Iron Ore',
        regionId: 'town_square',
        pos: { x: 16, y: 10 },
        attrs: { itemId: 'iron_ore' },
        inventory: [],
        tags: ['quest'],
        spriteKey: '🪨',
      },
      {
        id: 'item_rich_ore',
        kind: 'item',
        name: 'Rich Ore',
        regionId: 'mine',
        pos: { x: 10, y: 6 },
        attrs: { itemId: 'rich_ore' },
        inventory: [],
        tags: ['quest'],
        spriteKey: '💎',
      },
      {
        id: 'enemy_wolf',
        kind: 'enemy',
        name: 'Ash Wolf',
        regionId: 'forest',
        pos: { x: 10, y: 7 },
        attrs: { hp: 8, atk: 2 },
        inventory: ['wolf_fang'],
        dialogueSeed: 'Grrrr!',
        spriteKey: '🐺',
      },
      {
        id: 'enemy_bat',
        kind: 'enemy',
        name: 'Cave Bat',
        regionId: 'mine',
        pos: { x: 8, y: 5 },
        attrs: { hp: 5, atk: 1 },
        inventory: [],
        spriteKey: '🦇',
      },
    ],
    relations: [
      {
        id: 'rel_player_smith',
        from: 'player',
        to: 'npc_smith',
        type: 'knows',
        strength: 0.2,
      },
      {
        id: 'rel_player_scout',
        from: 'player',
        to: 'npc_scout',
        type: 'knows',
        strength: 0.1,
      },
    ],
    rules: [
      {
        id: 'rule_talk_smith_starts_quest',
        name: 'Talking to smith starts ore quest',
        when: {
          op: 'and',
          all: [
            { op: 'flag', flag: 'talked_npc_smith', equals: true },
            { op: 'quest_status', questId: 'q_fetch_ore', status: 'locked' },
          ],
        },
        then: [
          { kind: 'set_flag', flag: 'met_smith', value: true },
          { kind: 'start_quest', questId: 'q_fetch_ore' },
        ],
        once: true,
        priority: 10,
      },
      {
        id: 'rule_ore_done_starts_wolf',
        name: 'After ore delivery, smith asks for wolf fang',
        when: {
          op: 'and',
          all: [
            { op: 'flag', flag: 'smith_helped', equals: true },
            { op: 'quest_status', questId: 'q_wolf_fang', status: 'locked' },
          ],
        },
        then: [{ kind: 'start_quest', questId: 'q_wolf_fang' }],
        once: true,
        priority: 9,
      },
      {
        id: 'rule_wolf_bonus',
        name: 'Defeating wolf marks courage',
        when: { op: 'flag', flag: 'defeated_enemy_wolf', equals: true },
        then: [{ kind: 'set_flag', flag: 'forest_cleared', value: true }],
        once: true,
        priority: 5,
      },
      {
        id: 'rule_player_down_fails',
        name: 'Low HP marks crisis',
        when: {
          op: 'flag',
          flag: 'player_critical',
          equals: true,
        },
        then: [
          { kind: 'set_flag', flag: 'town_in_danger', value: true },
          { kind: 'fail_quest', questId: 'q_wolf_fang' },
        ],
        once: true,
        priority: 1,
      },
    ],
    narrative: {
      flags: {
        met_smith: false,
        forest_cleared: false,
        smith_helped: false,
        town_in_danger: false,
      },
      beats: [
        {
          id: 'intro',
          text: 'You arrive at a quiet town square. Ironforge hammers east; Lira watches the forest gate.',
          when: { op: 'always' },
        },
        {
          id: 'after_ore',
          text: 'The smith nods — now the Ash Wolf must fall before dusk.',
          when: { op: 'flag', flag: 'smith_helped', equals: true },
        },
      ],
      quests: [
        {
          id: 'q_fetch_ore',
          title: 'Fetch Iron Ore',
          description: 'Pick up iron ore (F) and return to Ironforge (E).',
          giverEntityId: 'npc_smith',
          status: 'locked',
          steps: [
            {
              id: 'deliver',
              description: 'Have iron_ore in inventory',
              when: {
                op: 'and',
                all: [
                  { op: 'has_item', entityId: 'player', itemId: 'iron_ore' },
                  { op: 'flag', flag: 'talked_npc_smith', equals: true },
                ],
              },
              then: [{ kind: 'complete_quest', questId: 'q_fetch_ore' }],
            },
          ],
          onComplete: [
            { kind: 'set_flag', flag: 'smith_helped', value: true },
            {
              kind: 'remove_item',
              entityId: 'player',
              itemId: 'iron_ore',
            },
          ],
        },
        {
          id: 'q_wolf_fang',
          title: 'Fang for the Forge',
          description: 'Defeat the Ash Wolf in Whisper Forest (C) and bring proof to town.',
          giverEntityId: 'npc_smith',
          status: 'locked',
          steps: [
            {
              id: 'clear_wolf',
              description: 'Defeat Ash Wolf',
              when: { op: 'flag', flag: 'forest_cleared', equals: true },
              then: [{ kind: 'complete_quest', questId: 'q_wolf_fang' }],
            },
          ],
          onComplete: [
            { kind: 'set_flag', flag: 'town_secured', value: true },
            { kind: 'emit', event: 'victory_ready' },
          ],
        },
      ],
    },
    presentation: {
      mode: 'phaser2d',
      cameraFollowPlayer: true,
      tileSize: 32,
      narrativeSeed: 'cozy-forge-forest-mine',
    },
    timeHours: 8,
  });
}

/**
 * Regions for the society town.
 *
 * Buildings are authored as `#` footprints with a single `.` door tile so the
 * anchor placer and the tilemap both see real structures; the previous layout
 * was open ground with a few path stripes, which is why the town rendered as an
 * empty field no matter how good the sprites were.
 */
const SOCIETY_TOWN_REGIONS = [
  {
    id: 'town_square',
    name: '城镇广场',
    kind: 'town',
    width: 28,
    height: 20,
    description: '中央广场：喷泉、布告栏、铁匠铺与四周店面。',
    tags: ['social'],
    layoutAscii: [
      '############################',
      '#..........................#',
      '#..####........####........#',
      '#..#..#........#..#........#',
      '#..#.##........#.##........#',
      '#..........................#',
      '#....==================....#',
      '#....=................=....#',
      '#....=.....~~~~.......=....#',
      '#....=.....~~~~.......=....#',
      '#....=.....****.......=....#',
      '#....=................=....#',
      '#....==================....#',
      '#..........................#',
      '#..####........####........#',
      '#..#..#........#..#........#',
      '#..#.##........#.##........#',
      '#..........................#',
      '#..........................#',
      '############################',
    ].join('\n'),
  },
  {
    id: 'market_row',
    name: '商铺街',
    kind: 'town',
    width: 24,
    height: 16,
    description: '面包铺、杂货店与集市货摊排成一条街。',
    tags: ['commerce'],
    layoutAscii: [
      '########################',
      '#......................#',
      '#..#####....#####......#',
      '#..#...#....#...#......#',
      '#..#.###....#.###......#',
      '#......................#',
      '#..==================..#',
      '#......................#',
      '#....**....**....**....#',
      '#......................#',
      '#..==================..#',
      '#......................#',
      '#..#####....#####......#',
      '#..#...#....#...#......#',
      '#..#.###....#.###......#',
      '########################',
    ].join('\n'),
  },
  {
    id: 'school_yard',
    name: '学堂院',
    kind: 'town',
    width: 20,
    height: 16,
    description: '学堂与前院，孩子和学者都在这儿。',
    tags: ['learn'],
    layoutAscii: [
      '####################',
      '#..................#',
      '#..##############..#',
      '#..#............#..#',
      '#..#............#..#',
      '#..#.....==.....#..#',
      '#..#............#..#',
      '#..#####..#######..#',
      '#..................#',
      '#.....========.....#',
      '#..................#',
      '#....**......**....#',
      '#..................#',
      '#.....========.....#',
      '#..................#',
      '####################',
    ].join('\n'),
  },
  {
    id: 'home_row',
    name: '住宅巷',
    kind: 'town',
    width: 24,
    height: 18,
    description: '六户人家、一口水井和镇上的医馆。',
    tags: ['residential'],
    layoutAscii: [
      '########################',
      '#......................#',
      '#..####..####..####....#',
      '#..#..#..#..#..#..#....#',
      '#..#.##..#.##..#.##....#',
      '#......................#',
      '#..==================..#',
      '#......................#',
      '#..####..####..####....#',
      '#..#..#..#..#..#..#....#',
      '#..#.##..#.##..#.##....#',
      '#......................#',
      '#..==================..#',
      '#......................#',
      '#....**..........**....#',
      '#......................#',
      '#......................#',
      '########################',
    ].join('\n'),
  },
  {
    id: 'inn_lane',
    name: '客栈巷',
    kind: 'interior',
    width: 18,
    height: 14,
    description: '旅人交换消息的酒馆大堂，角落还有个咖啡摊。',
    tags: ['social'],
    layoutAscii: [
      '##################',
      '#................#',
      '#..============..#',
      '#................#',
      '#..####....####..#',
      '#..#..#....#..#..#',
      '#..#.##....#.##..#',
      '#................#',
      '#.....**..**.....#',
      '#................#',
      '#..============..#',
      '#................#',
      '#................#',
      '##################',
    ].join('\n'),
  },
  {
    id: 'forest',
    name: '低语森林',
    kind: 'wilderness',
    width: 18,
    height: 14,
    description: '林道通向田地、鸡舍与矿洞口。',
    tags: ['forest'],
    layoutAscii: [
      '##################',
      '#................#',
      '#....========....#',
      '#................#',
      '#......****......#',
      '#....========....#',
      '#................#',
      '#~~~~............#',
      '#~~~~............#',
      '#....========....#',
      '#.###......####..#',
      '#.#.#......#..#..#',
      '#.###......#.##..#',
      '##################',
    ].join('\n'),
  },
] as const;

/** Bidirectional links; the plaza is the hub every other region touches. */
const SOCIETY_TOWN_PORTALS = [
  {
    id: 'portal_town_market',
    fromRegionId: 'town_square',
    toRegionId: 'market_row',
    fromPos: { x: 26, y: 9 },
    toPos: { x: 1, y: 7 },
    label: '往商铺街',
  },
  {
    id: 'portal_market_town',
    fromRegionId: 'market_row',
    toRegionId: 'town_square',
    fromPos: { x: 1, y: 7 },
    toPos: { x: 25, y: 9 },
    label: '回广场',
  },
  {
    id: 'portal_town_school',
    fromRegionId: 'town_square',
    toRegionId: 'school_yard',
    fromPos: { x: 13, y: 1 },
    toPos: { x: 10, y: 14 },
    label: '往学堂',
  },
  {
    id: 'portal_school_town',
    fromRegionId: 'school_yard',
    toRegionId: 'town_square',
    fromPos: { x: 10, y: 14 },
    toPos: { x: 13, y: 2 },
    label: '回广场',
  },
  {
    id: 'portal_town_home',
    fromRegionId: 'town_square',
    toRegionId: 'home_row',
    fromPos: { x: 13, y: 18 },
    toPos: { x: 12, y: 1 },
    label: '往住宅巷',
  },
  {
    id: 'portal_home_town',
    fromRegionId: 'home_row',
    toRegionId: 'town_square',
    fromPos: { x: 12, y: 1 },
    toPos: { x: 13, y: 17 },
    label: '回广场',
  },
  {
    id: 'portal_town_inn',
    fromRegionId: 'town_square',
    toRegionId: 'inn_lane',
    fromPos: { x: 1, y: 9 },
    toPos: { x: 16, y: 7 },
    label: '往客栈',
  },
  {
    id: 'portal_inn_town',
    fromRegionId: 'inn_lane',
    toRegionId: 'town_square',
    fromPos: { x: 16, y: 7 },
    toPos: { x: 2, y: 9 },
    label: '回广场',
  },
  {
    id: 'portal_market_forest',
    fromRegionId: 'market_row',
    toRegionId: 'forest',
    fromPos: { x: 22, y: 8 },
    toPos: { x: 1, y: 5 },
    label: '往林道',
  },
  {
    id: 'portal_forest_market',
    fromRegionId: 'forest',
    toRegionId: 'market_row',
    fromPos: { x: 1, y: 5 },
    toPos: { x: 21, y: 8 },
    label: '回商铺街',
  },
] as const;

/**
 * Areas carry the semantics the cognition loop routes on: names are classified
 * into social / work / food / rest / learn / commerce anchors, so a resident
 * whose plan says "吃午饭" walks to the bakery rather than a hashed tile.
 */
const SOCIETY_TOWN_AREAS = [
  {
    id: 'area_square',
    regionId: 'town_square',
    name: '喷泉广场',
    objects: [
      { id: 'obj_fountain', name: '喷泉', state: '流水潺潺' },
      {
        id: 'obj_notice',
        name: '布告栏',
        state: '已贴出聚会告示——铁砧邀大家黄昏在广场集合',
      },
      { id: 'obj_bench', name: '长椅', state: '晒得温热' },
    ],
  },
  {
    id: 'area_forge',
    regionId: 'town_square',
    name: '铁匠铺',
    objects: [
      { id: 'obj_forge', name: '铁匠炉', state: '余烬尚温' },
      { id: 'obj_anvil', name: '铁砧台', state: '摆着半成的锄头' },
    ],
  },
  {
    id: 'area_watchpost',
    regionId: 'town_square',
    name: '哨位',
    objects: [{ id: 'obj_lamp', name: '街灯', state: '入夜自亮' }],
  },
  {
    id: 'area_bakery',
    regionId: 'market_row',
    name: '面包铺',
    objects: [
      { id: 'obj_oven', name: '烤炉', state: '第一炉刚出' },
      { id: 'obj_bread_tray', name: '面包架', state: '还剩三只圆包' },
    ],
  },
  {
    id: 'area_store',
    regionId: 'market_row',
    name: '杂货店',
    objects: [
      { id: 'obj_counter', name: '柜台', state: '账本翻开着' },
      { id: 'obj_shelf', name: '货架', state: '盐快见底了' },
    ],
  },
  {
    id: 'area_market',
    regionId: 'market_row',
    name: '集市货摊',
    objects: [{ id: 'obj_stall', name: '布摊', state: '新到的染布' }],
  },
  {
    id: 'area_school',
    regionId: 'school_yard',
    name: '学堂',
    objects: [
      { id: 'obj_blackboard', name: '黑板', state: '写着今天的算题' },
      { id: 'obj_bookshelf', name: '书架', state: '几本抄本摊开着' },
    ],
  },
  {
    id: 'area_school_court',
    regionId: 'school_yard',
    name: '前院',
    objects: [{ id: 'obj_swing', name: '秋千', state: '被风推着晃' }],
  },
  {
    id: 'area_homes',
    regionId: 'home_row',
    name: '住宅区',
    objects: [
      { id: 'obj_well', name: '水井', state: '井绳湿着' },
      { id: 'obj_laundry', name: '晾衣绳', state: '挂满了床单' },
      { id: 'obj_bed', name: '木床', state: '被子叠得整齐' },
    ],
  },
  {
    id: 'area_clinic',
    regionId: 'home_row',
    name: '医馆',
    objects: [
      { id: 'obj_sickbed', name: '病床', state: '空着，被褥叠好' },
      { id: 'obj_herbs', name: '药柜', state: '干姜见底' },
    ],
  },
  {
    id: 'area_inn',
    regionId: 'inn_lane',
    name: '大堂',
    objects: [
      { id: 'obj_bar', name: '吧台', state: '炖菜正熬着' },
      { id: 'obj_hearth', name: '壁炉', state: '火烧得正好' },
      { id: 'obj_inn_bed', name: '客房床', state: '空房，被褥叠好' },
    ],
  },
  {
    id: 'area_cafe',
    regionId: 'inn_lane',
    name: '咖啡角',
    objects: [{ id: 'obj_coffee', name: '咖啡壶', state: '刚煮上' }],
  },
  {
    id: 'area_forest_path',
    regionId: 'forest',
    name: '林间小径',
    objects: [{ id: 'obj_trail_mark', name: '路标', state: '脚印还很新' }],
  },
  {
    id: 'area_mine',
    regionId: 'forest',
    name: '矿洞口',
    objects: [{ id: 'obj_mine_mouth', name: '矿道口', state: '支撑木有点歪' }],
  },
  {
    id: 'area_field',
    regionId: 'forest',
    name: '田垄',
    objects: [{ id: 'obj_field', name: '麦田', state: '快能割了' }],
  },
  {
    id: 'area_coop',
    regionId: 'forest',
    name: '鸡舍',
    objects: [{ id: 'obj_coop', name: '鸡舍', state: '门没关严' }],
  },
  {
    id: 'area_forge_hearth',
    regionId: 'town_square',
    parentAreaId: 'area_forge',
    name: '打铁间',
    objects: [{ id: 'obj_bellows', name: '风箱', state: '闲着' }],
  },
  {
    id: 'area_bakery_kitchen',
    regionId: 'market_row',
    parentAreaId: 'area_bakery',
    name: '后厨',
    objects: [{ id: 'obj_dough', name: '面案', state: '撒了面' }],
  },
  {
    id: 'area_inn_loft',
    regionId: 'inn_lane',
    parentAreaId: 'area_inn',
    name: '客房',
    objects: [{ id: 'obj_inn_quilt', name: '客房被褥', state: '叠好' }],
  },
  {
    id: 'area_clinic_room',
    regionId: 'home_row',
    parentAreaId: 'area_clinic',
    name: '诊室',
    objects: [{ id: 'obj_pulse_pillow', name: '诊脉枕', state: '空着' }],
  },
] as const;

/**
 * 20 residents across 6 regions — closer to Smallville's unique-identity floor
 * without waiting on padding. Occupations are spread across the day so the
 * town is never uniformly busy or uniformly idle.
 */
const SOCIETY_TOWN_RESIDENTS = [
  {
    id: 'npc_smith',
    kind: 'npc',
    name: '铁砧',
    regionId: 'town_square',
    pos: { x: 6, y: 3 },
    personality: '粗嗓门的聚会组织者',
    dialogueSeed: '今晚我在广场办聚会——遇见谁就告诉谁。',
    identity: {
      displayName: '铁砧',
      age: 54,
      occupation: '铁匠',
      traits: ['直爽', '义气', '爱张罗'],
      backstory: '管着广场东头的铁匠铺，爱在镇上张罗聚会。',
    },
    attrs: { role: 'blacksmith' },
    inventory: [],
    spriteKey: '🔨',
    schedule: [
      { hour: 8, regionId: 'town_square', activity: '在铁匠炉前打铁' },
      { hour: 17, regionId: 'town_square', activity: '在喷泉边张罗聚会' },
    ],
  },
  {
    id: 'npc_miner',
    kind: 'npc',
    name: '博林',
    regionId: 'forest',
    pos: { x: 12, y: 10 },
    personality: '疲惫却好奇的矿工',
    dialogueSeed: '矿道那根支撑木歪了，我总觉得不对劲。',
    identity: {
      displayName: '博林',
      age: 36,
      occupation: '矿工',
      traits: ['疲惫', '好奇', '忠厚'],
      backstory: '每天走林道去矿洞口，最早把外头的消息带回镇里。',
    },
    attrs: { role: 'miner' },
    inventory: [],
    spriteKey: '⛏️',
    schedule: [
      { hour: 7, regionId: 'forest', activity: '下矿道查看支撑' },
      { hour: 17, regionId: 'inn_lane', activity: '去大堂喝一杯讲矿上的事' },
    ],
  },
  {
    id: 'npc_innkeep',
    kind: 'npc',
    name: '玛拉',
    regionId: 'inn_lane',
    pos: { x: 8, y: 8 },
    personality: '热情的消息中枢',
    dialogueSeed: '炖菜好了——对，那件事我早就听说了。',
    identity: {
      displayName: '玛拉',
      age: 41,
      occupation: '旅店老板',
      traits: ['热情', '爱打听', '眼尖'],
      backstory: '镇上的信息枢纽，传消息比邮差还快。',
    },
    attrs: { role: 'innkeeper' },
    inventory: [],
    spriteKey: '🍲',
    schedule: [
      { hour: 11, regionId: 'inn_lane', activity: '在吧台招呼客人' },
      { hour: 18, regionId: 'inn_lane', activity: '听客人讲今天的闲话' },
    ],
  },
  {
    id: 'npc_post',
    kind: 'npc',
    name: '皮普',
    regionId: 'town_square',
    pos: { x: 13, y: 13 },
    personality: '匆忙的邮差',
    dialogueSeed: '我跑一趟就能把话带到全镇！',
    identity: {
      displayName: '皮普',
      age: 19,
      occupation: '邮差',
      traits: ['匆忙', '友善', '八卦'],
      backstory: '在广场、商铺街与林道之间送信，也捎带闲话。',
    },
    attrs: { role: 'post' },
    inventory: [],
    spriteKey: '✉️',
    schedule: [
      { hour: 8, regionId: 'town_square', activity: '在布告栏整理告示' },
      { hour: 13, regionId: 'market_row', activity: '沿街送信' },
      { hour: 17, regionId: 'town_square', activity: '回广场汇报谁听说了' },
    ],
  },
  {
    id: 'npc_baker',
    kind: 'npc',
    name: '芸姐',
    regionId: 'market_row',
    pos: { x: 5, y: 3 },
    personality: '天没亮就起的面包师',
    dialogueSeed: '第一炉刚出，趁热拿两个。',
    identity: {
      displayName: '芸姐',
      age: 33,
      occupation: '面包师',
      traits: ['勤快', '嘴甜', '记性好'],
      backstory: '五点就开炉，谁几点路过她都记得。',
    },
    attrs: { role: 'baker' },
    inventory: [],
    spriteKey: '🥖',
    schedule: [
      { hour: 5, regionId: 'market_row', activity: '在烤炉前烘面包' },
      { hour: 13, regionId: 'home_row', activity: '给街坊送剩下的面包' },
    ],
  },
  {
    id: 'npc_teacher',
    kind: 'npc',
    name: '何先生',
    regionId: 'school_yard',
    pos: { x: 9, y: 4 },
    personality: '话不多但很有分量的教书人',
    dialogueSeed: '孩子们该识字，别只会记账。',
    identity: {
      displayName: '何先生',
      age: 47,
      occupation: '教师',
      traits: ['耐心', '固执', '讲道理'],
      backstory: '在学堂教了二十年书，镇上一半的人是他的学生。',
    },
    attrs: { role: 'teacher' },
    inventory: [],
    spriteKey: '📚',
    schedule: [
      { hour: 8, regionId: 'school_yard', activity: '在学堂上课' },
      { hour: 16, regionId: 'school_yard', activity: '批改功课' },
    ],
  },
  {
    id: 'npc_shop',
    kind: 'npc',
    name: '老陈',
    regionId: 'market_row',
    pos: { x: 14, y: 3 },
    personality: '精打细算的杂货店主',
    dialogueSeed: '盐快见底了，下一批得等三天。',
    identity: {
      displayName: '老陈',
      age: 58,
      occupation: '店主',
      traits: ['精明', '话密', '记账'],
      backstory: '开着镇上唯一的杂货店，谁欠多少他都清楚。',
    },
    attrs: { role: 'merchant' },
    inventory: [],
    spriteKey: '🧺',
    schedule: [
      { hour: 9, regionId: 'market_row', activity: '看店记账' },
      { hour: 15, regionId: 'market_row', activity: '和同行打听行情' },
    ],
  },
  {
    id: 'npc_doctor',
    kind: 'npc',
    name: '苏大夫',
    regionId: 'home_row',
    pos: { x: 5, y: 9 },
    personality: '冷静的医者',
    dialogueSeed: '矿上要是出事，先把人抬到我这儿。',
    identity: {
      displayName: '苏大夫',
      age: 44,
      occupation: '医生',
      traits: ['冷静', '寡言', '手稳'],
      backstory: '守着住宅巷的医馆，夜里也会被人敲门。',
    },
    attrs: { role: 'doctor' },
    inventory: [],
    spriteKey: '🌿',
    schedule: [
      { hour: 8, regionId: 'home_row', activity: '在医馆给人诊治' },
      { hour: 15, regionId: 'home_row', activity: '出诊探访卧床的病人' },
    ],
  },
  {
    id: 'npc_guard',
    kind: 'npc',
    name: '石头',
    regionId: 'town_square',
    pos: { x: 21, y: 13 },
    personality: '睡不够的守夜人',
    dialogueSeed: '夜里街上有什么动静，我都听得见。',
    identity: {
      displayName: '石头',
      age: 29,
      occupation: '守卫',
      traits: ['警觉', '话少', '认死理'],
      backstory: '白天补眠，入夜沿街巡到天亮。',
    },
    attrs: { role: 'guard' },
    inventory: [],
    spriteKey: '🛡️',
    schedule: [
      { hour: 20, regionId: 'town_square', activity: '沿街巡夜' },
      { hour: 14, regionId: 'inn_lane', activity: '在大堂吃今天第一顿' },
    ],
  },
  {
    id: 'npc_farmer',
    kind: 'npc',
    name: '阿禾',
    regionId: 'forest',
    pos: { x: 8, y: 4 },
    personality: '看天吃饭的庄稼人',
    dialogueSeed: '麦子快能割了，就怕这几天下雨。',
    identity: {
      displayName: '阿禾',
      age: 39,
      occupation: '农夫',
      traits: ['踏实', '爱抱怨天气', '力气大'],
      backstory: '田在林道边上，收成好就挑到集市卖。',
    },
    attrs: { role: 'farmer' },
    inventory: [],
    spriteKey: '🌾',
    schedule: [
      { hour: 5, regionId: 'forest', activity: '去鸡舍看鸡' },
      { hour: 6, regionId: 'forest', activity: '在田里干活' },
      { hour: 14, regionId: 'market_row', activity: '把收成挑到集市' },
    ],
  },
  {
    id: 'npc_scholar',
    kind: 'npc',
    name: '白衣',
    regionId: 'school_yard',
    pos: { x: 6, y: 4 },
    personality: '总在想问题的抄书人',
    dialogueSeed: '这段抄本对不上，我得再查查。',
    identity: {
      displayName: '白衣',
      age: 31,
      occupation: '学者',
      traits: ['好奇', '走神', '认真'],
      backstory: '借住在学堂后头抄书，最爱追着人问细节。',
    },
    attrs: { role: 'scholar' },
    inventory: [],
    spriteKey: '📜',
    schedule: [
      { hour: 9, regionId: 'school_yard', activity: '查阅典籍做笔记' },
      { hour: 17, regionId: 'inn_lane', activity: '找人讨论没想通的问题' },
    ],
  },
  {
    id: 'npc_student',
    kind: 'npc',
    name: '小满',
    regionId: 'school_yard',
    pos: { x: 12, y: 10 },
    personality: '坐不住的孩子',
    dialogueSeed: '下课我就去广场找人玩！',
    identity: {
      displayName: '小满',
      age: 11,
      occupation: '学生',
      traits: ['好动', '嘴快', '记不住事'],
      backstory: '芸姐的孩子，全镇跑得最快的消息腿。',
    },
    attrs: { role: 'student' },
    inventory: [],
    spriteKey: '🎒',
    schedule: [
      { hour: 8, regionId: 'school_yard', activity: '在学堂上课' },
      { hour: 15, regionId: 'town_square', activity: '和同伴在广场乱跑' },
    ],
  },
  {
    id: 'npc_weaver',
    kind: 'npc',
    name: '织娘',
    regionId: 'market_row',
    pos: { x: 8, y: 8 },
    personality: '手不停的布摊主人',
    dialogueSeed: '新到的染布，你摸摸这手感。',
    identity: {
      displayName: '织娘',
      age: 36,
      occupation: '织工',
      traits: ['手巧', '爱笑', '爱听八卦'],
      backstory: '在集市摆布摊，一边织一边听全镇的闲话。',
    },
    attrs: { role: 'weaver' },
    inventory: [],
    spriteKey: '🧵',
    schedule: [
      { hour: 9, regionId: 'market_row', activity: '在布摊前织布' },
      { hour: 18, regionId: 'town_square', activity: '收摊后去广场坐坐' },
    ],
  },
  {
    id: 'npc_barkeep',
    kind: 'npc',
    name: '阿六',
    regionId: 'inn_lane',
    pos: { x: 12, y: 8 },
    personality: '寡言的咖啡摊伙计',
    dialogueSeed: '要浓的还是淡的？',
    identity: {
      displayName: '阿六',
      age: 24,
      occupation: '侍者',
      traits: ['安静', '手快', '记得每个人的口味'],
      backstory: '在客栈角落守着咖啡壶，听得多说得少。',
    },
    attrs: { role: 'barkeep' },
    inventory: [],
    spriteKey: '☕',
    schedule: [
      { hour: 7, regionId: 'inn_lane', activity: '在咖啡角煮咖啡' },
      { hour: 19, regionId: 'inn_lane', activity: '给大堂的人续杯' },
    ],
  },
  {
    id: 'npc_carpenter',
    kind: 'npc',
    name: '梁木',
    regionId: 'home_row',
    pos: { x: 6, y: 8 },
    personality: '量三次再下锯的木匠',
    dialogueSeed: '这梁要是再歪，雨天会漏。',
    identity: {
      displayName: '梁木',
      age: 47,
      occupation: '木匠',
      traits: ['仔细', '手茧厚', '不爱赶工'],
      backstory: '镇上的门框多半出过他的手。欠铁砧一包钉子。夜里会把尺子再对一遍。',
    },
    attrs: { role: 'carpenter' },
    inventory: [],
    spriteKey: '🪵',
    schedule: [
      { hour: 8, regionId: 'home_row', activity: '在工棚刨木' },
      { hour: 17, regionId: 'town_square', activity: '去广场看谁家门要修' },
    ],
  },
  {
    id: 'npc_hunter',
    kind: 'npc',
    name: '林七',
    regionId: 'forest',
    pos: { x: 8, y: 8 },
    personality: '林子里长大的猎人',
    dialogueSeed: '矿道口那串脚印不是鹿的。',
    identity: {
      displayName: '林七',
      age: 28,
      occupation: '猎人',
      traits: ['眼尖', '少进城', '护着林子'],
      backstory: '爹把猎场交给他。林七认得博林每天走的那条道。他不爱听人把林子说成矿。',
    },
    attrs: { role: 'hunter' },
    inventory: [],
    spriteKey: '🏹',
    schedule: [
      { hour: 6, regionId: 'forest', activity: '沿林道查看兽踪' },
      { hour: 18, regionId: 'inn_lane', activity: '把野味送到客栈' },
    ],
  },
  {
    id: 'npc_miller',
    kind: 'npc',
    name: '磨盘',
    regionId: 'market_row',
    pos: { x: 4, y: 10 },
    personality: '身上永远有面灰的磨坊主',
    dialogueSeed: '麦子来了就推，别堆过夜。',
    identity: {
      displayName: '磨盘',
      age: 50,
      occupation: '磨坊主',
      traits: ['早起', '记斤两', '嫌浪费'],
      backstory: '磨坊在集市西头。磨盘和田埂约好麦熟就送来。他儿子在学堂念书。',
    },
    attrs: { role: 'miller' },
    inventory: [],
    spriteKey: '⚙️',
    schedule: [
      { hour: 5, regionId: 'market_row', activity: '推磨磨面' },
      { hour: 16, regionId: 'town_square', activity: '把面粉送到面包铺' },
    ],
  },
  {
    id: 'npc_mayor',
    kind: 'npc',
    name: '周伯',
    regionId: 'town_square',
    pos: { x: 10, y: 10 },
    personality: '爱在喷泉边劝架的里正',
    dialogueSeed: '有事写到布告栏上，别只在巷口嚷。',
    identity: {
      displayName: '周伯',
      age: 62,
      occupation: '里正',
      traits: ['好面子', '记仇也记恩', '爱张罗'],
      backstory: '当了九年里正。周伯和铁砧一起把聚会写成告示。他总觉得镇上该再热闹些。',
    },
    attrs: { role: 'mayor' },
    inventory: [],
    spriteKey: '🏅',
    schedule: [
      { hour: 9, regionId: 'town_square', activity: '在布告栏下听人告状' },
      { hour: 18, regionId: 'town_square', activity: '在喷泉边张罗今晚谁来' },
    ],
  },
  {
    id: 'npc_potter',
    kind: 'npc',
    name: '泥阿婆',
    regionId: 'market_row',
    pos: { x: 10, y: 6 },
    personality: '转盘从不离手的陶匠',
    dialogueSeed: '这罐是给客栈炖菜用的，别碰。',
    identity: {
      displayName: '泥阿婆',
      age: 58,
      occupation: '陶匠',
      traits: ['手上有泥', '话短', '心细'],
      backstory: '摊位挨着织娘。泥阿婆给玛拉烧过汤罐。她嫌年轻人不会惜物。',
    },
    attrs: { role: 'potter' },
    inventory: [],
    spriteKey: '🏺',
    schedule: [
      { hour: 8, regionId: 'market_row', activity: '在摊上拉坯' },
      { hour: 17, regionId: 'inn_lane', activity: '把新罐送到大堂' },
    ],
  },
  {
    id: 'npc_kid',
    kind: 'npc',
    name: '阿豆',
    regionId: 'school_yard',
    pos: { x: 7, y: 9 },
    personality: '下课就往广场跑的学童',
    dialogueSeed: '程先生布置的功课我还没写完——先别告诉他。',
    identity: {
      displayName: '阿豆',
      age: 11,
      occupation: '学童',
      traits: ['贪玩', '嘴甜', '跑得快'],
      backstory: '磨盘的儿子。阿豆和皮普抢着送信。他最怕被程先生叫起来背书。',
    },
    attrs: { role: 'child' },
    inventory: [],
    spriteKey: '🧒',
    schedule: [
      { hour: 8, regionId: 'school_yard', activity: '在学堂上课' },
      { hour: 16, regionId: 'town_square', activity: '在喷泉边乱跑' },
    ],
  },
] as const;

/**
 * Seed relationships. Retrieval and conversation both weight known ties, so a
 * cold graph made every first meeting read identically.
 */
const SOCIETY_TOWN_RELATIONS = [
  { id: 'rel_smith_miner', from: 'npc_smith', to: 'npc_miner', type: 'allies', strength: 0.6 },
  { id: 'rel_smith_mara', from: 'npc_smith', to: 'npc_innkeep', type: 'knows', strength: 0.5 },
  { id: 'rel_smith_guard', from: 'npc_smith', to: 'npc_guard', type: 'knows', strength: 0.45 },
  { id: 'rel_mara_pip', from: 'npc_innkeep', to: 'npc_post', type: 'knows', strength: 0.7 },
  { id: 'rel_mara_barkeep', from: 'npc_innkeep', to: 'npc_barkeep', type: 'allies', strength: 0.75 },
  { id: 'rel_pip_miner', from: 'npc_post', to: 'npc_miner', type: 'knows', strength: 0.4 },
  { id: 'rel_pip_student', from: 'npc_post', to: 'npc_student', type: 'allies', strength: 0.6 },
  {
    id: 'rel_baker_student',
    from: 'npc_baker',
    to: 'npc_student',
    type: 'custom',
    strength: 0.9,
    meta: { kinship: 'parent_child', label: '母子' },
  },
  { id: 'rel_baker_shop', from: 'npc_baker', to: 'npc_shop', type: 'knows', strength: 0.5 },
  { id: 'rel_baker_weaver', from: 'npc_baker', to: 'npc_weaver', type: 'allies', strength: 0.65 },
  { id: 'rel_teacher_student', from: 'npc_teacher', to: 'npc_student', type: 'knows', strength: 0.6 },
  { id: 'rel_teacher_scholar', from: 'npc_teacher', to: 'npc_scholar', type: 'allies', strength: 0.7 },
  { id: 'rel_scholar_miner', from: 'npc_scholar', to: 'npc_miner', type: 'knows', strength: 0.35 },
  { id: 'rel_doctor_miner', from: 'npc_doctor', to: 'npc_miner', type: 'knows', strength: 0.5 },
  { id: 'rel_doctor_farmer', from: 'npc_doctor', to: 'npc_farmer', type: 'knows', strength: 0.4 },
  { id: 'rel_farmer_shop', from: 'npc_farmer', to: 'npc_shop', type: 'knows', strength: 0.55 },
  { id: 'rel_weaver_shop', from: 'npc_weaver', to: 'npc_shop', type: 'rivals', strength: 0.3 },
  { id: 'rel_guard_barkeep', from: 'npc_guard', to: 'npc_barkeep', type: 'knows', strength: 0.5 },
  { id: 'rel_carpenter_smith', from: 'npc_carpenter', to: 'npc_smith', type: 'allies', strength: 0.55 },
  { id: 'rel_hunter_miner', from: 'npc_hunter', to: 'npc_miner', type: 'knows', strength: 0.5 },
  { id: 'rel_hunter_inn', from: 'npc_hunter', to: 'npc_innkeep', type: 'knows', strength: 0.4 },
  {
    id: 'rel_miller_farmer',
    from: 'npc_miller',
    to: 'npc_farmer',
    type: 'allies',
    strength: 0.7,
  },
  {
    id: 'rel_miller_kid',
    from: 'npc_miller',
    to: 'npc_kid',
    type: 'custom',
    strength: 0.95,
    meta: { kinship: 'parent_child', label: '父子' },
  },
  { id: 'rel_mayor_smith', from: 'npc_mayor', to: 'npc_smith', type: 'allies', strength: 0.65 },
  { id: 'rel_mayor_teacher', from: 'npc_mayor', to: 'npc_teacher', type: 'knows', strength: 0.45 },
  { id: 'rel_potter_weaver', from: 'npc_potter', to: 'npc_weaver', type: 'knows', strength: 0.5 },
  { id: 'rel_potter_inn', from: 'npc_potter', to: 'npc_innkeep', type: 'allies', strength: 0.55 },
  { id: 'rel_kid_student', from: 'npc_kid', to: 'npc_student', type: 'allies', strength: 0.7 },
  { id: 'rel_kid_post', from: 'npc_kid', to: 'npc_post', type: 'knows', strength: 0.5 },
] as const;

const WORK_AREA_BY_NPC: Record<string, string> = {
  npc_smith: 'area_forge',
  npc_miner: 'area_mine',
  npc_innkeep: 'area_inn',
  npc_post: 'area_square',
  npc_baker: 'area_bakery',
  npc_teacher: 'area_school',
  npc_shop: 'area_store',
  npc_doctor: 'area_clinic',
  npc_guard: 'area_watchpost',
  npc_farmer: 'area_field',
  npc_scholar: 'area_school',
  npc_student: 'area_school',
  npc_weaver: 'area_market',
  npc_barkeep: 'area_inn',
  npc_carpenter: 'area_homes',
  npc_hunter: 'area_forest_path',
  npc_miller: 'area_market',
  npc_mayor: 'area_square',
  npc_potter: 'area_market',
  npc_kid: 'area_school_court',
};

function inferWorkAreaId(
  occupation: string | undefined,
  areas: ReadonlyArray<{ id: string; name: string }>,
): string | undefined {
  const t = occupation ?? '';
  const ascii = t.length > 0 && !/[^\x00-\x7F]/.test(t);
  const hit = areas.find((a) => {
    const n = a.name;
    if (/铁|锤|smith|forge|hammer/i.test(t) && /铁|炉|砧|forge|smith|anvil/i.test(n)) {
      return true;
    }
    if (
      /面包|厨|baker|cook|galley|mess/i.test(t) &&
      /面包|厨|galley|mess|kitchen|oven/i.test(n)
    ) {
      return true;
    }
    if (/旅|客栈|酒|inn|tavern/i.test(t) && /客栈|大堂|酒|inn|tavern/i.test(n)) {
      return true;
    }
    if (/医|药|medic|doctor|surgeon/i.test(t) && /医|诊|clinic|sickbay|infirmary/i.test(n)) {
      return true;
    }
    if (
      /学|塾|先生|teacher|scribe|novice/i.test(t) &&
      /学|school|scriptorium|library|chapel/i.test(n)
    ) {
      return true;
    }
    if (
      /helm|watch|officer|pilot/i.test(t) &&
      /bridge|helm|deck|watch/i.test(n)
    ) {
      return true;
    }
    if (/矿/.test(t) && /矿/.test(n)) return true;
    if (/渔|船/.test(t) && /码|船|河/.test(n)) return true;
    if (/窑|陶/.test(t) && /窑|陶/.test(n)) return true;
    if (ascii) {
      const token = t.toLowerCase().split(/\s+/)[0] ?? '';
      return token.length >= 4 && n.toLowerCase().includes(token);
    }
    return Boolean(occupation && occupation.length >= 2 && n.includes(occupation.slice(0, 2)));
  });
  return hit?.id;
}

function homeAreaName(
  person: string,
  ascii: boolean,
  packId: string,
): string {
  if (!ascii) return `${person}的家`;
  if (packId === 'society.crew') return `${person}'s bunk`;
  if (packId === 'society.cloister') return `${person}'s cell`;
  return `${person}'s home`;
}

function homeObjectName(
  person: string,
  ascii: boolean,
  packId: string,
): string {
  if (!ascii) return `${person}的床`;
  if (packId === 'society.crew') return `${person}'s bunk`;
  if (packId === 'society.cloister') return `${person}'s cot`;
  return `${person}'s bed`;
}

function workNookName(
  person: string,
  occupation: string | undefined,
  ascii: boolean,
): string {
  const t = occupation ?? '';
  if (ascii) {
    if (/smith|forge|hammer/i.test(t)) return `${person}'s forge`;
    if (/baker|cook|galley|mess/i.test(t)) return `${person}'s galley`;
    if (/helm|watch|officer|pilot/i.test(t)) return `${person}'s station`;
    if (/scribe|teacher|copyist/i.test(t)) return `${person}'s desk`;
    if (/medic|doctor|surgeon/i.test(t)) return `${person}'s sickbay`;
    return `${person}'s station`;
  }
  if (/铁|锤|炉/.test(t)) return `${person}的炉`;
  if (/面包|厨/.test(t)) return `${person}的案板`;
  if (/店|摊|货|铺/.test(t)) return `${person}的铺`;
  if (/渔|船|网/.test(t)) return `${person}的网位`;
  if (/学|教|塾/.test(t)) return `${person}的课桌`;
  if (/医|药/.test(t)) return `${person}的诊桌`;
  if (/窑|陶/.test(t)) return `${person}的窑口`;
  return `${person}的工位`;
}

function workNookObjectName(
  person: string,
  occupation: string | undefined,
  ascii: boolean,
): string {
  const t = occupation ?? '';
  if (ascii) {
    if (/smith|forge|hammer/i.test(t)) return `${person}'s hammer`;
    if (/baker|cook|galley|mess/i.test(t)) return `${person}'s oven`;
    if (/helm|watch|officer|pilot/i.test(t)) return `${person}'s console`;
    if (/scribe|teacher|copyist/i.test(t)) return `${person}'s desk`;
    return `${person}'s kit`;
  }
  if (/铁|锤|炉/.test(t)) return `${person}的铁锤`;
  if (/面包|厨/.test(t)) return `${person}的案板`;
  if (/店|摊|铺/.test(t)) return `${person}的柜台`;
  if (/渔|船|网/.test(t)) return `${person}的网`;
  if (/学|教|塾/.test(t)) return `${person}的粉笔`;
  if (/医|药/.test(t)) return `${person}的药箱`;
  return `${person}的家伙`;
}

/**
 * Each resident gets a nested home room and a workplace (`located_in`).
 * Idempotent — safe to run after padding.
 */
export function stampResidentPlaces(world: WorldSpec): WorldSpec {
  const areas = [...(world.space.areas ?? [])];
  const existingIds = new Set(areas.map((a) => a.id));
  const ascii = worldCopyAscii(world);
  const packId = resolveGenreProfile(world).id;
  const homesParent =
    areas.find((a) => a.id === 'area_homes') ??
    areas.find((a) =>
      /宅|家|巷|home|bunk|cabin|sleep|dorm|cell/i.test(a.name),
    );
  const extraAreas: Array<Record<string, unknown>> = [];
  const extraRels: Array<Record<string, unknown>> = [];
  const dropRelIds = new Set<string>();
  const relIds = new Set(world.relations.map((r) => r.id));
  const knownArea = (id: string | undefined): id is string =>
    Boolean(id) &&
    (existingIds.has(id!) || extraAreas.some((a) => a['id'] === id));
  const nestWork = (
    e: (typeof world.entities)[number],
    parentWorkId: string | undefined,
  ): string | undefined => {
    if (!parentWorkId || !knownArea(parentWorkId)) return parentWorkId;
    const nookId = `area_work_${e.id}`;
    if (parentWorkId === nookId) return nookId;
    const parent =
      areas.find((a) => a.id === parentWorkId) ??
      extraAreas.find((a) => a['id'] === parentWorkId);
    if (!knownArea(nookId)) {
      extraAreas.push({
        id: nookId,
        name: workNookName(e.name, e.identity?.occupation, ascii),
        regionId:
          (parent && 'regionId' in parent
            ? String((parent as { regionId?: string }).regionId)
            : undefined) ?? e.regionId,
        parentAreaId: parentWorkId,
        objects: [
          {
            id: `obj_work_${e.id}`,
            name: workNookObjectName(e.name, e.identity?.occupation, ascii),
            state: ascii
              ? `${e.identity?.occupation ?? 'work'} bench: a job left half-done`
              : `${e.identity?.occupation ?? '工位'}的位子上活计只干了一半`,
            tags: [],
          },
        ],
      });
      existingIds.add(nookId);
    }
    dropRelIds.add(`loc_work_${e.id}`);
    if (!relIds.has(`loc_work_${e.id}`) || dropRelIds.has(`loc_work_${e.id}`)) {
      extraRels.push({
        id: `loc_work_${e.id}`,
        from: e.id,
        to: nookId,
        type: 'located_in',
        strength: 0.8,
        meta: { role: 'work' },
      });
      relIds.add(`loc_work_${e.id}`);
    }
    return nookId;
  };
  const nestHome = (
    e: (typeof world.entities)[number],
    parentHomeId: string | undefined,
  ): string => {
    const homeId = `area_home_${e.id}`;
    if (parentHomeId === homeId) return homeId;
    const parent =
      (parentHomeId
        ? areas.find((a) => a.id === parentHomeId) ??
          extraAreas.find((a) => a['id'] === parentHomeId)
        : undefined) ?? homesParent;
    if (!knownArea(homeId)) {
      extraAreas.push({
        id: homeId,
        name: homeAreaName(e.name, ascii, packId),
        regionId:
          (parent && 'regionId' in parent
            ? String((parent as { regionId?: string }).regionId)
            : undefined) ??
          homesParent?.regionId ??
          e.regionId,
        parentAreaId: parentHomeId ?? homesParent?.id,
        objects: [
          {
            id: `obj_bed_${e.id}`,
            name: homeObjectName(e.name, ascii, packId),
            state: ascii ? 'blankets folded' : '叠好了被子',
            tags: [],
          },
        ],
      });
      existingIds.add(homeId);
    }
    if (!relIds.has(`loc_home_${e.id}`)) {
      extraRels.push({
        id: `loc_home_${e.id}`,
        from: e.id,
        to: homeId,
        type: 'located_in',
        strength: 1,
        meta: { role: 'home' },
      });
      relIds.add(`loc_home_${e.id}`);
    }
    return homeId;
  };
  const entities = world.entities.map((e) => {
    if (e.kind !== 'npc') return e;
    const workParent =
      (e.identity?.workAreaId && knownArea(e.identity.workAreaId)
        ? e.identity.workAreaId
        : undefined) ??
      (WORK_AREA_BY_NPC[e.id] && knownArea(WORK_AREA_BY_NPC[e.id])
        ? WORK_AREA_BY_NPC[e.id]
        : undefined) ??
      inferWorkAreaId(e.identity?.occupation, areas) ??
      homesParent?.id;
    const personalHomeId = `area_home_${e.id}`;
    const alreadyPersonal =
      e.identity?.homeAreaId === personalHomeId &&
      existingIds.has(personalHomeId);
    const homeParent =
      alreadyPersonal
        ? personalHomeId
        : e.identity?.homeAreaId &&
            knownArea(e.identity.homeAreaId) &&
            e.identity.homeAreaId !== personalHomeId
          ? e.identity.homeAreaId
          : homesParent?.id;
    const homeId = alreadyPersonal
      ? personalHomeId
      : nestHome(e, homeParent);
    const workId = nestWork(e, workParent);
    if (
      homeId === e.identity?.homeAreaId &&
      workId === e.identity?.workAreaId
    ) {
      return e;
    }
    return {
      ...e,
      identity: {
        ...e.identity,
        displayName: e.identity?.displayName ?? e.name,
        traits: e.identity?.traits ?? [],
        initialRelations: e.identity?.initialRelations ?? {},
        homeAreaId: homeId,
        workAreaId: workId ?? e.identity?.workAreaId,
      },
    };
  });
  if (!extraAreas.length && !extraRels.length && !dropRelIds.size) {
    const already = world.entities.some(
      (e) => e.kind === 'npc' && e.identity?.homeAreaId && e.identity?.workAreaId,
    );
    if (already) return world;
  }
  return parseWorldSpec({
    ...world,
    entities,
    space: {
      ...world.space,
      areas: [...areas, ...extraAreas],
    },
    relations: [
      ...world.relations.filter((r) => !dropRelIds.has(r.id)),
      ...extraRels,
    ],
  });
}

/**
 * Society-first town (Stanford-town observe path).
 * No combat enemies / win-loop quests — residents, schedules, gossip, party seed.
 */
export function createSocietyTownWorld(options?: {
  readonly title?: string;
  readonly id?: string;
  readonly artStyleId?: string;
}): WorldSpec {
  const id = options?.id ?? `world_${Date.now().toString(36)}`;
  const world = parseWorldSpec({
    meta: {
      id,
      title: options?.title ?? '生活小镇',
      version: 1,
      summary:
        '一座可观察的小镇社会——居民上班、闲聊、传消息、参加聚会。右侧观察与耳语干预；不是通关打怪 RPG。',
    },
    styleAnchor: scaffoldStyleAnchor({
      ...(options?.artStyleId ? { artStyleId: options.artStyleId } : {}),
      palette: ['#2d6a4f', '#d8f3dc', '#f4a261'],
      mood: '温馨日常',
    }),
    space: {
      regions: SOCIETY_TOWN_REGIONS,
      portals: SOCIETY_TOWN_PORTALS,
      startRegionId: 'town_square',
      startPos: { x: 13, y: 13 },
      areas: SOCIETY_TOWN_AREAS,
    },
    entities: [
      {
        id: 'player',
        kind: 'player',
        name: '观察者',
        regionId: 'town_square',
        pos: { x: 13, y: 13 },
        attrs: { hp: 10, role: 'observer' },
        inventory: [],
        spriteKey: '👁',
      },
      ...SOCIETY_TOWN_RESIDENTS,
    ],
    relations: SOCIETY_TOWN_RELATIONS,
    rules: [
      {
        id: 'rule_society_alive',
        name: '小镇社会在运转',
        when: { op: 'always' },
        then: [{ kind: 'set_flag', flag: 'society_alive', value: true }],
        once: true,
        priority: 0,
      },
      {
        id: 'rule_party_notice',
        name: '布告栏播下聚会传闻',
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
      beats: [
        {
          id: 'intro',
          text: '清晨的广场。铁砧贴出聚会告示，皮普已经带着消息跑开了。',
          when: { op: 'always' },
        },
        {
          id: 'evening',
          text: '黄昏将近，居民陆续往喷泉边聚拢——传闻变成了人群。',
          when: { op: 'flag', flag: 'party_invitation_posted', equals: true },
        },
      ],
      quests: [],
    },
    presentation: {
      mode: 'phaser2d',
      cameraFollowPlayer: true,
      tileSize: 32,
      narrativeSeed: 'society-gathering-observe',
      openingRumor: '已贴出聚会告示——铁砧邀大家黄昏在广场集合',
      cinematicEnabled: false,
      genreProfile: TOWN_GENRE_PROFILE,
    },
    timeHours: 8,
  });
  return stampResidentPlaces(world);
}

/** Dungeon archetype — start in halls; key + boss loop (not a town paste). */
export function createDungeonWorld(options?: {
  readonly title?: string;
  readonly id?: string;
  readonly artStyleId?: string;
}): WorldSpec {
  const id = options?.id ?? `world_${Date.now().toString(36)}`;
  return parseWorldSpec({
    meta: {
      id,
      title: options?.title ?? 'Forgotten Dungeon',
      version: 1,
      summary:
        'Descend the halls, claim the ancient key, and face the warden in the boss lair.',
    },
    styleAnchor: scaffoldStyleAnchor({
      ...(options?.artStyleId ? { artStyleId: options.artStyleId } : {}),
      flavour: 'underground dungeon halls',
      palette: ['#1b263b', '#415a77', '#e0e1dd'],
      mood: 'ominous delve',
    }),
    space: {
      regions: [
        {
          id: 'dungeon_hall',
          name: 'Echo Hall',
          kind: 'dungeon',
          width: 20,
          height: 16,
          description: 'Torch-lit corridors of cracked stone.',
          tags: ['dungeon', 'start'],
          layoutAscii: [
            '####################',
            '#..................#',
            '#..................#',
            '#..................#',
            '#..................#',
            '#..................#',
            '#..................#',
            '#..................#',
            '#..................#',
            '#..................#',
            '#..................#',
            '#..................#',
            '#..................#',
            '#..................#',
            '#..................#',
            '####################',
          ].join('\n'),
        },
        {
          id: 'treasure_vault',
          name: 'Treasure Vault',
          kind: 'dungeon',
          width: 14,
          height: 12,
          description: 'A locked vault glittering with relics.',
          tags: ['vault'],
        },
        {
          id: 'boss_lair',
          name: 'Warden Lair',
          kind: 'arena',
          width: 16,
          height: 14,
          description: 'The heart of the dungeon — something waits.',
          tags: ['boss'],
        },
      ],
      portals: [
        {
          id: 'portal_hall_vault',
          fromRegionId: 'dungeon_hall',
          toRegionId: 'treasure_vault',
          fromPos: { x: 18, y: 8 },
          toPos: { x: 1, y: 6 },
          label: 'Vault',
        },
        {
          id: 'portal_vault_hall',
          fromRegionId: 'treasure_vault',
          toRegionId: 'dungeon_hall',
          fromPos: { x: 1, y: 6 },
          toPos: { x: 17, y: 8 },
          label: 'Hall',
        },
        {
          id: 'portal_hall_boss',
          fromRegionId: 'dungeon_hall',
          toRegionId: 'boss_lair',
          fromPos: { x: 10, y: 14 },
          toPos: { x: 8, y: 1 },
          label: 'Lair',
        },
        {
          id: 'portal_boss_hall',
          fromRegionId: 'boss_lair',
          toRegionId: 'dungeon_hall',
          fromPos: { x: 8, y: 1 },
          toPos: { x: 10, y: 13 },
          label: 'Hall',
        },
      ],
      startRegionId: 'dungeon_hall',
      startPos: { x: 3, y: 3 },
    },
    entities: [
      {
        id: 'player',
        kind: 'player',
        name: 'Delver',
        regionId: 'dungeon_hall',
        pos: { x: 3, y: 3 },
        attrs: { hp: 14, atk: 4 },
        inventory: [],
        spriteKey: '🗡️',
      },
      {
        id: 'npc_warden_ghost',
        kind: 'npc',
        name: 'Shade Guide',
        regionId: 'dungeon_hall',
        pos: { x: 8, y: 5 },
        personality: 'whispering remnant of a fallen keeper',
        dialogueSeed: 'The vault key lies east… the lair hungers south.',
        attrs: { role: 'guide' },
        inventory: [],
        spriteKey: '👻',
      },
      {
        id: 'item_ancient_key',
        kind: 'item',
        name: 'Ancient Key',
        regionId: 'treasure_vault',
        pos: { x: 7, y: 6 },
        attrs: { itemId: 'ancient_key' },
        inventory: [],
        tags: ['quest'],
        spriteKey: '🔑',
      },
      {
        id: 'enemy_skeleton',
        kind: 'enemy',
        name: 'Bone Guard',
        regionId: 'dungeon_hall',
        pos: { x: 14, y: 10 },
        attrs: { hp: 10, atk: 3 },
        inventory: [],
        dialogueSeed: 'Clack…',
        spriteKey: '💀',
      },
      {
        id: 'enemy_warden',
        kind: 'enemy',
        name: 'Dungeon Warden',
        regionId: 'boss_lair',
        pos: { x: 8, y: 7 },
        attrs: { hp: 20, atk: 5 },
        inventory: ['warden_crest'],
        dialogueSeed: 'None leave.',
        spriteKey: '👹',
      },
    ],
    relations: [
      {
        id: 'rel_player_guide',
        from: 'player',
        to: 'npc_warden_ghost',
        type: 'knows',
        strength: 0.3,
      },
    ],
    rules: [
      {
        id: 'rule_talk_guide_starts_quest',
        name: 'Guide starts key quest',
        when: {
          op: 'and',
          all: [
            { op: 'flag', flag: 'talked_npc_warden_ghost', equals: true },
            { op: 'quest_status', questId: 'q_claim_key', status: 'locked' },
          ],
        },
        then: [
          { kind: 'set_flag', flag: 'met_guide', value: true },
          { kind: 'start_quest', questId: 'q_claim_key' },
        ],
        once: true,
        priority: 10,
      },
      {
        id: 'rule_warden_slain',
        name: 'Warden defeat marks victory',
        when: { op: 'flag', flag: 'defeated_enemy_warden', equals: true },
        then: [{ kind: 'set_flag', flag: 'dungeon_cleared', value: true }],
        once: true,
        priority: 5,
      },
    ],
    narrative: {
      flags: { met_guide: false, dungeon_cleared: false },
      beats: [
        {
          id: 'intro',
          text: 'Cold stone. A shade beckons — vault to the east, lair to the south.',
          when: { op: 'always' },
        },
      ],
      quests: [
        {
          id: 'q_claim_key',
          title: 'Claim the Ancient Key',
          description: 'Enter the vault (portal), take the key (F), then face the Warden (C).',
          giverEntityId: 'npc_warden_ghost',
          status: 'locked',
          steps: [
            {
              id: 'have_key',
              description: 'Have ancient_key in inventory',
              when: {
                op: 'and',
                all: [
                  { op: 'has_item', entityId: 'player', itemId: 'ancient_key' },
                  { op: 'flag', flag: 'talked_npc_warden_ghost', equals: true },
                ],
              },
              then: [{ kind: 'complete_quest', questId: 'q_claim_key' }],
            },
          ],
          onComplete: [
            { kind: 'set_flag', flag: 'key_claimed', value: true },
            { kind: 'emit', event: 'victory_ready' },
          ],
        },
      ],
    },
    presentation: {
      mode: 'phaser2d',
      cameraFollowPlayer: true,
      tileSize: 32,
    },
    timeHours: 22,
  });
}

/** Forest archetype — start in woods; herb gather + wolves (not a town paste). */
export function createForestWorld(options?: {
  readonly title?: string;
  readonly id?: string;
  readonly artStyleId?: string;
}): WorldSpec {
  const id = options?.id ?? `world_${Date.now().toString(36)}`;
  return parseWorldSpec({
    meta: {
      id,
      title: options?.title ?? 'Whisperwood',
      version: 1,
      summary:
        'Wander the deep woods, gather moon herbs for the druid, and survive the wolves.',
    },
    styleAnchor: scaffoldStyleAnchor({
      ...(options?.artStyleId ? { artStyleId: options.artStyleId } : {}),
      flavour: 'deep misty woodland',
      palette: ['#1b4332', '#40916c', '#d8f3dc'],
      mood: 'misty wilderness',
    }),
    space: {
      regions: [
        {
          id: 'deep_woods',
          name: 'Deep Woods',
          kind: 'wilderness',
          width: 22,
          height: 16,
          description: 'Mossy trails under a canopy of whispers.',
          tags: ['forest', 'start'],
        },
        {
          id: 'moon_clearing',
          name: 'Moon Clearing',
          kind: 'wilderness',
          width: 14,
          height: 12,
          description: 'A silver glade where herbs bloom.',
          tags: ['clearing'],
        },
        {
          id: 'old_ruins',
          name: 'Old Ruins',
          kind: 'other',
          width: 16,
          height: 12,
          description: 'Crumbling stones claimed by roots.',
          tags: ['ruins'],
        },
      ],
      portals: [
        {
          id: 'portal_woods_clearing',
          fromRegionId: 'deep_woods',
          toRegionId: 'moon_clearing',
          fromPos: { x: 20, y: 8 },
          toPos: { x: 1, y: 6 },
          label: 'Clearing',
        },
        {
          id: 'portal_clearing_woods',
          fromRegionId: 'moon_clearing',
          toRegionId: 'deep_woods',
          fromPos: { x: 1, y: 6 },
          toPos: { x: 19, y: 8 },
          label: 'Woods',
        },
        {
          id: 'portal_woods_ruins',
          fromRegionId: 'deep_woods',
          toRegionId: 'old_ruins',
          fromPos: { x: 11, y: 14 },
          toPos: { x: 8, y: 1 },
          label: 'Ruins',
        },
        {
          id: 'portal_ruins_woods',
          fromRegionId: 'old_ruins',
          toRegionId: 'deep_woods',
          fromPos: { x: 8, y: 1 },
          toPos: { x: 11, y: 13 },
          label: 'Woods',
        },
      ],
      startRegionId: 'deep_woods',
      startPos: { x: 4, y: 4 },
    },
    entities: [
      {
        id: 'player',
        kind: 'player',
        name: 'Wanderer',
        regionId: 'deep_woods',
        pos: { x: 4, y: 4 },
        attrs: { hp: 12, atk: 3 },
        inventory: [],
        spriteKey: '🧭',
      },
      {
        id: 'npc_druid',
        kind: 'npc',
        name: 'Mosswhisper',
        regionId: 'deep_woods',
        pos: { x: 9, y: 6 },
        personality: 'patient forest keeper',
        dialogueSeed: 'Bring moon herbs from the clearing — wolves guard the path.',
        attrs: { role: 'druid' },
        inventory: [],
        spriteKey: '🌿',
      },
      {
        id: 'item_moon_herb',
        kind: 'item',
        name: 'Moon Herb',
        regionId: 'moon_clearing',
        pos: { x: 7, y: 6 },
        attrs: { itemId: 'moon_herb' },
        inventory: [],
        tags: ['quest'],
        spriteKey: '🌸',
      },
      {
        id: 'enemy_wolf_pack',
        kind: 'enemy',
        name: 'Mist Wolf',
        regionId: 'deep_woods',
        pos: { x: 16, y: 10 },
        attrs: { hp: 9, atk: 3 },
        inventory: ['wolf_fang'],
        dialogueSeed: 'Awooo!',
        spriteKey: '🐺',
      },
      {
        id: 'enemy_ruin_spirit',
        kind: 'enemy',
        name: 'Root Spirit',
        regionId: 'old_ruins',
        pos: { x: 8, y: 6 },
        attrs: { hp: 12, atk: 3 },
        inventory: [],
        dialogueSeed: '…',
        spriteKey: '🌳',
      },
    ],
    relations: [
      {
        id: 'rel_player_druid',
        from: 'player',
        to: 'npc_druid',
        type: 'knows',
        strength: 0.25,
      },
    ],
    rules: [
      {
        id: 'rule_talk_druid_starts_quest',
        name: 'Druid starts herb quest',
        when: {
          op: 'and',
          all: [
            { op: 'flag', flag: 'talked_npc_druid', equals: true },
            { op: 'quest_status', questId: 'q_moon_herbs', status: 'locked' },
          ],
        },
        then: [
          { kind: 'set_flag', flag: 'met_druid', value: true },
          { kind: 'start_quest', questId: 'q_moon_herbs' },
        ],
        once: true,
        priority: 10,
      },
    ],
    narrative: {
      flags: { met_druid: false },
      beats: [
        {
          id: 'intro',
          text: 'Mist curls between the trees. A druid waits nearby — herbs glow in the eastern clearing.',
          when: { op: 'always' },
        },
      ],
      quests: [
        {
          id: 'q_moon_herbs',
          title: 'Gather Moon Herbs',
          description: 'Reach the clearing, pick moon herbs (F), return to Mosswhisper (E).',
          giverEntityId: 'npc_druid',
          status: 'locked',
          steps: [
            {
              id: 'deliver_herbs',
              description: 'Have moon_herb in inventory',
              when: {
                op: 'and',
                all: [
                  { op: 'has_item', entityId: 'player', itemId: 'moon_herb' },
                  { op: 'flag', flag: 'talked_npc_druid', equals: true },
                ],
              },
              then: [{ kind: 'complete_quest', questId: 'q_moon_herbs' }],
            },
          ],
          onComplete: [
            { kind: 'set_flag', flag: 'druid_helped', value: true },
            {
              kind: 'remove_item',
              entityId: 'player',
              itemId: 'moon_herb',
            },
            { kind: 'emit', event: 'victory_ready' },
          ],
        },
      ],
    },
    presentation: {
      mode: 'phaser2d',
      cameraFollowPlayer: true,
      tileSize: 32,
    },
    timeHours: 18,
  });
}

/** Compact gameplay checklist for UI / quality gates. */
export function toGameplayManifest(world: WorldSpec): {
  title: string;
  regions: number;
  npcs: number;
  enemies: number;
  items: number;
  quests: number;
  portals: number;
  hasCombat: boolean;
  hasInventoryLoop: boolean;
  winCondition: string;
  controls: string[];
} {
  const questTitle = world.narrative.quests[0]?.title;
  const npcs = world.entities.filter((e) => e.kind === 'npc').length;
  const enemies = world.entities.filter((e) => e.kind === 'enemy').length;
  const quests = world.narrative.quests.length;
  const societyFirst = enemies === 0 && quests === 0 && npcs >= 2;
  return {
    title: world.meta.title,
    regions: world.space.regions.length,
    npcs,
    enemies,
    items: world.entities.filter((e) => e.kind === 'item').length,
    quests,
    portals: world.space.portals.length,
    hasCombat: enemies > 0,
    hasInventoryLoop: world.entities.some((e) => e.kind === 'item'),
    winCondition: societyFirst
      ? 'Observe society (no win condition)'
      : questTitle
        ? `Complete quest: ${questTitle}`
        : 'Complete active quests',
    controls: societyFirst
      ? [
          'Watch residents on map',
          'Fast-forward timeline',
          'Whisper intervene',
          'SPACE pause · ←→ scrub',
        ]
      : [
          'Arrows move',
          'E talk',
          'F pickup',
          'C combat',
          'T advance time',
          'Q quest log',
        ],
  };
}

/** True when URL can be shown by browser cinematic layer (img or video). */
export function isPlayableSpatialUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  if (url.startsWith('file:')) return false;
  if (url.startsWith('data:application/json')) return false;
  if (/\.json(\?|$)/i.test(url)) return false;
  if (url.startsWith('data:image/') || url.startsWith('data:video/')) return true;
  return /\.(png|webp|jpe?g|gif|mp4|webm|ogg)(\?|$)/i.test(url);
}

export function spatialSlotPlayable(slot: {
  videoUrl?: string;
  assetUrl?: string;
} | null | undefined): boolean {
  if (!slot) return false;
  return (
    isPlayableSpatialUrl(slot.videoUrl) || isPlayableSpatialUrl(slot.assetUrl)
  );
}

/** L3 presentation summary — Spec SSOT for World tip / WorldPanel (not gameplay authority). */
export function toL3PresentationManifest(world: WorldSpec): {
  backend: string | null;
  lingbotMode: 'mock' | 'real' | null;
  cinematicEnabled: boolean;
  plannerSource: string | null;
  regionsWithVideo: string[];
  clipCount: number;
} {
  const assets = world.presentation.spatialAssets ?? {};
  const regionsWithVideo = Object.entries(assets)
    .filter(([, a]) => spatialSlotPlayable(a))
    .map(([id]) => id);
  return {
    backend: world.presentation.spatialBackend ?? null,
    lingbotMode: world.presentation.lingbotMode ?? null,
    cinematicEnabled: Boolean(world.presentation.cinematicEnabled),
    plannerSource: world.presentation.plannerSource ?? null,
    regionsWithVideo,
    clipCount: regionsWithVideo.length,
  };
}

/** L2 agentic expansion — product-visible world-model gain. */
export function toL2PresentationManifest(world: WorldSpec): {
  opsApplied: number;
  regionsDelta: number;
  questsDelta: number;
  rulesDelta: number;
  narrativeSeed: string | null;
  /** True when presentation.agenticDiff was stamped (ops may be 0). */
  ran: boolean;
} | null {
  const d = world.presentation.agenticDiff;
  if (!d) return null;
  return {
    opsApplied: d.opsApplied,
    regionsDelta: d.afterRegions - d.beforeRegions,
    questsDelta: d.afterQuests - d.beforeQuests,
    rulesDelta: d.afterRules - d.beforeRules,
    narrativeSeed: world.presentation.narrativeSeed ?? null,
    ran: true,
  };
}
