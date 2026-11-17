/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * Writes workspace `.qwen/settings.json` so OpenGame Core CLI enables
 * ChatCompression when session history exceeds the threshold.
 */
export async function ensureWorkspaceChatCompression(workspace: string): Promise<void> {
  const envVal = process.env['PLATFORM_CHAT_COMPRESSION_THRESHOLD'];
  const threshold =
    envVal !== undefined && envVal !== ''
      ? Number(envVal)
      : 70;
  if (!Number.isFinite(threshold) || threshold <= 0) {
    return;
  }

  const dir = path.join(workspace, '.qwen');
  await fs.mkdir(dir, { recursive: true });
  const settingsPath = path.join(dir, 'settings.json');

  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(await fs.readFile(settingsPath, 'utf8')) as Record<
      string,
      unknown
    >;
  } catch {
    // fresh workspace
  }

  const merged = {
    ...existing,
    chatCompression: {
      ...(typeof existing['chatCompression'] === 'object' && existing['chatCompression']
        ? (existing['chatCompression'] as Record<string, unknown>)
        : {}),
      contextPercentageThreshold: threshold,
    },
  };

  await fs.writeFile(settingsPath, JSON.stringify(merged, null, 2), 'utf8');
}
