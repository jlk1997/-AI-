/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Environment tree leaves: beds, ovens, notice boards. Using one writes an
 * observation and mutates the object's state string so the next passer-by
 * sees that someone was here.
 */

import type { WorldObjectState } from './react.js';
import type { NeedKind } from './needs.js';
import { isAsciiCopy } from './copyLocale.js';
import { unitHash } from './anchors.js';

export type SocietyObjectKind =
  | 'bed'
  | 'stove'
  | 'oven'
  | 'board'
  | 'food'
  | 'work'
  | 'other';

export function objectKindFromName(name: string): SocietyObjectKind {
  const t = name.toLowerCase();
  if (/床|被褥|通铺|地铺|客房床|bunk|cot|hammock|\bbed\b/.test(t)) return 'bed';
  if (/烤炉|烤箱|oven/.test(t)) return 'oven';
  if (/炉|灶|壁炉|forge|stove/.test(t)) return 'stove';
  if (/布告|告示|黑板|notice|bulletin|\bboard\b|pew/.test(t)) return 'board';
  if (/面包|炖|吧台|咖啡|厨|锅|食|galley|mess|kitchen/.test(t)) return 'food';
  if (/砧|锤|药柜|货架|织|账|console|helm|workbench/.test(t)) return 'work';
  return 'other';
}

export function objectIsUsable(
  obj: Pick<WorldObjectState, 'state'> | { readonly state?: string },
): boolean {
  const s = obj.state ?? '';
  if (!s) return true;
  return !/熄|灭了|坏了|关了|broken|out\b|offline/i.test(s);
}

export function objectKindForNeed(kind: NeedKind): SocietyObjectKind | undefined {
  if (kind === 'hunger') return 'food';
  if (kind === 'energy') return 'bed';
  if (kind === 'curiosity') return 'board';
  return undefined;
}

export function objectMatchesNeed(
  obj: Pick<WorldObjectState, 'name'> & {
    kind?: SocietyObjectKind;
    state?: string;
  },
  need: NeedKind,
): boolean {
  if (!objectIsUsable(obj)) return false;
  const kind = obj.kind ?? objectKindFromName(obj.name);
  if (need === 'hunger') return kind === 'food' || kind === 'oven';
  if (need === 'energy') return kind === 'bed';
  if (need === 'curiosity') return kind === 'board';
  if (need === 'social') return kind === 'food' || kind === 'other';
  return false;
}

export function useWorldObject(
  obj: WorldObjectState,
  activity: string,
): { nextState: string; action: string } {
  const kind = obj.kind ?? objectKindFromName(obj.name);
  const ascii = isAsciiCopy(`${obj.name}${activity}`);
  if (kind === 'bed' || /睡|歇|躺|sleep|rest|lie|nap|bunk/i.test(activity)) {
    return ascii
      ? {
          nextState: 'still warm — someone just lay down',
          action: `rests a while on ${obj.name}`,
        }
      : {
          nextState: '被子还温着，有人刚躺过',
          action: `在${obj.name}上躺下歇一会儿`,
        };
  }
  if (kind === 'oven' || kind === 'food' || /吃|烘|烤|厨|eat|cook|bake|galley/i.test(activity)) {
    return ascii
      ? {
          nextState:
            kind === 'oven'
              ? 'door ajar, heat spilling out'
              : `just used: ${obj.name}`,
          action: `gets something hot from ${obj.name}`,
        }
      : {
          nextState: kind === 'oven' ? '炉门开着，热气往外涌' : `刚被用过：${obj.name}`,
          action: `对着${obj.name}弄了点热的吃`,
        };
  }
  if (kind === 'board' || /告示|布告|查看|read|notice|bulletin/i.test(activity)) {
    return ascii
      ? {
          nextState: /read/i.test(obj.state)
            ? obj.state
            : `${obj.state} (just read)`,
          action: `reads what is on ${obj.name}`,
        }
      : {
          nextState: obj.state.includes('读') ? obj.state : `${obj.state}（有人刚读过）`,
          action: `在${obj.name}前把字读完`,
        };
  }
  if (kind === 'stove' || kind === 'work') {
    return ascii
      ? {
          nextState: 'still warm, just used',
          action: `works a while at ${obj.name}`,
        }
      : {
          nextState: '还热着，刚有人用过',
          action: `在${obj.name}前动手干了一会儿`,
        };
  }
  return ascii
    ? { nextState: obj.state, action: `fiddles with ${obj.name}` }
    : {
        nextState: obj.state,
        action: `摆弄了一下${obj.name}`,
      };
}

