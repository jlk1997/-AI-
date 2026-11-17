/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * World Spec → Game seed compiler.
 *
 * This is the bridge that turns the L1 World Spec from a *prompt hint* into the
 * game's structural source of truth: regions become Phaser scenes, entities
 * become DSL entities with runtime behaviors, portals become scene transitions,
 * quests become dialogue + win conditions, and the style anchor becomes the
 * MiniMax asset brief.
 *
 * Hard requirements:
 * - **Deterministic**: same Spec in, byte-identical seed out (no clock, no RNG).
 * - **Dependency-free**: mirrors `@opengame/runtime` DSL 1.0.0 structurally so
 *   world-spec stays a leaf package (the runtime validates it at load time).
 */

import type { Entity, Quest, Region, Vec2, WorldSpec } from './schema.js';
import { shortDisplayTitle } from './schema.js';
import { resolveArtStyle } from './artStyle.js';

export const WORLD_GAME_SEED_SCHEMA = 'opengame.world-game-seed/1' as const;

/** Mirrors `@opengame/runtime` `DSL_VERSION`. */
export const SEED_DSL_VERSION = '1.0.0' as const;

/**
 * 1280x720 rather than 960x640. Scale.FIT upscaled the smaller backbuffer on
 * any modern display, so every asset was resampled up and read as mush.
 */
const CANVAS = { width: 1280, height: 720 } as const;
/** Playfield inset so entities never sit on the canvas edge. */
const PAD = 48;
/** Top strip reserved for the HUD score line. */
const HUD_RESERVE = 44;

const FALLBACK_PALETTE = ['#1f2937', '#38bdf8', '#f59e0b'] as const;
const ENEMY_COLOR = '#ef4444';
const ITEM_COLOR = '#fbbf24';
const PORTAL_COLOR = '#22d3ee';
const PROP_COLOR = '#94a3b8';
const TRIGGER_COLOR = '#c084fc';

export interface SeedSprite {
  x: number;
  y: number;
  shape?: 'rect' | 'circle';
  color?: string;
  width?: number;
  height?: number;
  depth?: number;
  assetId?: string;
}

export interface SeedBehavior {
  kind: string;
  options?: Record<string, unknown>;
}

export interface SeedTunable {
  type: 'number';
  value: number;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
}

export interface SeedEntity {
  id: string;
  tags: string[];
  sprite: SeedSprite;
  behaviors?: SeedBehavior[];
  skills?: string[];
  state?: Record<string, number>;
  tunables?: Record<string, SeedTunable>;
}

export interface SeedScene {
  id: string;
  title: string;
  background?: { type: 'color'; color: number };
  hud?: { score?: boolean };
  entities: SeedEntity[];
  /**
   * World-region layout carrier for WorldScene — not a playable Phaser DSL scene.
   * Engine shells (Title/World) use customModule; regions use layoutOnly.
   */
  layoutOnly?: boolean;
}

export interface SeedDialogueLine {
  id?: string;
  group?: string;
  speaker?: string;
  text: string;
}

export interface SeedSkill {
  id: string;
  trigger: { kind: string; key?: string; periodSec?: number };
  effects: Array<{ kind: string; payload?: Record<string, unknown> }>;
  cooldownSec?: number;
}

/** Structural mirror of `GameDsl` — plain JSON, ready for `public/game.json`. */
export interface SeedGameDsl {
  dslVersion: string;
  meta: {
    title: string;
    description?: string;
    genre?: string;
    orientation: 'landscape' | 'portrait';
    canvas: { width: number; height: number; background: string };
    /** Picked art style profile id, for provenance. */
    artStyleId?: string;
    /** Drives Phaser `pixelArt` / `roundPixels` in the runtime bootstrap. */
    pixelPerfect?: boolean;
  };
  rules: { win: string; lose: string; scoreLabel: string };
  dialogue: SeedDialogueLine[];
  skills: SeedSkill[];
  scenes: SeedScene[];
  initialSceneId: string;
}

export interface SeedSceneExit {
  portalId: string;
  toRegionId: string;
  toSceneId: string;
  label: string;
  x: number;
  y: number;
}

export interface SeedScenePlan {
  regionId: string;
  sceneId: string;
  title: string;
  kind: Region['kind'];
  isStart: boolean;
  /** Suggested Phaser class name if the Coder promotes this scene to TS. */
  className: string;
  fileName: string;
  gridCols: number;
  gridRows: number;
  cellSize: number;
  originX: number;
  originY: number;
  entityIds: string[];
  exits: SeedSceneExit[];
}

