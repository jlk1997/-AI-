/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';
import {
  EntitySchema,
  RegionSchema,
  QuestSchema,
  GenreClockSchema,
  GenreProfileSchema,
  parseWorldSpec,
  validateWorldSpec,
  TOWN_GENRE_PROFILE,
  type Entity,
  type Region,
  type WorldSpec,
} from '@opengame/world-spec';

export const WorldOpSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('expand_region'),
    region: RegionSchema,
  }),
  z.object({
    op: z.literal('add_region'),
    region: RegionSchema,
  }),
  z.object({
    op: z.literal('edit_entity'),
    entityId: z.string(),
    patch: EntitySchema.partial().omit({ id: true }),
  }),
  z.object({
    op: z.literal('add_entity'),
    entity: EntitySchema,
  }),
  z.object({
    op: z.literal('remove_entity'),
    entityId: z.string(),
  }),
  z.object({
    op: z.literal('set_flag'),
    flag: z.string(),
    value: z.boolean(),
  }),
  z.object({
    op: z.literal('set_fact'),
    fact: z.string(),
    value: z.union([z.string(), z.number(), z.boolean()]),
  }),
  z.object({
    op: z.literal('reshape_layout'),
    regionId: z.string(),
    layoutAscii: z.string(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
  }),
  z.object({
    op: z.literal('combine_worlds'),
    other: z.unknown(),
    /** Prefix applied to imported region/entity ids to avoid collisions. */
    idPrefix: z.string().default('imported_'),
  }),
  z.object({
    op: z.literal('edit_region'),
    regionId: z.string(),
    patch: RegionSchema.partial().omit({ id: true }),
  }),
  z.object({
    op: z.literal('add_quest'),
    quest: QuestSchema,
  }),
  z.object({
    op: z.literal('edit_dialogue'),
    entityId: z.string(),
    dialogueSeed: z.string(),
  }),
  z.object({
    op: z.literal('set_genre_profile'),
    profile: GenreProfileSchema,
  }),
  z.object({
    op: z.literal('set_clock'),
    clock: GenreClockSchema,
  }),
]);

export type WorldOp = z.infer<typeof WorldOpSchema>;

export interface WorldRevision {
  readonly revision: number;
  readonly parentRevision: number | null;
  readonly op: WorldOp | { op: 'create' };
  readonly world: WorldSpec;
  readonly createdAt: string;
  readonly summary: string;
}

