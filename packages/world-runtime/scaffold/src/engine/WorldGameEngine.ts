/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Portable in-browser World Spec executor for game presenters.
 * Mirrors @opengame/world-sim semantics without package imports (Vite-friendly).
 */

export type Vec2 = { x: number; y: number };

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

export type Effect =
  | { kind: 'set_flag'; flag: string; value: boolean }
  | {
      kind: 'set_attr';
      entityId: string;
      key: string;
      value: string | number | boolean;
    }
  | { kind: 'give_item'; entityId: string; itemId: string }
  | { kind: 'remove_item'; entityId: string; itemId: string }
  | {
      kind: 'move_entity';
      entityId: string;
      regionId: string;
      pos?: Vec2;
    }
  | { kind: 'start_quest'; questId: string }
  | { kind: 'complete_quest'; questId: string }
  | { kind: 'fail_quest'; questId: string }
  | { kind: 'emit'; event: string; payload?: Record<string, unknown> }
  | { kind: 'advance_time'; hours: number }
  | { kind: 'remove_entity'; entityId: string };

export interface WorldEntity {
  id: string;
  kind: string;
  name: string;
  regionId: string;
  pos: Vec2;
  attrs: Record<string, string | number | boolean>;
  inventory: string[];
  personality?: string;
  dialogueSeed?: string;
  spriteKey?: string;
  tags?: string[];
  schedule?: Array<{ hour: number; regionId: string; activity: string }>;
}

export interface WorldPortal {
  id: string;
  fromRegionId: string;
  toRegionId: string;
  fromPos: Vec2;
  toPos: Vec2;
  label?: string;
}

export interface WorldRegion {
  id: string;
  name: string;
  kind: string;
  width: number;
  height: number;
  description?: string;
  layoutAscii?: string;
  tileKey?: string;
  backgroundKey?: string;
  tags?: string[];
}

export interface WorldQuest {
  id: string;
  title: string;
  description: string;
  giverEntityId?: string;
  status: string;
  steps: Array<{
    id: string;
    description: string;
    when: Condition;
    then: Effect[];
  }>;
  onComplete: Effect[];
}

export interface WorldSpecDoc {
  meta: { id: string; title: string; version: number; summary?: string };
  styleAnchor?: {
    artStyle?: string;
    palette?: string[];
    mood?: string;
  };
  space: {
    regions: WorldRegion[];
    portals: WorldPortal[];
    startRegionId: string;
    startPos: Vec2;
  };
  entities: WorldEntity[];
  relations?: unknown[];
  rules: Array<{
    id: string;
    name?: string;
    when: Condition;
    then: Effect[];
    once?: boolean;
    priority?: number;
  }>;
  narrative: {
    quests: WorldQuest[];
    beats: Array<{ id: string; text: string; when?: Condition }>;
    flags: Record<string, boolean>;
  };
  presentation: {
    mode?: string;
    /** On-screen tile size in CSS pixels. */
    tileSize?: number;
    /** Source frame size of tileset.png; may exceed {@link tileSize}. */
    tileSourceSize?: number;
    /** Resolved from the picked art style; drives Phaser pixel snapping. */
    artStyleId?: string;
    pixelPerfect?: boolean;
    cameraFollowPlayer?: boolean;
    cinematicEnabled?: boolean;
    spatialBackend?: string;
    lingbotMode?: string;
    spatialAssets?: Record<
      string,
      { videoUrl?: string; assetUrl?: string; backend?: string }
    >;
  };
  timeHours: number;
}

