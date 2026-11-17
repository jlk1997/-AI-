/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { WorldSpec } from '@opengame/world-spec';
import { WorldSimulator } from '@opengame/world-sim';

export interface PresenterHooks {
  readonly onWorldChange?: (world: WorldSpec) => void;
  readonly onEvent?: (type: string, payload?: Record<string, unknown>) => void;
}

/**
 * Headless bridge: Spec + Sim without a renderer.
 * Phaser / Three adapters consume this.
 */
export class WorldRuntimeCore {
  readonly sim: WorldSimulator;

  constructor(
    world: WorldSpec,
    private readonly hooks: PresenterHooks = {},
  ) {
    this.sim = new WorldSimulator(world);
  }

  get world(): WorldSpec {
    return this.sim.getWorld();
  }

  tick(hours = 0): WorldSpec {
    const result = this.sim.tick(hours);
    for (const ev of result.events) {
      this.hooks.onEvent?.(ev.type, ev.payload);
    }
    this.hooks.onWorldChange?.(result.world);
    return result.world;
  }

  interactWithNpc(npcId: string): { line: string; world: WorldSpec } {
    const npc = this.world.entities.find((e) => e.id === npcId);
    const line =
      npc?.dialogueSeed ??
      `${npc?.name ?? 'Someone'} has nothing to say.`;
    const result = this.sim.tick(0);
    this.hooks.onWorldChange?.(result.world);
    return { line, world: result.world };
  }

  movePlayer(dx: number, dy: number): WorldSpec {
    const player = this.world.entities.find((e) => e.kind === 'player');
    if (!player) return this.world;
    const region = this.world.space.regions.find(
      (r) => r.id === player.regionId,
    );
    const nx = Math.max(
      0,
      Math.min((region?.width ?? 32) - 1, player.pos.x + dx),
    );
    const ny = Math.max(
      0,
      Math.min((region?.height ?? 24) - 1, player.pos.y + dy),
    );
    const result = this.sim.applyPlayerEffects([
      {
        kind: 'move_entity',
        entityId: player.id,
        regionId: player.regionId,
        pos: { x: nx, y: ny },
      },
    ]);
    this.hooks.onWorldChange?.(result.world);
    for (const ev of result.events) {
      this.hooks.onEvent?.(ev.type, ev.payload);
    }
    return result.world;
  }
}

function scaffoldRoot(mode: 'phaser2d' | 'three3d' = 'phaser2d'): string {
  return path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    mode === 'three3d' ? 'scaffold-three' : 'scaffold',
  );
}

/** Every file under the presenter template, as posix paths relative to the root. */
function listScaffoldRels(root: string): string[] {
  const out: string[] = [];
  const walk = (abs: string): void => {
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const full = path.join(abs, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.isFile()) {
        out.push(path.relative(root, full).split(path.sep).join('/'));
      }
    }
  };
  walk(root);
  return out.sort((a, b) => a.localeCompare(b));
}

/** Emit a Vite+Phaser (or Three.js) project skeleton that loads public/world.json. */
export function generateWorldPresenterScaffold(options: {
  readonly title: string;
  readonly mode?: 'phaser2d' | 'three3d';
}): {
  readonly files: Record<string, string>;
  readonly mode: 'phaser2d' | 'three3d';
} {
  const mode = options.mode ?? 'phaser2d';
  const root = scaffoldRoot(mode);
  const title = options.title.replace(/</g, '');
  const files: Record<string, string> = {};
  for (const rel of listScaffoldRels(root)) {
    const full = path.join(root, rel);
    let content = fs.readFileSync(full, 'utf8');
    if (rel === 'index.html') {
      content = content
        .replace('<title>OpenGame World</title>', `<title>${title}</title>`)
        .replace('<title>OpenGame World 3D</title>', `<title>${title}</title>`);
    }
    files[rel] = content;
  }
  return { files, mode };
}