export interface ApplyOpResult {
  readonly ok: boolean;
  readonly world?: WorldSpec;
  readonly revision?: WorldRevision;
  readonly issues: string[];
  /** Entity/region ids that need asset regen. */
  readonly dirtyAssetKeys: string[];
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function bumpVersion(world: WorldSpec): WorldSpec {
  return {
    ...world,
    meta: { ...world.meta, version: world.meta.version + 1 },
  };
}

function attachSpokeToStart(world: WorldSpec, region: Region): void {
  const hub =
    world.space.regions.find((r) => r.id === world.space.startRegionId) ??
    world.space.regions[0];
  if (!hub || hub.id === region.id) return;
  const existing = new Set(world.space.portals.map((p) => p.id));
  const fwd = `portal_${hub.id}_${region.id}`;
  const back = `portal_${region.id}_${hub.id}`;
  if (!existing.has(fwd)) {
    world.space.portals.push({
      id: fwd,
      fromRegionId: hub.id,
      toRegionId: region.id,
      fromPos: {
        x: Math.max(1, hub.width - 2),
        y: Math.max(1, Math.floor(hub.height / 2)),
      },
      toPos: {
        x: 2,
        y: Math.max(1, Math.floor(region.height / 2)),
      },
      label: region.name,
    });
  }
  if (!existing.has(back)) {
    world.space.portals.push({
      id: back,
      fromRegionId: region.id,
      toRegionId: hub.id,
      fromPos: {
        x: 2,
        y: Math.max(1, Math.floor(region.height / 2)),
      },
      toPos: {
        x: Math.max(1, hub.width - 3),
        y: Math.max(1, Math.floor(hub.height / 2)),
      },
      label: hub.name,
    });
  }
  if (!world.space.areas) world.space.areas = [];
  if (!world.space.areas.some((a) => a.regionId === region.id)) {
    world.space.areas.push({
      id: `area_${region.id}`,
      name: region.name,
      regionId: region.id,
      objects: [
        {
          id: `obj_${region.id}_main`,
          name: region.name,
          state: '刚有人来过',
          tags: [],
        },
      ],
    });
  }
}

export function applyWorldOp(
  world: WorldSpec,
  opInput: unknown,
  options?: { readonly parentRevision?: number },
): ApplyOpResult {
  const parsed = WorldOpSchema.safeParse(opInput);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map(
        (i) => `${i.path.join('.')}: ${i.message}`,
      ),
      dirtyAssetKeys: [],
    };
  }
  const op = parsed.data;
  let next = clone(world);
  const dirtyAssetKeys: string[] = [];
  const issues: string[] = [];

  switch (op.op) {
    case 'expand_region': {
      if (next.space.regions.some((r) => r.id === op.region.id)) {
        issues.push(`region ${op.region.id} already exists`);
        break;
      }
      next.space.regions.push(op.region as Region);
      dirtyAssetKeys.push(`region:${op.region.id}`);
      break;
    }
    case 'add_region': {
      if (next.space.regions.some((r) => r.id === op.region.id)) {
        issues.push(`region ${op.region.id} already exists`);
        break;
      }
      next.space.regions.push(op.region as Region);
      attachSpokeToStart(next, op.region as Region);
      dirtyAssetKeys.push(`region:${op.region.id}`);
      break;
    }
    case 'edit_region': {
      const idx = next.space.regions.findIndex((r) => r.id === op.regionId);
      if (idx < 0) {
        issues.push(`region ${op.regionId} not found`);
        break;
      }
      next.space.regions[idx] = {
        ...next.space.regions[idx],
        ...op.patch,
      } as Region;
      dirtyAssetKeys.push(`region:${op.regionId}`);
      break;
    }
    case 'edit_entity': {
      const idx = next.entities.findIndex((e) => e.id === op.entityId);
      if (idx < 0) {
        issues.push(`entity ${op.entityId} not found`);
        break;
      }
      next.entities[idx] = {
        ...next.entities[idx],
        ...op.patch,
      } as Entity;
      dirtyAssetKeys.push(`entity:${op.entityId}`);
      break;
    }
    case 'add_entity': {
      if (next.entities.some((e) => e.id === op.entity.id)) {
        issues.push(`entity ${op.entity.id} already exists`);
        break;
      }
      let entity = op.entity as Entity;
      if (!next.space.regions.some((r) => r.id === entity.regionId)) {
        entity = { ...entity, regionId: next.space.startRegionId };
      }
      next.entities.push(entity);
      dirtyAssetKeys.push(`entity:${entity.id}`);
      break;
    }
    case 'remove_entity': {
      next.entities = next.entities.filter((e) => e.id !== op.entityId);
      next.relations = next.relations.filter(
        (r) => r.from !== op.entityId && r.to !== op.entityId,
      );
      break;
    }
    case 'set_flag':
      next.narrative.flags[op.flag] = op.value;
      break;
    case 'set_fact':
      next.entities = next.entities.map((e) =>
        e.id === 'player'
          ? { ...e, attrs: { ...e.attrs, [`fact_${op.fact}`]: op.value } }
          : e,
      );
      break;
    case 'add_quest': {
      if (next.narrative.quests.some((q) => q.id === op.quest.id)) {
        issues.push(`quest ${op.quest.id} already exists`);
        break;
      }
      next.narrative.quests.push(op.quest);
      break;
    }
    case 'edit_dialogue': {
      const idx = next.entities.findIndex((e) => e.id === op.entityId);
      if (idx < 0) {
        issues.push(`entity ${op.entityId} not found`);
        break;
      }
      next.entities[idx] = {
        ...next.entities[idx],
        dialogueSeed: op.dialogueSeed,
      } as Entity;
      dirtyAssetKeys.push(`entity:${op.entityId}`);
      break;
    }
    case 'set_genre_profile': {
      next.presentation = {
        ...next.presentation,
        genreProfile: op.profile,
      };
      break;
    }
    case 'set_clock': {
      const prev = next.presentation.genreProfile ?? TOWN_GENRE_PROFILE;
      next.presentation = {
        ...next.presentation,
        genreProfile: { ...prev, clock: op.clock },
      };
      break;
    }
    case 'reshape_layout': {
      const idx = next.space.regions.findIndex((r) => r.id === op.regionId);
      if (idx < 0) {
        issues.push(`region ${op.regionId} not found`);
        break;
      }
      const region = next.space.regions[idx]!;
      next.space.regions[idx] = {
        ...region,
        layoutAscii: op.layoutAscii,
        width: op.width ?? region.width,
        height: op.height ?? region.height,
      };
      dirtyAssetKeys.push(`region:${op.regionId}`);
      break;
    }
    case 'combine_worlds': {
      const otherResult = validateWorldSpec(op.other);
      if (!otherResult.ok || !otherResult.world) {
        issues.push(
          ...otherResult.issues.map((i) => `other.${i.path}: ${i.message}`),
        );
        break;
      }
      const other = otherResult.world;
      const prefix = op.idPrefix;
      for (const r of other.space.regions) {
        const id = `${prefix}${r.id}`;
        if (next.space.regions.some((x) => x.id === id)) continue;
        next.space.regions.push({ ...r, id });
        dirtyAssetKeys.push(`region:${id}`);
      }
      for (const e of other.entities) {
        if (e.kind === 'player') continue;
        const id = `${prefix}${e.id}`;
        if (next.entities.some((x) => x.id === id)) continue;
        next.entities.push({
          ...e,
          id,
          regionId: `${prefix}${e.regionId}`,
        });
        dirtyAssetKeys.push(`entity:${id}`);
      }
      break;
    }
    default:
      issues.push('unknown op');
  }

  if (issues.length > 0) {
    return { ok: false, issues, dirtyAssetKeys: [] };
  }

  next = bumpVersion(next);
  const validated = validateWorldSpec(next);
  if (!validated.ok || !validated.world) {
    return {
      ok: false,
      issues: validated.issues.map((i) => `${i.path}: ${i.message}`),
      dirtyAssetKeys: [],
    };
  }

  const parentRevision = options?.parentRevision ?? world.meta.version - 1;
  const revision: WorldRevision = {
    revision: validated.world.meta.version,
    parentRevision: parentRevision >= 0 ? parentRevision : null,
    op,
    world: validated.world,
    createdAt: new Date().toISOString(),
    summary: summarizeOp(op),
  };

  return {
    ok: true,
    world: validated.world,
    revision,
    issues: [],
    dirtyAssetKeys,
  };
}

