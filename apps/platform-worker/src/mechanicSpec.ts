/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Disk I/O for MechanicSpec. Planning lives in @opengame/game-planner.
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

import type { MechanicSpec } from '@opengame/game-planner';

export {
  detectBoardKind,
  ensureGameDepth,
  formatMechanicSpecForCoder,
  inferMechanicSpec,
  mergeNamedLoops,
  padThinLoops,
  stampGddWithMechanicSpec,
} from '@opengame/game-planner';
export type {
  ArcadeCarrier,
  BoardKind,
  GameArchetypeHint,
  MechanicInput,
  MechanicModule,
  MechanicSpace,
  MechanicSpec,
  MechanicTime,
  MechanicWin,
  NamedLoop,
} from '@opengame/game-planner';

export const MECHANIC_SPEC_FILE = '.opengame-mechanic.json';
export const MECHANIC_PUBLIC_FILE = 'MECHANIC.json';

export async function writeMechanicSpec(
  workspace: string,
  spec: MechanicSpec,
): Promise<void> {
  const body = JSON.stringify(spec, null, 2);
  await fsp.writeFile(path.join(workspace, MECHANIC_SPEC_FILE), body, 'utf8');
  const publicDir = path.join(workspace, 'public');
  await fsp.mkdir(publicDir, { recursive: true }).catch(() => undefined);
  await fsp
    .writeFile(path.join(publicDir, MECHANIC_PUBLIC_FILE), body, 'utf8')
    .catch(() => undefined);
}

export function readMechanicSpec(workspace: string): MechanicSpec | null {
  for (const rel of [MECHANIC_SPEC_FILE, path.join('public', MECHANIC_PUBLIC_FILE)]) {
    const file = path.join(workspace, rel);
    if (!fs.existsSync(file)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as MechanicSpec;
      if (parsed?.schema === 'opengame-mechanic-v1') return parsed;
    } catch {
      /* next */
    }
  }
  return null;
}
