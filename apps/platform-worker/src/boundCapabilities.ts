/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Bind MechanicSpec.modules onto an existing workspace without wiping the
 * world/level carrier. Chess on a town is an extra Scene, not a new exclusive
 * arcade kernel.
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

import {
  CAPABILITY_ENTRIES,
  jiaxiDeckForMechanic,
  MODULE_EXTRA_SCENES,
  type MechanicModule,
} from '@opengame/game-planner';

import { boardTurnSceneSource } from './boardTurnKernel.js';
import {
  cardsHandSceneSource,
  emitterSceneSource,
  match3SceneSource,
} from './capabilityKernels.js';
import { parseExtraScenesFromMain } from './gameQualityArchetype.js';

export type BoundMechanicHint = {
  readonly modules?: readonly string[];
  readonly boardKind?: string;
  readonly extraScenes?: readonly string[];
  readonly loops?: readonly { readonly id: string; readonly label: string; readonly source?: string }[];
  readonly space?: string;
  readonly arcadeVariant?: string;
} | null;

export const CAPABILITY_PUBLIC_FILE = 'CAPABILITY.json';

export function mergeExtraSceneIntoMain(
  mainSrc: string,
  className: string,
  importPath: string,
): string {
  let next = mainSrc;
  const importRe = new RegExp(
    `import\\s*\\{\\s*${className}\\s*\\}\\s*from\\s*['"][^'"]+['"]`,
  );
  if (!importRe.test(next)) {
    const lastImport = [...next.matchAll(/^import .+$/gm)].pop();
    const line = `import { ${className} } from '${importPath}';`;
    if (lastImport && lastImport.index !== undefined) {
      const at = lastImport.index + lastImport[0].length;
      next = `${next.slice(0, at)}\n${line}${next.slice(at)}`;
    } else {
      next = `${line}\n${next}`;
    }
  }
  if (parseExtraScenesFromMain(next).includes(className)) return next;
  if (/extraScenes\s*:\s*\[/.test(next)) {
    return next.replace(/extraScenes\s*:\s*\[([^\]]*)\]/s, (_m, inner: string) => {
      const trimmed = inner.trim();
      const prefix = trimmed.length === 0 || trimmed.endsWith(',') ? inner : `${inner}, `;
      return `extraScenes: [${prefix}${className}]`;
    });
  }
  return next.replace(
    /bootstrap\(\s*\{/,
    `bootstrap({\n  extraScenes: [${className}],`,
  );
}

export const JIAXI_PUBLIC_FILE = 'JIAXI.json';

export async function writeCapabilityManifest(
  workspace: string,
  spec: BoundMechanicHint,
): Promise<void> {
  const modules = spec?.modules ?? [];
  const wanted = new Set(modules);
  const entries = CAPABILITY_ENTRIES.filter((e) => wanted.has(e.id as MechanicModule));
  const extraScenes = spec?.extraScenes ?? [];
  const body = JSON.stringify(
    {
      schema: 'opengame-capability-v1',
      modules,
      extraScenes,
      packages: entries.map((e) => ({ id: e.id, pkg: e.pkg, api: e.api })),
      updatedAt: new Date().toISOString(),
    },
    null,
    2,
  );
  const publicDir = path.join(workspace, 'public');
  await fsp.mkdir(publicDir, { recursive: true }).catch(() => undefined);
  await fsp.writeFile(path.join(publicDir, CAPABILITY_PUBLIC_FILE), body, 'utf8');
  const deck = jiaxiDeckForMechanic({
    modules,
    extraScenes,
    boardKind: spec?.boardKind,
    loops: spec?.loops,
    space: spec?.space,
    arcadeVariant: spec?.arcadeVariant,
  });
  await fsp.writeFile(
    path.join(publicDir, JIAXI_PUBLIC_FILE),
    JSON.stringify(
      {
        schema: 'opengame-jiaxi-v1',
        cards: deck,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    'utf8',
  );
}

/**
 * On first-gen mixed prompts and on iterate bind_module:
 * write missing capability scenes and merge extraScenes. Never delete
 * World / Title / Level, never rewrite main as a single-scene arcade boot.
 */
export async function ensureBoundCapabilities(
  workspace: string,
  mechanic: BoundMechanicHint,
): Promise<{ readonly written: readonly string[] }> {
  if (!mechanic) return { written: [] };
  const written: string[] = [];
  await writeCapabilityManifest(workspace, mechanic);

  const wantsBoard =
    (mechanic.modules ?? []).includes('board') ||
    Boolean(mechanic.boardKind) ||
    (mechanic.extraScenes ?? []).includes('BoardTurnScene');
  const scenesDir = path.join(workspace, 'src', 'scenes');
  await fsp.mkdir(scenesDir, { recursive: true });

  if (wantsBoard) {
    const scenePath = path.join(scenesDir, 'BoardTurnScene.ts');
    if (!fs.existsSync(scenePath)) {
      const raw = mechanic.boardKind ?? 'generic';
      const kind =
        raw === 'xiangqi' || raw === 'chess' || raw === 'gomoku' || raw === 'generic'
          ? raw
          : 'generic';
      await fsp.writeFile(scenePath, boardTurnSceneSource(kind), 'utf8');
      written.push('src/scenes/BoardTurnScene.ts');
    }
  }

  const modules = mechanic.modules ?? [];
  const writers: Array<{
    readonly id: MechanicModule;
    readonly file: string;
    readonly source: () => string;
  }> = [
    { id: 'match', file: 'Match3Scene.ts', source: match3SceneSource },
    { id: 'cards', file: 'CardsHandScene.ts', source: cardsHandSceneSource },
    { id: 'emitter', file: 'EmitterScene.ts', source: emitterSceneSource },
  ];
  for (const row of writers) {
    const wanted =
      modules.includes(row.id) ||
      (mechanic.extraScenes ?? []).includes(MODULE_EXTRA_SCENES[row.id] ?? '');
    if (!wanted) continue;
    const scenePath = path.join(scenesDir, row.file);
    if (fs.existsSync(scenePath)) continue;
    await fsp.writeFile(scenePath, row.source(), 'utf8');
    written.push(`src/scenes/${row.file}`);
  }

  const extra = new Set(mechanic.extraScenes ?? []);
  if (wantsBoard) extra.add('BoardTurnScene');
  if (modules.includes('match')) extra.add('Match3Scene');
  if (modules.includes('cards')) extra.add('CardsHandScene');
  if (modules.includes('emitter')) extra.add('EmitterScene');
  const mainPath = path.join(workspace, 'src', 'main.ts');
  if (fs.existsSync(mainPath) && extra.size > 0) {
    let main = await fsp.readFile(mainPath, 'utf8');
    let changed = false;
    for (const key of extra) {
      if (!/^[A-Za-z][A-Za-z0-9]*Scene$/.test(key)) continue;
      const sceneFile = path.join(scenesDir, `${key}.ts`);
      if (!fs.existsSync(sceneFile)) continue;
      const next = mergeExtraSceneIntoMain(main, key, `./scenes/${key}`);
      if (next !== main) {
        main = next;
        changed = true;
      }
    }
    if (changed) {
      await fsp.writeFile(mainPath, main, 'utf8');
      written.push('src/main.ts');
    }
  }

  if (wantsBoard || extra.size > 0) {
    try {
      const { healExtraScenesGameJsonWiring } = await import(
        './gameQualityArchetype.js'
      );
      await healExtraScenesGameJsonWiring(workspace);
    } catch {
      /* optional */
    }
  }
  return { written };
}