export interface SeedLineage {
  worldId: string;
  worldTitle: string;
  worldVersion: number;
  initialSceneId: string;
  regionIds: string[];
  entityIds: string[];
  questIds: string[];
  ruleIds: string[];
  portalIds: string[];
  sceneIdByRegionId: Record<string, string>;
}

export interface SeedAssetBrief {
  artStyle: string;
  palette: string[];
  mood: string | null;
  stylePrompt: string;
  prompts: {
    player: string;
    enemy: string;
    item: string;
    background: string;
  };
  regionBackgroundPrompts: Record<string, string>;
}

export interface SeedStats {
  regions: number;
  entities: number;
  npcs: number;
  enemies: number;
  items: number;
  quests: number;
  portals: number;
  rules: number;
  scenes: number;
}

export interface WorldGameSeed {
  schema: typeof WORLD_GAME_SEED_SCHEMA;
  worldId: string;
  worldTitle: string;
  worldVersion: number;
  narrativeSeed: string | null;
  game: SeedGameDsl;
  lineage: SeedLineage;
  scenePlan: SeedScenePlan[];
  assetBrief: SeedAssetBrief;
  tunables: Record<string, number>;
  tunablesSource: string | null;
  stats: SeedStats;
  summaryLines: string[];
}

export interface CompileWorldOptions {
  /**
   * Difficulty knobs, typically from the L2 neural world model. Unknown or
   * non-finite entries are ignored so a bad model never breaks the build.
   */
  readonly tunables?: Readonly<Record<string, number>>;
  /** Provenance label recorded in the seed, e.g. `l2-hybrid-world-model`. */
  readonly tunablesSource?: string | null;
}

export const DEFAULT_SEED_TUNABLES = {
  playerSpeed: 190,
  enemySpeed: 46,
  enemyChaseRange: 340,
  enemyHpScale: 1,
  itemScore: 10,
  /** Starting player HP mirrored into scene registry for lose conditions. */
  playerHp: 12,
  /** Damage dealt per enemy contact (DamageOnTouch). */
  contactDamage: 1,
} as const;

export type SeedTunableKey = keyof typeof DEFAULT_SEED_TUNABLES;