/**
 * Nothing in the town used to go wrong on its own: objects only broke when a
 * spectator pushed a `set_object`, so every resident's day ran exactly as
 * planned and the place felt scripted. Worn-out equipment is the cheapest
 * honest source of surprise — the replan path, the gossip and the "who fixes
 * it" negotiation are all wired up already.
 */
export const OBJECT_WEAR_CHANCE = 0.02;

/** Kinds that can plausibly fail mid-use. A bed does not break. */
function objectCanWear(kind: SocietyObjectKind): boolean {
  return kind === 'stove' || kind === 'oven' || kind === 'work' || kind === 'food';
}

export function brokenObjectState(name: string, ascii: boolean): string {
  const kind = objectKindFromName(name);
  if (ascii) {
    if (kind === 'stove' || kind === 'oven') return 'gone out, cold to the touch';
    return 'broken mid-use, out of service';
  }
  if (kind === 'stove' || kind === 'oven') return '半途熄了，摸上去是凉的';
  return '用着就坏了，暂时不能用';
}

/**
 * Decides whether this use is the one that wears the object out. Deterministic
 * in `(objectId, simTime)` so a replay produces the same incident.
 */
export function wearWorldObject(input: {
  readonly obj: Pick<WorldObjectState, 'id' | 'name' | 'kind'>;
  readonly simTime: number;
  readonly ascii: boolean;
  readonly chance?: number;
}): { readonly brokeState: string } | null {
  const chance = input.chance ?? OBJECT_WEAR_CHANCE;
  if (chance <= 0) return null;
  const kind = input.obj.kind ?? objectKindFromName(input.obj.name);
  if (!objectCanWear(kind)) return null;
  const roll = unitHash(`wear:${input.obj.id}:${Math.round(input.simTime * 4)}`);
  if (roll >= chance) return null;
  return { brokeState: brokenObjectState(input.obj.name, input.ascii) };
}

/** Inspector / SSE snapshot — includes the area name and map cell when known. */
export function snapshotWorldObjects(
  objects: readonly WorldObjectState[],
  anchors?: ReadonlyMap<string, { readonly x: number; readonly y: number }>,
): Array<{
  id: string;
  name: string;
  state: string;
  regionId: string;
  areaId: string;
  areaName?: string;
  kind?: SocietyObjectKind;
  x?: number;
  y?: number;
}> {
  return objects.map((o) => {
    const anchor = anchors?.get(o.id);
    return {
      id: o.id,
      name: o.name,
      state: o.state,
      regionId: o.regionId ?? o.areaId,
      areaId: o.areaId,
      ...(o.areaName ? { areaName: o.areaName } : {}),
      ...(o.kind ? { kind: o.kind } : {}),
      ...(anchor
        ? { x: anchor.x, y: anchor.y }
        : {}),
    };
  });
}

/** Replay observe/use-object events onto spec-seeded objects (latest in the list wins). */
export function applyObjectStateEvents(
  objects: WorldObjectState[],
  events: ReadonlyArray<{
    kind: string;
    payload?: Record<string, unknown>;
  }>,
): void {
  const latest = new Map<string, string>();
  for (const e of events) {
    if (e.kind !== 'observe' && e.kind !== 'use-object') continue;
    const id = e.payload?.['objectId'];
    const state = e.payload?.['state'];
    if (typeof id !== 'string' || typeof state !== 'string') continue;
    latest.set(id, state);
  }
  if (!latest.size) return;
  for (let i = 0; i < objects.length; i++) {
    const next = latest.get(objects[i]!.id);
    if (!next) continue;
    objects[i] = { ...objects[i]!, state: next };
  }
}

export type ObjectStateTip = {
  readonly simTime: number;
  readonly objects: ReadonlyArray<{ readonly id: string; readonly state: string }>;
};

/**
 * Spec objects ← last persisted tip ← observe/use-object events newer than the
 * tip. Older mixed-event windows must not resurrect a repaired oven.
 */
export function replayPersistedObjectStates(
  objects: WorldObjectState[],
  input: {
    readonly tip?: ObjectStateTip | null;
    readonly events?: ReadonlyArray<{
      kind: string;
      simTime?: number;
      payload?: Record<string, unknown>;
    }>;
  },
): void {
  if (input.tip?.objects.length) {
    applyObjectStateEvents(
      objects,
      input.tip.objects.map((o) => ({
        kind: 'observe',
        payload: { objectId: o.id, state: o.state },
      })),
    );
  }
  const tipTime = input.tip?.simTime ?? Number.NEGATIVE_INFINITY;
  const later = (input.events ?? []).filter(
    (e) => (typeof e.simTime === 'number' ? e.simTime : 0) > tipTime,
  );
  applyObjectStateEvents(objects, later);
}
