/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Disk I/O for GameIntent. Planning lives in @opengame/game-planner.
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

import type { GameIntent } from '@opengame/game-planner';

export {
  formatGameIntentForCoder,
  inferGameIntent,
  isRedoPrompt,
  mergeGameIntent,
  synthesizeMechanicSpec,
} from '@opengame/game-planner';
export type { GameIntent } from '@opengame/game-planner';

export const GAME_INTENT_FILE = '.opengame-intent.json';
export const GAME_INTENT_PUBLIC_FILE = 'GAME_INTENT.json';

export async function writeGameIntent(
  workspace: string,
  intent: GameIntent,
): Promise<void> {
  const body = JSON.stringify(intent, null, 2);
  await fsp.writeFile(path.join(workspace, GAME_INTENT_FILE), body, 'utf8');
  const publicDir = path.join(workspace, 'public');
  await fsp.mkdir(publicDir, { recursive: true }).catch(() => undefined);
  await fsp
    .writeFile(path.join(publicDir, GAME_INTENT_PUBLIC_FILE), body, 'utf8')
    .catch(() => undefined);
}

export function readGameIntent(workspace: string): GameIntent | null {
  for (const rel of [GAME_INTENT_FILE, path.join('public', GAME_INTENT_PUBLIC_FILE)]) {
    const file = path.join(workspace, rel);
    if (!fs.existsSync(file)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as GameIntent;
      if (parsed?.schema === 'opengame-game-intent-v1') return parsed;
    } catch {
      /* next */
    }
  }
  return null;
}