const TUNABLE_BOUNDS: Record<SeedTunableKey, { min: number; max: number }> = {
  playerSpeed: { min: 60, max: 420 },
  enemySpeed: { min: 10, max: 260 },
  enemyChaseRange: { min: 80, max: 900 },
  enemyHpScale: { min: 0.4, max: 3 },
  itemScore: { min: 1, max: 100 },
  playerHp: { min: 3, max: 99 },
  contactDamage: { min: 1, max: 20 },
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function resolveTunables(
  world: WorldSpec,
  options: CompileWorldOptions | undefined,
): Record<string, number> {
  const out: Record<string, number> = { ...DEFAULT_SEED_TUNABLES };
  const incoming = options?.tunables ?? world.presentation.difficultyTunables;
  if (!incoming) return out;
  for (const key of Object.keys(DEFAULT_SEED_TUNABLES) as SeedTunableKey[]) {
    const raw = incoming[key];
    if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
    const bounds = TUNABLE_BOUNDS[key];
    const rounded =
      key === 'enemyHpScale'
        ? Math.round(clamp(raw, bounds.min, bounds.max) * 100) / 100
        : Math.round(clamp(raw, bounds.min, bounds.max));
    out[key] = rounded;
  }
  return out;
}

function resolvePlayerHp(
  player: Entity | null | undefined,
  tunables: Record<string, number>,
  world: WorldSpec,
  options: CompileWorldOptions | undefined,
): number {
  // Explicit L2 / compile options win — otherwise neural playerHp never lands.
  const stamped =
    options?.tunables?.['playerHp'] ??
    world.presentation.difficultyTunables?.['playerHp'];
  if (typeof stamped === 'number' && Number.isFinite(stamped)) {
    return Math.round(tunables['playerHp'] ?? stamped);
  }
  const fromAttr = player ? numericAttr(player, 'hp') : null;
  if (fromAttr !== null && fromAttr > 0) return Math.round(fromAttr);
  return Math.round(tunables['playerHp'] ?? DEFAULT_SEED_TUNABLES.playerHp);
}

function resolveEnemyHp(entity: Entity, hpScale: number): number {
  const base = numericAttr(entity, 'hp') ?? 8;
  return Math.max(1, Math.round(base * hpScale));
}

function slugify(raw: string, fallback: string): string {
  const s = raw
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return s.length > 0 ? s : fallback;
}

function pascalCase(raw: string): string {
  const parts = raw.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  if (parts.length === 0) return 'Region';
  return parts
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join('');
}

function normalizePalette(palette: readonly string[]): string[] {
  const hex = palette.filter((c) => /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(c));
  return hex.length > 0 ? hex : [...FALLBACK_PALETTE];
}

function hexToInt(hex: string): number {
  const raw = hex.replace('#', '');
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw;
  const n = Number.parseInt(full, 16);
  return Number.isFinite(n) ? n : 0x0f172a;
}

function darkenInt(hex: string, factor: number): number {
  const n = hexToInt(hex);
  const r = Math.round(((n >> 16) & 0xff) * factor);
  const g = Math.round(((n >> 8) & 0xff) * factor);
  const b = Math.round((n & 0xff) * factor);
  return (r << 16) | (g << 8) | b;
}

interface RegionLayout {
  cols: number;
  rows: number;
  cell: number;
  originX: number;
  originY: number;
}

function layoutFor(region: Region): RegionLayout {
  const cols = Math.round(clamp(region.width, 4, 160));
  const rows = Math.round(clamp(region.height, 4, 160));
  const availW = CANVAS.width - PAD * 2;
  const availH = CANVAS.height - PAD * 2 - HUD_RESERVE;
  const cell = Math.max(
    14,
    Math.min(48, Math.floor(availW / cols), Math.floor(availH / rows)),
  );
  const originX = Math.round((CANVAS.width - cell * cols) / 2);
  const originY = Math.round(
    HUD_RESERVE + (CANVAS.height - HUD_RESERVE - cell * rows) / 2,
  );
  return { cols, rows, cell, originX, originY };
}

function toPixel(layout: RegionLayout, pos: Vec2): { x: number; y: number } {
  const cx = clamp(Math.round(pos.x), 0, layout.cols - 1);
  const cy = clamp(Math.round(pos.y), 0, layout.rows - 1);
  return {
    x: Math.round(layout.originX + (cx + 0.5) * layout.cell),
    y: Math.round(layout.originY + (cy + 0.5) * layout.cell),
  };
}

function numericAttr(entity: Entity, key: string): number | null {
  const raw = entity.attrs[key];
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** Spawn point for a region: the world start, else a portal arrival nudged inward. */
function spawnPosFor(
  world: WorldSpec,
  region: Region,
  player: Entity | null,
): Vec2 {
  if (region.id === world.space.startRegionId) {
    return player && player.regionId === region.id
      ? player.pos
      : world.space.startPos;
  }
  const arrival = world.space.portals.find((p) => p.toRegionId === region.id);
  const center = { x: Math.floor(region.width / 2), y: Math.floor(region.height / 2) };
  if (!arrival) return center;
  // Step two tiles from the arrival portal toward the centre so the return
  // portal is not already in trigger range on spawn.
  const dx = Math.sign(center.x - arrival.toPos.x);
  const dy = Math.sign(center.y - arrival.toPos.y);
  return {
    x: arrival.toPos.x + (dx === 0 ? 2 : dx * 2),
    y: arrival.toPos.y + (dy === 0 ? 2 : dy * 2),
  };
}

function questLineFor(quest: Quest, giverName: string | null): SeedDialogueLine {
  const desc = quest.description.trim();
  const text = desc ? `${quest.title} — ${desc}` : quest.title;
  return {
    id: quest.id,
    group: 'quest_log',
    ...(giverName ? { speaker: giverName } : {}),
    text,
  };
}

function ruleSkillEffects(
  rule: WorldSpec['rules'][number],
): SeedSkill['effects'] {
  const effects: SeedSkill['effects'] = [];
  for (const effect of rule.then) {
    if (effects.length >= 4) break;
    switch (effect.kind) {
      case 'set_flag':
        effects.push({
          kind: 'setState',
          payload: { key: `flag.${effect.flag}`, value: effect.value },
        });
        break;
      case 'set_attr':
        effects.push({
          kind: 'setState',
          payload: {
            key: `attr.${effect.entityId}.${effect.key}`,
            value: effect.value,
          },
        });
        break;
      case 'give_item':
        effects.push({
          kind: 'setState',
          payload: { key: `inventory.${effect.itemId}`, value: true },
        });
        break;
      case 'remove_item':
        effects.push({
          kind: 'setState',
          payload: { key: `inventory.${effect.itemId}`, value: false },
        });
        break;
      case 'start_quest':
        effects.push({
          kind: 'setState',
          payload: { key: `quest.${effect.questId}`, value: 'active' },
        });
        break;
      case 'complete_quest':
        effects.push({
          kind: 'setState',
          payload: { key: `quest.${effect.questId}`, value: 'completed' },
        });
        break;
      case 'fail_quest':
        effects.push({
          kind: 'setState',
          payload: { key: `quest.${effect.questId}`, value: 'failed' },
        });
        break;
      case 'move_entity':
        effects.push({
          kind: 'emit',
          payload: {
            event: 'world:moveEntity',
            entityId: effect.entityId,
            regionId: effect.regionId,
          },
        });
        break;
      case 'advance_time':
        effects.push({
          kind: 'emit',
          payload: { event: 'world:advanceTime', hours: effect.hours },
        });
        break;
      default:
        effects.push({
          kind: 'emit',
          payload: { event: `world:${effect.event}` },
        });
        break;
    }
  }
  if (effects.length === 0) {
    effects.push({ kind: 'emit', payload: { event: `world:${rule.id}` } });
  }
  return effects;
}

/**
 * Compiles a World Spec into a playable `game.json` seed plus the lineage and
 * asset metadata the worker needs. Pure and deterministic.
 */
export function compileWorldToGameSeed(
  world: WorldSpec,
  options?: CompileWorldOptions,
): WorldGameSeed {
  const tunables = resolveTunables(world, options);
  const tunablesSource =
    options?.tunablesSource ??
    (options?.tunables
      ? null
      : (world.presentation.difficultyTunablesSource ?? null));
  const palette = normalizePalette(world.styleAnchor.palette);
  const bgColor = palette[0] ?? FALLBACK_PALETTE[0];
  const playerColor = palette[1] ?? '#38bdf8';
  const npcColor = palette[2] ?? '#a78bfa';

  const player = world.entities.find((e) => e.kind === 'player') ?? null;
  const playerHp = resolvePlayerHp(player, tunables, world, options);
  // Prefer stamped contactDamage; fall back to enemy atk only per-entity later.
  const contactDamage = Math.max(
    1,
    Math.round(tunables['contactDamage'] ?? DEFAULT_SEED_TUNABLES.contactDamage),
  );
  const items = world.entities.filter((e) => e.kind === 'item');
  const enemies = world.entities.filter((e) => e.kind === 'enemy');
  const npcs = world.entities.filter((e) => e.kind === 'npc');
  const itemScore = tunables['itemScore'] ?? DEFAULT_SEED_TUNABLES.itemScore;
  const winScore = items.length > 0 ? items.length * itemScore : 0;

  // Region → scene ids (unique, slug-safe for Phaser keys).
  const sceneIdByRegionId: Record<string, string> = {};
  const usedSceneIds = new Set<string>();
  world.space.regions.forEach((region, index) => {
    const base = slugify(region.id, `region_${index}`);
    let id = base;
    let n = 0;
    while (usedSceneIds.has(id)) {
      n += 1;
      id = `${base}_${n}`;
    }
    usedSceneIds.add(id);
    sceneIdByRegionId[region.id] = id;
  });

  const startSceneId =
    sceneIdByRegionId[world.space.startRegionId] ??
    sceneIdByRegionId[world.space.regions[0]!.id]!;

  // Dialogue: NPC intros (playable at scene start) + quest log + story beats.
  const dialogue: SeedDialogueLine[] = [];
  const giverByNpcId = new Map<string, Quest>();
  for (const quest of world.narrative.quests) {
    if (quest.giverEntityId && !giverByNpcId.has(quest.giverEntityId)) {
      giverByNpcId.set(quest.giverEntityId, quest);
    }
  }
  const dialogueNpcIds = new Set<string>();
  for (const npc of npcs) {
    const quest = giverByNpcId.get(npc.id) ?? null;
    const seed = (npc.dialogueSeed ?? '').trim();
    if (!seed && !quest) continue;
    const group = `dlg_${npc.id}`;
    dialogueNpcIds.add(npc.id);
    dialogue.push({
      id: group,
      group,
      speaker: npc.name,
      text: seed || `${npc.name} has work for you.`,
    });
    if (quest) {
      const desc = quest.description.trim();
      dialogue.push({
        id: quest.id,
        group,
        speaker: npc.name,
        text: desc ? `${quest.title} — ${desc}` : quest.title,
      });
    }
  }
  const questIdsInDialogue = new Set(
    dialogue.map((line) => line.id).filter((id): id is string => Boolean(id)),
  );
  for (const quest of world.narrative.quests) {
    if (questIdsInDialogue.has(quest.id)) continue;
    const giver = quest.giverEntityId
      ? (world.entities.find((e) => e.id === quest.giverEntityId)?.name ?? null)
      : null;
    dialogue.push(questLineFor(quest, giver));
  }
  for (const beat of world.narrative.beats) {
    dialogue.push({ id: beat.id, group: 'beats', text: beat.text });
  }

  // Skills: player core loop + one manual skill per world rule (lineage + hooks).
  const skills: SeedSkill[] = [
    {
      id: 'skill_interact',
      trigger: { kind: 'onKey', key: 'E' },
      effects: [{ kind: 'emit', payload: { event: 'world:interact' } }],
      cooldownSec: 0.3,
    },
  ];
  if (enemies.length > 0) {
    skills.push({
      id: 'skill_strike',
      trigger: { kind: 'onKey', key: 'C' },
      effects: [{ kind: 'emit', payload: { event: 'world:strike' } }],
      cooldownSec: 0.4,
    });
  }
  for (const rule of world.rules) {
    skills.push({
      id: rule.id,
      trigger: { kind: 'manual' },
      effects: ruleSkillEffects(rule),
    });
  }
  const playerSkillIds = skills
    .filter((s) => s.trigger.kind === 'onKey')
    .map((s) => s.id);
  const ruleSkillIds = world.rules.map((r) => r.id);

  const scenes: SeedScene[] = [];
  const scenePlan: SeedScenePlan[] = [];
  const emittedEntityIds = new Set<string>();

  world.space.regions.forEach((region, regionIndex) => {
    const sceneId = sceneIdByRegionId[region.id]!;
    const layout = layoutFor(region);
    const isStart = region.id === world.space.startRegionId;
    const entities: SeedEntity[] = [];

    const bounds = {
      minX: layout.originX + layout.cell / 2,
      maxX: layout.originX + layout.cell * (layout.cols - 0.5),
      minY: layout.originY + layout.cell / 2,
      maxY: layout.originY + layout.cell * (layout.rows - 0.5),
      onExit: 'clamp' as const,
    };

    // 1. Player — present in every region so portals stay traversable.
    const spawn = toPixel(layout, spawnPosFor(world, region, player));
    const playerId = player?.id ?? 'player';
    const playerEntity: SeedEntity = {
      id: playerId,
      tags: ['player'],
      sprite: {
        x: spawn.x,
        y: spawn.y,
        shape: 'rect',
        color: playerColor,
        width: 34,
        height: 40,
        depth: 10,
      },
      behaviors: [
        {
          kind: 'eightWayMovement',
          options: {
            speed: tunables['playerSpeed'] ?? DEFAULT_SEED_TUNABLES.playerSpeed,
            keys: { up: 'W', down: 'S', left: 'A', right: 'D' },
          },
        },
        { kind: 'bounds', options: bounds },
      ],
      skills: isStart ? [...playerSkillIds, ...ruleSkillIds] : playerSkillIds,
      state: {
        hp: playerHp,
        ...(player && numericAttr(player, 'atk') !== null
          ? { atk: numericAttr(player, 'atk')! }
          : {}),
      },
      tunables: {
        speed: {
          type: 'number',
          value: tunables['playerSpeed'] ?? DEFAULT_SEED_TUNABLES.playerSpeed,
          min: 60,
          max: 420,
          step: 10,
          label: 'Player speed',
        },
      },
    };
    entities.push(playerEntity);
    emittedEntityIds.add(playerId);

    // 2. Region inhabitants.
    const regionEntities = world.entities.filter(
      (e) => e.regionId === region.id && e.kind !== 'player',
    );
    for (const entity of regionEntities) {
      const pos = toPixel(layout, entity.pos);
      const seedEntity: SeedEntity = {
        id: entity.id,
        tags: [entity.kind, ...entity.tags].filter(
          (t, i, arr) => t.length > 0 && arr.indexOf(t) === i,
        ),
        sprite: { x: pos.x, y: pos.y, shape: 'rect' },
      };
      switch (entity.kind) {
        case 'npc': {
          seedEntity.sprite = {
            ...seedEntity.sprite,
            color: npcColor,
            width: 30,
            height: 36,
            depth: 7,
          };
          // Every NPC with dialogueSeed/quest gets a dialog behavior.
          if (dialogueNpcIds.has(entity.id)) {
            seedEntity.behaviors = [
              {
                kind: 'dialog',
                options: { dialogueId: `dlg_${entity.id}`, autoAdvanceMs: 3400 },
              },
            ];
          }
          break;
        }
        case 'enemy': {
          const atk = numericAttr(entity, 'atk');
          const hpScale =
            tunables['enemyHpScale'] ?? DEFAULT_SEED_TUNABLES.enemyHpScale;
          const speed = tunables['enemySpeed'] ?? DEFAULT_SEED_TUNABLES.enemySpeed;
          const scaledHp = resolveEnemyHp(entity, hpScale);
          // Stamped contactDamage (L2) overrides per-enemy atk so difficulty
          // proposals change the fail state uniformly.
          const stampedContact =
            options?.tunables?.['contactDamage'] ??
            world.presentation.difficultyTunables?.['contactDamage'];
          const hitAmount =
            typeof stampedContact === 'number' && Number.isFinite(stampedContact)
              ? contactDamage
              : atk !== null
                ? Math.max(1, Math.round(atk))
                : contactDamage;
          seedEntity.sprite = {
            ...seedEntity.sprite,
            color: ENEMY_COLOR,
            width: 34,
            height: 32,
            depth: 8,
          };
          seedEntity.behaviors = [
            {
              kind: 'chase',
              options: {
                targetTag: 'player',
                speed,
                minDistance: 18,
                maxDistance:
                  tunables['enemyChaseRange'] ??
                  DEFAULT_SEED_TUNABLES.enemyChaseRange,
              },
            },
            {
              kind: 'damageOnTouch',
              options: {
                targetTag: 'player',
                range: 28,
                amount: hitAmount,
                cooldownMs: 700,
                initialHp: playerHp,
                loseAtZero: true,
              },
            },
          ];
          seedEntity.state = {
            hp: scaledHp,
            ...(atk !== null ? { atk } : {}),
          };
          seedEntity.tunables = {
            speed: {
              type: 'number',
              value: speed,
              min: 10,
              max: 260,
              step: 4,
              label: `${entity.name} speed`,
            },
          };
          break;
        }
        case 'item': {
          seedEntity.tags = [...seedEntity.tags, 'collectible'].filter(
            (t, i, arr) => arr.indexOf(t) === i,
          );
          seedEntity.sprite = {
            ...seedEntity.sprite,
            shape: 'circle',
            color: ITEM_COLOR,
            width: 24,
            height: 24,
            depth: 6,
          };
          seedEntity.behaviors = [
            {
              kind: 'collectOnTouch',
              options: {
                byTag: 'player',
                range: 26,
                score: itemScore,
                winAt: winScore,
                flag: `collected.${entity.id}`,
              },
            },
          ];
          break;
        }
        case 'trigger': {
          seedEntity.sprite = {
            ...seedEntity.sprite,
            color: TRIGGER_COLOR,
            width: 26,
            height: 26,
            depth: 2,
          };
          // Triggers become touch pads so quest / rule flags are reachable
          // without Agent-written Scene code.
          seedEntity.behaviors = [
            {
              kind: 'collectOnTouch',
              options: {
                byTag: 'player',
                range: 30,
                score: 0,
                winAt: 0,
                flag: `triggered.${entity.id}`,
              },
            },
          ];
          break;
        }
        default: {
          seedEntity.sprite = {
            ...seedEntity.sprite,
            color: PROP_COLOR,
            width: 28,
            height: 28,
            depth: 3,
          };
          break;
        }
      }
      entities.push(seedEntity);
      emittedEntityIds.add(entity.id);
    }

    // 3. Portals — real scene transitions, no agent code required.
    const exits: SeedSceneExit[] = [];
    for (const portal of world.space.portals) {
      if (portal.fromRegionId !== region.id) continue;
      const toSceneId = sceneIdByRegionId[portal.toRegionId];
      if (!toSceneId) continue;
      const pos = toPixel(layout, portal.fromPos);
      const label =
        portal.label ??
        world.space.regions.find((r) => r.id === portal.toRegionId)?.name ??
        portal.toRegionId;
      entities.push({
        id: portal.id,
        tags: ['portal', 'exit'],
        sprite: {
          x: pos.x,
          y: pos.y,
          shape: 'rect',
          color: PORTAL_COLOR,
          width: 30,
          height: 38,
          depth: 4,
        },
        behaviors: [
          {
            kind: 'sceneTransition',
            options: { targetSceneId: toSceneId, targetTag: 'player', range: 34, label },
          },
        ],
      });
      exits.push({
        portalId: portal.id,
        toRegionId: portal.toRegionId,
        toSceneId,
        label,
        x: pos.x,
        y: pos.y,
      });
    }

    scenes.push({
      id: sceneId,
      title: region.name,
      background: {
        type: 'color',
        color: darkenInt(
          palette[regionIndex % palette.length] ?? bgColor,
          0.34 + 0.06 * (regionIndex % 3),
        ),
      },
      hud: { score: true },
      entities,
      layoutOnly: true,
    });

    scenePlan.push({
      regionId: region.id,
      sceneId,
      title: region.name,
      kind: region.kind,
      isStart,
      className: `${pascalCase(region.id)}Scene`,
      fileName: `${pascalCase(region.id)}Scene.ts`,
      gridCols: layout.cols,
      gridRows: layout.rows,
      cellSize: layout.cell,
      originX: layout.originX,
      originY: layout.originY,
      entityIds: entities.map((e) => e.id),
      exits,
    });
  });

  const firstQuest = world.narrative.quests[0] ?? null;
  const win =
    winScore > 0
      ? `Collect all ${items.length} world items (score ≥ ${winScore})${
          firstQuest ? ` to finish "${firstQuest.title}"` : ''
        }`
      : firstQuest
        ? `Complete "${firstQuest.title}" (talk to NPCs / hit world triggers)`
        : 'Explore every region via portals';
  const lose =
    enemies.length > 0
      ? `HP reaches 0 (start ${playerHp}, contact −${contactDamage})`
      : 'Run out of time';

  const genre = enemies.length > 0 ? 'action-rpg' : 'exploration-adventure';
  const styleProfile = resolveArtStyle({
    id: world.styleAnchor.artStyleId,
    text: world.styleAnchor.artStyle,
  });
  const game: SeedGameDsl = {
    dslVersion: SEED_DSL_VERSION,
    meta: {
      title: shortDisplayTitle(world.meta.title),
      ...(world.meta.summary ? { description: world.meta.summary } : {}),
      genre,
      orientation: 'landscape',
      canvas: { width: CANVAS.width, height: CANVAS.height, background: bgColor },
      artStyleId: styleProfile.id,
      pixelPerfect: styleProfile.pixelPerfect,
    },
    rules: { win, lose, scoreLabel: 'Score' },
    dialogue,
    skills,
    scenes,
    initialSceneId: startSceneId,
  };

  const artStyle = world.styleAnchor.artStyle || styleProfile.artStyle;
  const mood = world.styleAnchor.mood?.trim() || null;
  const stylePrompt = [
    artStyle,
    styleProfile.promptSuffix,
    mood ? `${mood} mood` : '',
    `palette ${palette.slice(0, 4).join(' ')}`,
  ]
    .filter(Boolean)
    .join(', ');
  const regionBackgroundPrompts: Record<string, string> = {};
  for (const region of world.space.regions) {
    regionBackgroundPrompts[region.id] = [
      `${region.name} (${region.kind})`,
      region.description ?? '',
      stylePrompt,
      'game background, no text, no UI',
    ]
      .filter(Boolean)
      .join(', ');
  }
  const assetBrief: SeedAssetBrief = {
    artStyle,
    palette,
    mood,
    stylePrompt,
    prompts: {
      player: [
        player ? player.name : 'hero',
        'player character sprite, full body, centered',
        stylePrompt,
        'transparent background',
      ].join(', '),
      enemy: [
        enemies[0]?.name ?? 'hostile creature',
        'enemy sprite, full body, centered',
        stylePrompt,
        'transparent background',
      ].join(', '),
      item: [
        items[0]?.name ?? 'quest item',
        'small pickup icon, centered',
        stylePrompt,
        'transparent background',
      ].join(', '),
      background:
        regionBackgroundPrompts[world.space.startRegionId] ??
        `${stylePrompt}, game background, no text`,
    },
    regionBackgroundPrompts,
  };

  const lineage: SeedLineage = {
    worldId: world.meta.id,
    worldTitle: world.meta.title,
    worldVersion: world.meta.version,
    initialSceneId: startSceneId,
    regionIds: world.space.regions.map((r) => r.id),
    entityIds: world.entities.map((e) => e.id),
    questIds: world.narrative.quests.map((q) => q.id),
    ruleIds: world.rules.map((r) => r.id),
    portalIds: world.space.portals.map((p) => p.id),
    sceneIdByRegionId,
  };

  const stats: SeedStats = {
    regions: world.space.regions.length,
    entities: emittedEntityIds.size,
    npcs: npcs.length,
    enemies: enemies.length,
    items: items.length,
    quests: world.narrative.quests.length,
    portals: world.space.portals.length,
    rules: world.rules.length,
    scenes: scenes.length,
  };

  const seed: WorldGameSeed = {
    schema: WORLD_GAME_SEED_SCHEMA,
    worldId: world.meta.id,
    worldTitle: world.meta.title,
    worldVersion: world.meta.version,
    narrativeSeed: world.presentation.narrativeSeed ?? null,
    game,
    lineage,
    scenePlan,
    assetBrief,
    tunables,
    tunablesSource,
    stats,
    summaryLines: [],
  };
  return { ...seed, summaryLines: formatWorldSeedSummaryLines(seed) };
}

/** Timeline-friendly recap of what the world contributed to the game. */
export function formatWorldSeedSummaryLines(seed: WorldGameSeed): string[] {
  const s = seed.stats;
  const lines = [
    `由世界《${shortDisplayTitle(seed.worldTitle)}》编译：${s.regions} 区域 / ${s.entities} 实体 / ${s.quests} 任务 / ${s.portals} 传送点`,
    `场景：${seed.scenePlan.map((p) => p.sceneId).join(', ')}（起始 ${seed.lineage.initialSceneId}）`,
  ];
  if (s.rules > 0) {
    lines.push(`世界规则映射为 ${s.rules} 条技能钩子（manual 触发，供玩法脚本调用）`);
  }
  if (seed.tunablesSource) {
    lines.push(
      `难度由 ${seed.tunablesSource} 调参：敌人速度 ${seed.tunables['enemySpeed']} / 血量系数 ${seed.tunables['enemyHpScale']}`,
    );
  }
  return lines;
}

/**
 * Mirrors the worker's `checkGameDsl` + runtime `validateGameDsl` minimums so
 * the compiler can be unit-tested without importing `@opengame/runtime`.
 */
export function validateSeedGameDsl(input: unknown): string[] {
  const errors: string[] = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return ['game.json must be a JSON object'];
  }
  const dsl = input as Record<string, unknown>;
  if (typeof dsl['dslVersion'] !== 'string') errors.push('dslVersion missing');
  const meta = dsl['meta'] as Record<string, unknown> | undefined;
  if (!meta || typeof meta['title'] !== 'string') errors.push('meta.title required');
  const scenes = dsl['scenes'];
  if (!Array.isArray(scenes) || scenes.length === 0) {
    errors.push('scenes must be a non-empty array');
    return errors;
  }
  const ids = new Set<string>();
  for (const raw of scenes) {
    if (!raw || typeof raw !== 'object') {
      errors.push('scene must be an object');
      continue;
    }
    const scene = raw as Record<string, unknown>;
    const id = scene['id'];
    if (typeof id !== 'string' || id.length === 0) {
      errors.push('scene.id required');
      continue;
    }
    if (ids.has(id)) errors.push(`duplicate scene id: ${id}`);
    ids.add(id);
    if (!Array.isArray(scene['entities'])) {
      errors.push(`scene ${id} entities must be array`);
    }
  }
  const initial = dsl['initialSceneId'];
  if (typeof initial === 'string' && initial.length > 0 && !ids.has(initial)) {
    errors.push(`initialSceneId "${initial}" does not match any scene`);
  }
  return errors;
}
