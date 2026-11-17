/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  Condition,
  Effect,
  Entity,
  WorldSpec,
} from '@opengame/world-spec';

export interface SimEvent {
  readonly type: string;
  readonly tick: number;
  readonly payload?: Record<string, unknown>;
}

export interface SimTickResult {
  readonly world: WorldSpec;
  readonly events: SimEvent[];
  readonly firedRuleIds: string[];
}

function cloneWorld(world: WorldSpec): WorldSpec {
  return JSON.parse(JSON.stringify(world)) as WorldSpec;
}

function findEntity(world: WorldSpec, id: string): Entity | undefined {
  return world.entities.find((e) => e.id === id);
}

export function evalCondition(world: WorldSpec, cond: Condition): boolean {
  switch (cond.op) {
    case 'always':
      return true;
    case 'flag': {
      const v = world.narrative.flags[cond.flag] ?? false;
      return cond.equals === undefined ? v : v === cond.equals;
    }
    case 'attr': {
      const e = findEntity(world, cond.entityId);
      if (!e) return false;
      return e.attrs[cond.key] === cond.equals;
    }
    case 'has_item': {
      const e = findEntity(world, cond.entityId);
      return Boolean(e?.inventory.includes(cond.itemId));
    }
    case 'in_region': {
      const e = findEntity(world, cond.entityId);
      return e?.regionId === cond.regionId;
    }
    case 'quest_status': {
      const q = world.narrative.quests.find((x) => x.id === cond.questId);
      return q?.status === cond.status;
    }
    case 'and':
      return cond.all.every((c) => evalCondition(world, c));
    case 'or':
      return cond.any.some((c) => evalCondition(world, c));
    case 'not':
      return !evalCondition(world, cond.not);
    default:
      return false;
  }
}

