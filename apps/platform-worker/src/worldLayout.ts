/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure layout helpers shared by ContentDirector scaffold + unit tests.
 * WorldScene prefers game.json entity sprites over hardcoded coords.
 */

export type WorldLayoutPoint = {
  x: number;
  y: number;
  id?: string;
  tags?: string[];
  /** From sceneTransition behavior — custom WorldScene can hop without DSL. */
  targetSceneId?: string;
};

export type WorldLayout = {
  player: WorldLayoutPoint | null;
  npcs: WorldLayoutPoint[];
  items: WorldLayoutPoint[];
  portals: WorldLayoutPoint[];
  enemies: WorldLayoutPoint[];
};

function emptyLayout(): WorldLayout {
  return { player: null, npcs: [], items: [], portals: [], enemies: [] };
}

function readTargetSceneId(ent: Record<string, unknown>): string | undefined {
  const behaviors = Array.isArray(ent['behaviors']) ? ent['behaviors'] : [];
  for (const b of behaviors) {
    if (!b || typeof b !== 'object') continue;
    const kind = (b as { kind?: unknown }).kind;
    if (kind !== 'sceneTransition' && kind !== 'SceneTransition') continue;
    const opts = (b as { options?: { targetSceneId?: unknown } }).options;
    const target = opts?.targetSceneId;
    if (typeof target === 'string' && target.trim()) return target.trim();
  }
  const direct = ent['targetSceneId'];
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  return undefined;
}

function layoutFromEntities(entities: Array<Record<string, unknown>>): WorldLayout {
  const out = emptyLayout();
  for (const ent of entities) {
    const sprite = ent['sprite'] as { x?: unknown; y?: unknown } | undefined;
    const x = typeof sprite?.x === 'number' ? sprite.x : null;
    const y = typeof sprite?.y === 'number' ? sprite.y : null;
    if (x === null || y === null) continue;
    const tags = Array.isArray(ent['tags'])
      ? (ent['tags'] as unknown[]).map(String)
      : [];
    const id = typeof ent['id'] === 'string' ? ent['id'] : undefined;
    const targetSceneId = readTargetSceneId(ent);
    const pt: WorldLayoutPoint = {
      x,
      y,
      id,
      tags,
      ...(targetSceneId ? { targetSceneId } : {}),
    };
    if (tags.includes('player')) out.player = pt;
    else if (
      tags.includes('portal') ||
      tags.includes('exit') ||
      tags.includes('door')
    ) {
      out.portals.push(pt);
    } else if (tags.includes('item') || tags.includes('pickup')) {
      out.items.push(pt);
    } else if (
      tags.includes('enemy') ||
      tags.includes('foe') ||
      tags.includes('mob') ||
      tags.includes('boss')
    ) {
      out.enemies.push(pt);
    } else if (
      tags.includes('npc') ||
      tags.includes('dialog') ||
      tags.includes('quest_giver') ||
      tags.includes('merchant')
    ) {
      out.npcs.push(pt);
    }
  }
  return out;
}

function sceneIdOf(scene: unknown, index: number): string {
  if (scene && typeof scene === 'object') {
    const id = (scene as { id?: unknown }).id;
    if (typeof id === 'string' && id.trim()) return id.trim();
  }
  return `scene_${index}`;
}

/** All region layouts keyed by game.json scenes[].id (multi-region SSOT). */
export function resolveWorldLayoutsBySceneId(
  game: unknown,
): Record<string, WorldLayout> {
  const out: Record<string, WorldLayout> = {};
  if (!game || typeof game !== 'object') return out;
  const scenes = (game as { scenes?: unknown }).scenes;
  if (!Array.isArray(scenes)) return out;
  scenes.forEach((scene, index) => {
    if (!scene || typeof scene !== 'object') return;
    const entities = Array.isArray((scene as { entities?: unknown }).entities)
      ? ((scene as { entities: Array<Record<string, unknown>> }).entities)
      : [];
    out[sceneIdOf(scene, index)] = layoutFromEntities(entities);
  });
  return out;
}

function pickStartSceneId(game: unknown): string | null {
  if (!game || typeof game !== 'object') return null;
  const initial = (game as { initialSceneId?: unknown }).initialSceneId;
  if (typeof initial === 'string' && initial.trim()) return initial.trim();
  const scenes = (game as { scenes?: unknown }).scenes;
  if (!Array.isArray(scenes) || scenes.length === 0) return null;
  const withPlayer = scenes.findIndex(
    (s) =>
      s &&
      typeof s === 'object' &&
      Array.isArray((s as { entities?: unknown }).entities) &&
      ((s as { entities: unknown[] }).entities as unknown[]).some((e) => {
        const tags = (e as { tags?: unknown })?.tags;
        return Array.isArray(tags) && tags.includes('player');
      }),
  );
  if (withPlayer >= 0) return sceneIdOf(scenes[withPlayer], withPlayer);
  return sceneIdOf(scenes[0], 0);
}

/** Prefer public/game.json entity sprites over hardcoded WorldScene coords. */
export function resolveWorldLayoutFromGame(game: unknown): WorldLayout {
  const byId = resolveWorldLayoutsBySceneId(game);
  const keys = Object.keys(byId);
  if (keys.length === 0) return emptyLayout();
  const startId = pickStartSceneId(game);
  if (startId && byId[startId]) return byId[startId]!;
  return byId[keys[0]!]!;
}

