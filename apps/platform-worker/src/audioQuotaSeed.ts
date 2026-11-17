/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * When MiniMax music/speech hits quota and there is no prior workspace file,
 * ship a short real MP3 seed pack so ASSET can finish (images may already
 * have failed over to Ark). Not a solid placeholder — real encoded audio.
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'assets',
  'audio-quota-seed',
);

const ALIASES: Record<string, string> = {
  'bgm.mp3': 'bgm.mp3',
  'sfx_win.mp3': 'sfx_win.mp3',
  'sfx_lose.mp3': 'sfx_lose.mp3',
  'sfx_coin.mp3': 'sfx_win.mp3',
};

export function audioQuotaSeedPath(fileName: string): string | null {
  const mapped = ALIASES[fileName] ?? ALIASES[path.basename(fileName)];
  if (!mapped) return null;
  const full = path.join(DIR, mapped);
  return fs.existsSync(full) ? full : null;
}

export async function loadAudioQuotaSeed(
  fileName: string,
): Promise<Buffer | null> {
  const p = audioQuotaSeedPath(fileName);
  if (!p) return null;
  return fsp.readFile(p);
}