export function applyEffect(
  world: WorldSpec,
  effect: Effect,
  events: SimEvent[],
  tick: number,
): void {
  switch (effect.kind) {
    case 'set_flag':
      world.narrative.flags[effect.flag] = effect.value;
      events.push({
        type: 'flag_set',
        tick,
        payload: { flag: effect.flag, value: effect.value },
      });
      break;
    case 'set_attr': {
      const e = findEntity(world, effect.entityId);
      if (e) e.attrs[effect.key] = effect.value;
      break;
    }
    case 'give_item': {
      const e = findEntity(world, effect.entityId);
      if (e && !e.inventory.includes(effect.itemId)) {
        e.inventory.push(effect.itemId);
        events.push({
          type: 'item_gained',
          tick,
          payload: { entityId: effect.entityId, itemId: effect.itemId },
        });
      }
      break;
    }
    case 'remove_item': {
      const e = findEntity(world, effect.entityId);
      if (e) {
        e.inventory = e.inventory.filter((i) => i !== effect.itemId);
      }
      break;
    }
    case 'move_entity': {
      const e = findEntity(world, effect.entityId);
      if (e) {
        e.regionId = effect.regionId;
        if (effect.pos) e.pos = { ...effect.pos };
        events.push({
          type: 'entity_moved',
          tick,
          payload: {
            entityId: effect.entityId,
            regionId: effect.regionId,
          },
        });
      }
      break;
    }
    case 'start_quest': {
      const q = world.narrative.quests.find((x) => x.id === effect.questId);
      if (q && (q.status === 'locked' || q.status === 'available')) {
        q.status = 'active';
        events.push({
          type: 'quest_started',
          tick,
          payload: { questId: effect.questId },
        });
      }
      break;
    }
    case 'complete_quest': {
      const q = world.narrative.quests.find((x) => x.id === effect.questId);
      if (q && q.status === 'active') {
        q.status = 'completed';
        for (const fx of q.onComplete) {
          applyEffect(world, fx, events, tick);
        }
        events.push({
          type: 'quest_completed',
          tick,
          payload: { questId: effect.questId },
        });
      }
      break;
    }
    case 'fail_quest': {
      const q = world.narrative.quests.find((x) => x.id === effect.questId);
      if (q && q.status === 'active') {
        q.status = 'failed';
        events.push({
          type: 'quest_failed',
          tick,
          payload: { questId: effect.questId },
        });
      }
      break;
    }
    case 'emit':
      events.push({
        type: effect.event,
        tick,
        payload: effect.payload,
      });
      break;
    case 'advance_time':
      world.timeHours += effect.hours;
      events.push({
        type: 'time_advanced',
        tick,
        payload: { hours: effect.hours, now: world.timeHours },
      });
      break;
    default:
      break;
  }
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

/**
 * Advance NPCs along schedules without teleporting within a region.
 * Cross-region hops still change regionId (presenter pathfinds same-region).
 */
function applyNpcSchedules(world: WorldSpec, events: SimEvent[], tick: number): void {
  const hour = Math.floor(world.timeHours) % 24;
  for (const e of world.entities) {
    if (e.kind !== 'npc' || e.schedule.length === 0) continue;
    const entry = e.schedule.find((s) => s.hour === hour);
    if (!entry) continue;

    if (entry.regionId && e.regionId !== entry.regionId) {
      e.regionId = entry.regionId;
      events.push({
        type: 'npc_schedule',
        tick,
        payload: {
          entityId: e.id,
          regionId: entry.regionId,
          activity: entry.activity,
          hop: true,
        },
      });
      continue;
    }

    const region = world.space.regions.find((r) => r.id === e.regionId);
    const width = region?.width ?? 24;
    const height = region?.height ?? 18;
    const goalX = Math.min(
      width - 2,
      Math.max(1, 4 + (Math.abs(hashCode(entry.activity)) % Math.max(2, width - 8))),
    );
    const goalY = Math.min(
      height - 2,
      Math.max(
        1,
        4 + (Math.abs(hashCode(entry.activity + 'y')) % Math.max(2, height - 8)),
      ),
    );
    const dx = Math.sign(goalX - e.pos.x);
    const dy = Math.sign(goalY - e.pos.y);
    if (dx !== 0 || dy !== 0) {
      e.pos = {
        x: Math.max(0, Math.min(width - 1, e.pos.x + dx)),
        y: Math.max(0, Math.min(height - 1, e.pos.y + dy)),
      };
      events.push({
        type: 'npc_schedule',
        tick,
        payload: {
          entityId: e.id,
          regionId: e.regionId,
          activity: entry.activity,
          x: e.pos.x,
          y: e.pos.y,
          hop: false,
        },
      });
    }
  }
}

function advanceQuestSteps(
  world: WorldSpec,
  events: SimEvent[],
  tick: number,
): void {
  for (const q of world.narrative.quests) {
    if (q.status !== 'active') continue;
    for (const step of q.steps) {
      if (evalCondition(world, step.when)) {
        for (const fx of step.then) {
          applyEffect(world, fx, events, tick);
        }
      }
    }
  }
}

export class WorldSimulator {
  private firedOnce = new Set<string>();
  private tickCount = 0;

  constructor(private world: WorldSpec) {}

  getWorld(): WorldSpec {
    return this.world;
  }

  /** Replace world state (e.g. after load). */
  load(world: WorldSpec): void {
    this.world = cloneWorld(world);
  }

  /**
   * Run one simulation tick.
   * @param hours how many world-hours to advance (default 0 = rule eval only)
   */
  tick(hours = 0): SimTickResult {
    this.tickCount += 1;
    const tick = this.tickCount;
    const world = cloneWorld(this.world);
    const events: SimEvent[] = [];
    const firedRuleIds: string[] = [];

    if (hours > 0) {
      world.timeHours += hours;
      events.push({
        type: 'time_advanced',
        tick,
        payload: { hours, now: world.timeHours },
      });
      applyNpcSchedules(world, events, tick);
    }

    const rules = [...world.rules].sort((a, b) => b.priority - a.priority);
    for (const rule of rules) {
      if (rule.once && this.firedOnce.has(rule.id)) continue;
      if (!evalCondition(world, rule.when)) continue;
      for (const fx of rule.then) {
        applyEffect(world, fx, events, tick);
      }
      firedRuleIds.push(rule.id);
      if (rule.once) this.firedOnce.add(rule.id);
    }

    advanceQuestSteps(world, events, tick);

    this.world = world;
    return { world, events, firedRuleIds };
  }

  /** Convenience: apply player action as effects then tick. */
  applyPlayerEffects(effects: Effect[]): SimTickResult {
    const world = cloneWorld(this.world);
    const events: SimEvent[] = [];
    this.tickCount += 1;
    for (const fx of effects) {
      applyEffect(world, fx, events, this.tickCount);
    }
    this.world = world;
    const rest = this.tick(0);
    return {
      world: rest.world,
      events: [...events, ...rest.events],
      firedRuleIds: rest.firedRuleIds,
    };
  }
}

export function simulateTicks(
  world: WorldSpec,
  ticks: number,
  hoursPerTick = 1,
): SimTickResult {
  const sim = new WorldSimulator(world);
  let last: SimTickResult = {
    world,
    events: [],
    firedRuleIds: [],
  };
  const allEvents: SimEvent[] = [];
  const allRules: string[] = [];
  for (let i = 0; i < ticks; i++) {
    last = sim.tick(hoursPerTick);
    allEvents.push(...last.events);
    allRules.push(...last.firedRuleIds);
  }
  return {
    world: last.world,
    events: allEvents,
    firedRuleIds: allRules,
  };
}