export function summarizeOp(op: WorldOp | { op: 'create' }): string {
  switch (op.op) {
    case 'create':
      return 'create world';
    case 'expand_region':
      return `expand region ${op.region.id}`;
    case 'add_region':
      return `add region ${op.region.id}`;
    case 'edit_region':
      return `edit region ${op.regionId}`;
    case 'edit_entity':
      return `edit entity ${op.entityId}`;
    case 'add_entity':
      return `add entity ${op.entity.id}`;
    case 'remove_entity':
      return `remove entity ${op.entityId}`;
    case 'set_flag':
      return `set flag ${op.flag}=${op.value}`;
    case 'set_fact':
      return `set fact ${op.fact}`;
    case 'add_quest':
      return `add quest ${op.quest.id}`;
    case 'edit_dialogue':
      return `edit dialogue ${op.entityId}`;
    case 'set_genre_profile':
      return `set genre profile ${op.profile.id}`;
    case 'set_clock':
      return `set clock ${op.clock.kind}`;
    case 'reshape_layout':
      return `reshape ${op.regionId}`;
    case 'combine_worlds':
      return `combine worlds (prefix=${op.idPrefix})`;
    default:
      return 'op';
  }
}

export class WorldRevisionTree {
  private revisions: WorldRevision[] = [];

  constructor(initial: WorldSpec) {
    const world = parseWorldSpec(initial);
    this.revisions.push({
      revision: world.meta.version,
      parentRevision: null,
      op: { op: 'create' },
      world,
      createdAt: new Date().toISOString(),
      summary: 'create world',
    });
  }

  get tip(): WorldRevision {
    return this.revisions[this.revisions.length - 1]!;
  }

  get history(): readonly WorldRevision[] {
    return this.revisions;
  }

  apply(op: unknown): ApplyOpResult {
    const result = applyWorldOp(this.tip.world, op, {
      parentRevision: this.tip.revision,
    });
    if (result.ok && result.revision) {
      this.revisions.push(result.revision);
    }
    return result;
  }

  rollback(toRevision: number): ApplyOpResult {
    const target = this.revisions.find((r) => r.revision === toRevision);
    if (!target) {
      return {
        ok: false,
        issues: [`revision ${toRevision} not found`],
        dirtyAssetKeys: [],
      };
    }
    const rolled = bumpVersion(clone(target.world));
    const revision: WorldRevision = {
      revision: rolled.meta.version,
      parentRevision: this.tip.revision,
      op: { op: 'create' },
      world: rolled,
      createdAt: new Date().toISOString(),
      summary: `rollback to r${toRevision}`,
    };
    this.revisions.push(revision);
    return {
      ok: true,
      world: rolled,
      revision,
      issues: [],
      dirtyAssetKeys: [],
    };
  }
}