export interface GameEvent {
  type: string;
  payload?: Record<string, unknown>;
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export class WorldGameEngine {
  world: WorldSpecDoc;
  private firedOnce = new Set<string>();
  private listeners: Array<(e: GameEvent) => void> = [];

  constructor(world: WorldSpecDoc) {
    this.world = clone(world);
    // Normalize optional arrays
    for (const e of this.world.entities) {
      e.attrs = e.attrs ?? {};
      e.inventory = e.inventory ?? [];
    }
    this.world.narrative.flags = this.world.narrative.flags ?? {};
    this.world.rules = this.world.rules ?? [];
    this.world.space.portals = this.world.space.portals ?? [];
  }

  on(fn: (e: GameEvent) => void): void {
    this.listeners.push(fn);
  }

  private emit(type: string, payload?: Record<string, unknown>): void {
    const ev = { type, payload };
    for (const fn of this.listeners) fn(ev);
  }

  player(): WorldEntity {
    return this.world.entities.find((e) => e.kind === 'player')!;
  }

  region(id: string): WorldRegion | undefined {
    return this.world.space.regions.find((r) => r.id === id);
  }

  eval(cond: Condition): boolean {
    switch (cond.op) {
      case 'always':
        return true;
      case 'flag': {
        const v = this.world.narrative.flags[cond.flag] ?? false;
        return cond.equals === undefined ? v : v === cond.equals;
      }
      case 'attr': {
        const e = this.world.entities.find((x) => x.id === cond.entityId);
        return e?.attrs[cond.key] === cond.equals;
      }
      case 'has_item': {
        const e = this.world.entities.find((x) => x.id === cond.entityId);
        return Boolean(e?.inventory.includes(cond.itemId));
      }
      case 'in_region': {
        const e = this.world.entities.find((x) => x.id === cond.entityId);
        return e?.regionId === cond.regionId;
      }
      case 'quest_status': {
        const q = this.world.narrative.quests.find((x) => x.id === cond.questId);
        return q?.status === cond.status;
      }
      case 'and':
        return cond.all.every((c) => this.eval(c));
      case 'or':
        return cond.any.some((c) => this.eval(c));
      case 'not':
        return !this.eval(cond.not);
      default:
        return false;
    }
  }

  apply(effect: Effect): void {
    switch (effect.kind) {
      case 'set_flag':
        this.world.narrative.flags[effect.flag] = effect.value;
        this.emit('flag_set', { flag: effect.flag, value: effect.value });
        break;
      case 'set_attr': {
        const e = this.world.entities.find((x) => x.id === effect.entityId);
        if (e) e.attrs[effect.key] = effect.value;
        break;
      }
      case 'give_item': {
        const e = this.world.entities.find((x) => x.id === effect.entityId);
        if (e && !e.inventory.includes(effect.itemId)) {
          e.inventory.push(effect.itemId);
          this.emit('item_gained', {
            entityId: effect.entityId,
            itemId: effect.itemId,
          });
        }
        break;
      }
      case 'remove_item': {
        const e = this.world.entities.find((x) => x.id === effect.entityId);
        if (e) e.inventory = e.inventory.filter((i) => i !== effect.itemId);
        break;
      }
      case 'move_entity': {
        const e = this.world.entities.find((x) => x.id === effect.entityId);
        if (e) {
          e.regionId = effect.regionId;
          if (effect.pos) e.pos = { ...effect.pos };
          this.emit('entity_moved', {
            entityId: effect.entityId,
            regionId: effect.regionId,
          });
        }
        break;
      }
      case 'start_quest': {
        const q = this.world.narrative.quests.find((x) => x.id === effect.questId);
        if (q && (q.status === 'locked' || q.status === 'available')) {
          q.status = 'active';
          this.emit('quest_started', { questId: effect.questId });
        }
        break;
      }
      case 'complete_quest': {
        const q = this.world.narrative.quests.find((x) => x.id === effect.questId);
        if (q && q.status === 'active') {
          q.status = 'completed';
          for (const fx of q.onComplete ?? []) this.apply(fx);
          this.emit('quest_completed', { questId: effect.questId });
        }
        break;
      }
      case 'fail_quest': {
        const q = this.world.narrative.quests.find((x) => x.id === effect.questId);
        if (q && q.status === 'active') {
          q.status = 'failed';
          this.emit('quest_failed', { questId: effect.questId });
        }
        break;
      }
      case 'emit':
        this.emit(effect.event, effect.payload);
        break;
      case 'advance_time':
        this.world.timeHours += effect.hours;
        this.emit('time_advanced', {
          hours: effect.hours,
          now: this.world.timeHours,
        });
        break;
      case 'remove_entity':
        this.world.entities = this.world.entities.filter(
          (e) => e.id !== effect.entityId,
        );
        this.emit('entity_removed', { entityId: effect.entityId });
        break;
      default:
        break;
    }
  }

  applyAll(effects: Effect[]): void {
    for (const fx of effects) this.apply(fx);
  }

  /** Evaluate rules + quest steps (like sim.tick(0)). */
  resolve(): GameEvent[] {
    const before: GameEvent[] = [];
    const capture: GameEvent[] = [];
    const handler = (e: GameEvent) => capture.push(e);
    this.listeners.push(handler);

    const rules = [...this.world.rules].sort(
      (a, b) => (b.priority ?? 0) - (a.priority ?? 0),
    );
    for (const rule of rules) {
      if (rule.once && this.firedOnce.has(rule.id)) continue;
      if (!this.eval(rule.when)) continue;
      this.applyAll(rule.then);
      if (rule.once) this.firedOnce.add(rule.id);
    }
    for (const q of this.world.narrative.quests) {
      if (q.status !== 'active') continue;
      for (const step of q.steps ?? []) {
        if (this.eval(step.when)) this.applyAll(step.then ?? []);
      }
    }

    this.listeners = this.listeners.filter((fn) => fn !== handler);
    before.push(...capture);
    return before;
  }

  tickHours(hours: number): GameEvent[] {
    this.world.timeHours += hours;
    const hour = Math.floor(this.world.timeHours) % 24;
    for (const e of this.world.entities) {
      if (e.kind !== 'npc' || !e.schedule?.length) continue;
      const entry = e.schedule.find((s) => s.hour === hour);
      if (entry && e.regionId !== entry.regionId) {
        e.regionId = entry.regionId;
      }
    }
    return this.resolve();
  }

  movePlayer(dx: number, dy: number): {
    events: GameEvent[];
    regionChanged: boolean;
    blocked: boolean;
  } {
    const p = this.player();
    const region = this.region(p.regionId);
    if (!region) return { events: [], regionChanged: false, blocked: true };
    const nx = Math.max(0, Math.min(region.width - 1, p.pos.x + dx));
    const ny = Math.max(0, Math.min(region.height - 1, p.pos.y + dy));
    if (nx === p.pos.x && ny === p.pos.y) {
      return { events: [], regionChanged: false, blocked: true };
    }
    // Wall from layoutAscii '#'
    if (region.layoutAscii) {
      const rows = region.layoutAscii.trim().split(/\r?\n/);
      const ch = rows[ny]?.[nx];
      if (ch === '#' || ch === 'X') {
        return { events: [], regionChanged: false, blocked: true };
      }
    }
    p.pos = { x: nx, y: ny };

    // Portal check
    let regionChanged = false;
    for (const portal of this.world.space.portals) {
      if (
        portal.fromRegionId === p.regionId &&
        portal.fromPos.x === p.pos.x &&
        portal.fromPos.y === p.pos.y
      ) {
        p.regionId = portal.toRegionId;
        p.pos = { ...portal.toPos };
        regionChanged = true;
        this.emit('portal_used', { portalId: portal.id });
        break;
      }
    }

    const events = this.resolve();
    return { events, regionChanged, blocked: false };
  }

  entitiesNearPlayer(kinds?: string[], dist = 1): WorldEntity[] {
    const p = this.player();
    return this.world.entities.filter(
      (e) =>
        e.id !== p.id &&
        e.regionId === p.regionId &&
        Math.abs(e.pos.x - p.pos.x) <= dist &&
        Math.abs(e.pos.y - p.pos.y) <= dist &&
        (!kinds || kinds.includes(e.kind)),
    );
  }

  talkTo(npcId: string): { line: string; events: GameEvent[] } {
    const npc = this.world.entities.find((e) => e.id === npcId);
    const line = npc?.dialogueSeed ?? `${npc?.name ?? 'Someone'}: …`;
    // Meeting NPCs can unlock flags via rules after a soft flag
    this.apply({
      kind: 'set_flag',
      flag: `talked_${npcId}`,
      value: true,
    });
    const events = this.resolve();
    return { line, events };
  }

  pickupNearest(): { ok: boolean; itemId?: string; events: GameEvent[] } {
    const items = this.entitiesNearPlayer(['item', 'prop'], 0);
    // also adjacent
    const near = items.length
      ? items
      : this.entitiesNearPlayer(['item'], 1);
    const item = near[0];
    if (!item) return { ok: false, events: [] };
    const itemId =
      typeof item.attrs['itemId'] === 'string'
        ? String(item.attrs['itemId'])
        : item.id.replace(/^item_/, '');
    this.apply({ kind: 'give_item', entityId: this.player().id, itemId });
    this.apply({ kind: 'remove_entity', entityId: item.id });
    const events = this.resolve();
    return { ok: true, itemId, events };
  }

  /** Simple combat: player fights enemy; returns victory and events. */
  resolveCombat(enemyId: string): {
    victory: boolean;
    log: string[];
    events: GameEvent[];
  } {
    const p = this.player();
    const enemy = this.world.entities.find((e) => e.id === enemyId);
    const log: string[] = [];
    if (!enemy) return { victory: false, log: ['No enemy.'], events: [] };
    let php = Number(p.attrs['hp'] ?? 10);
    let ehp = Number(enemy.attrs['hp'] ?? 5);
    const patk = Number(p.attrs['atk'] ?? 3);
    const eatk = Number(enemy.attrs['atk'] ?? 2);
    while (php > 0 && ehp > 0) {
      ehp -= patk;
      log.push(`You hit ${enemy.name} for ${patk}. (${Math.max(0, ehp)} HP)`);
      if (ehp <= 0) break;
      php -= eatk;
      log.push(`${enemy.name} hits you for ${eatk}. (${Math.max(0, php)} HP)`);
    }
    p.attrs['hp'] = Math.max(0, php);
    const victory = ehp <= 0 && php > 0;
    if (victory) {
      this.apply({ kind: 'remove_entity', entityId: enemyId });
      this.apply({
        kind: 'set_flag',
        flag: `defeated_${enemyId}`,
        value: true,
      });
      if (enemy.inventory?.length) {
        for (const it of enemy.inventory) {
          this.apply({ kind: 'give_item', entityId: p.id, itemId: it });
        }
      }
    }
    const events = this.resolve();
    return { victory, log, events };
  }

  isVictory(): boolean {
    const quests = this.world.narrative.quests;
    if (quests.length === 0) return false;
    return quests.every(
      (q) => q.status === 'completed' || q.status === 'locked',
    )
      ? quests.some((q) => q.status === 'completed')
      : quests.filter((q) => q.status !== 'locked').every((q) => q.status === 'completed');
  }

  isDefeat(): boolean {
    return Number(this.player().attrs['hp'] ?? 1) <= 0;
  }

  activeQuests(): WorldQuest[] {
    return this.world.narrative.quests.filter((q) => q.status === 'active');
  }

  introBeat(): string | null {
    const beat = this.world.narrative.beats?.[0];
    return beat?.text ?? null;
  }
}