/** Source embedded into generated src/content/ContentDirector.ts */
export function contentDirectorLayoutHelpersSource(): string {
  return `export type WorldLayoutPoint = {
  x: number;
  y: number;
  id?: string;
  tags?: string[];
  targetSceneId?: string;
};

export type WorldLayout = {
  player: WorldLayoutPoint | null;
  npcs: WorldLayoutPoint[];
  items: WorldLayoutPoint[];
  portals: WorldLayoutPoint[];
  enemies: WorldLayoutPoint[];
};

function emptyLayout(): WorldLayout {
  return { player: null, npcs: [], items: [], portals: [], enemies: [] };
}

function readTargetSceneId(ent: Record<string, unknown>): string | undefined {
  const behaviors = Array.isArray(ent['behaviors']) ? ent['behaviors'] : [];
  for (const b of behaviors) {
    if (!b || typeof b !== 'object') continue;
    const kind = (b as { kind?: unknown }).kind;
    if (kind !== 'sceneTransition' && kind !== 'SceneTransition') continue;
    const opts = (b as { options?: { targetSceneId?: unknown } }).options;
    const target = opts?.targetSceneId;
    if (typeof target === 'string' && target.trim()) return target.trim();
  }
  const direct = ent['targetSceneId'];
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  return undefined;
}

function layoutFromEntities(entities: Array<Record<string, unknown>>): WorldLayout {
  const out = emptyLayout();
  for (const ent of entities) {
    const sprite = ent['sprite'] as { x?: unknown; y?: unknown } | undefined;
    const x = typeof sprite?.x === 'number' ? sprite.x : null;
    const y = typeof sprite?.y === 'number' ? sprite.y : null;
    if (x === null || y === null) continue;
    const tags = Array.isArray(ent['tags'])
      ? (ent['tags'] as unknown[]).map(String)
      : [];
    const id = typeof ent['id'] === 'string' ? ent['id'] : undefined;
    const targetSceneId = readTargetSceneId(ent);
    const pt: WorldLayoutPoint = {
      x,
      y,
      id,
      tags,
      ...(targetSceneId ? { targetSceneId } : {}),
    };
    if (tags.includes('player')) out.player = pt;
    else if (
      tags.includes('portal') ||
      tags.includes('exit') ||
      tags.includes('door')
    ) {
      out.portals.push(pt);
    } else if (tags.includes('item') || tags.includes('pickup')) {
      out.items.push(pt);
    } else if (
      tags.includes('enemy') ||
      tags.includes('foe') ||
      tags.includes('mob') ||
      tags.includes('boss')
    ) {
      out.enemies.push(pt);
    } else if (
      tags.includes('npc') ||
      tags.includes('dialog') ||
      tags.includes('quest_giver') ||
      tags.includes('merchant')
    ) {
      out.npcs.push(pt);
    }
  }
  return out;
}

function sceneIdOf(scene: unknown, index: number): string {
  if (scene && typeof scene === 'object') {
    const id = (scene as { id?: unknown }).id;
    if (typeof id === 'string' && id.trim()) return id.trim();
  }
  return 'scene_' + index;
}

/** All region layouts keyed by game.json scenes[].id */
export function resolveWorldLayoutsBySceneId(
  game: unknown,
): Record<string, WorldLayout> {
  const out: Record<string, WorldLayout> = {};
  if (!game || typeof game !== 'object') return out;
  const scenes = (game as { scenes?: unknown }).scenes;
  if (!Array.isArray(scenes)) return out;
  scenes.forEach((scene, index) => {
    if (!scene || typeof scene !== 'object') return;
    const entities = Array.isArray((scene as { entities?: unknown }).entities)
      ? ((scene as { entities: Array<Record<string, unknown>> }).entities)
      : [];
    out[sceneIdOf(scene, index)] = layoutFromEntities(entities);
  });
  return out;
}

/** Prefer public/game.json entity sprites over hardcoded WorldScene coords. */
export function resolveWorldLayoutFromGame(game: unknown): WorldLayout {
  const byId = resolveWorldLayoutsBySceneId(game);
  const keys = Object.keys(byId);
  if (keys.length === 0) return emptyLayout();
  const initial =
    game && typeof game === 'object'
      ? (game as { initialSceneId?: unknown }).initialSceneId
      : undefined;
  if (typeof initial === 'string' && byId[initial]) return byId[initial]!;
  const scenes = (game as { scenes?: unknown })?.scenes;
  if (Array.isArray(scenes)) {
    const withPlayer = scenes.findIndex(
      (s) =>
        s &&
        typeof s === 'object' &&
        Array.isArray((s as { entities?: unknown }).entities) &&
        ((s as { entities: unknown[] }).entities as unknown[]).some((e) => {
          const tags = (e as { tags?: unknown })?.tags;
          return Array.isArray(tags) && tags.includes('player');
        }),
    );
    if (withPlayer >= 0) {
      const id = sceneIdOf(scenes[withPlayer], withPlayer);
      if (byId[id]) return byId[id]!;
    }
  }
  return byId[keys[0]!]!;
}
`;
}

/** Build Phaser-friendly tile gid layer from region layoutAscii. */
export function tilemapFromLayoutAscii(layoutAscii: string): {
  width: number;
  height: number;
  gids: number[];
} {
  const lines = layoutAscii
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);
  const height = lines.length;
  const width = Math.max(0, ...lines.map((l) => l.length));
  const gids: number[] = [];
  for (let y = 0; y < height; y++) {
    const line = lines[y] ?? '';
    for (let x = 0; x < width; x++) {
      const ch = line[x] ?? '.';
      if (ch === '#') gids.push(3);
      else if (ch === '~') gids.push(4);
      else if (ch === '=') gids.push(2);
      else if (ch === '*') gids.push(5);
      else gids.push(1);
    }
  }
  return { width, height, gids };
}

/** Y-sort depth for grounded sprites. */
export function ySortDepth(y: number, base = 10): number {
  return base + Math.floor(y);
}
