/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

import { SessionService } from '@opengame/opengame-core/dist/src/services/sessionService.js';

const MAP_FILE = '.opengame/platform-cli-session.json';

interface PlatformCliSessionMap {
  readonly version: 1;
  readonly byPlatformSession: Record<
    string,
    { cliSessionId: string; updatedAt: string }
  >;
}

function mapPath(workspace: string): string {
  return path.join(workspace, MAP_FILE);
}

async function readMap(workspace: string): Promise<PlatformCliSessionMap> {
  const p = mapPath(workspace);
  if (!fs.existsSync(p)) {
    return { version: 1, byPlatformSession: {} };
  }
  try {
    const raw = JSON.parse(await fsp.readFile(p, 'utf8')) as PlatformCliSessionMap;
    if (raw.version === 1 && raw.byPlatformSession) return raw;
  } catch {
    // fall through
  }
  return { version: 1, byPlatformSession: {} };
}

async function writeMap(
  workspace: string,
  map: PlatformCliSessionMap,
): Promise<void> {
  const dir = path.dirname(mapPath(workspace));
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(mapPath(workspace), JSON.stringify(map, null, 2), 'utf8');
}

/**
 * Returns CLI `--resume` id when we have a prior mapping for this platform session.
 */
export async function resolveCliResumeSessionId(
  workspace: string,
  platformSessionId: string | null | undefined,
): Promise<string | undefined> {
  if (!platformSessionId) return undefined;
  const map = await readMap(workspace);
  const entry = map.byPlatformSession[platformSessionId];
  if (!entry?.cliSessionId) return undefined;
  const sessionService = new SessionService(workspace);
  const loaded = await sessionService.loadSession(entry.cliSessionId);
  if (!loaded) return undefined;
  return entry.cliSessionId;
}

/**
 * After a successful CLI run, persist the latest session id for this platform session.
 */
export async function captureCliSessionAfterRun(
  workspace: string,
  platformSessionId: string | null | undefined,
): Promise<void> {
  if (!platformSessionId) return;
  try {
    const sessionService = new SessionService(workspace);
    const last = await sessionService.loadLastSession();
    const cliSessionId = last?.conversation.sessionId;
    if (!cliSessionId) return;
    const map = await readMap(workspace);
    map.byPlatformSession[platformSessionId] = {
      cliSessionId,
      updatedAt: new Date().toISOString(),
    };
    await writeMap(workspace, map);
  } catch {
    // Non-fatal: iteration still works via prompt history + workspace files.
  }
}
