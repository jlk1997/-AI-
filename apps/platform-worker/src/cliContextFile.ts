/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Publish the durable platform contract as a workspace context file.
 *
 * The OpenGame CLI walks up from its cwd looking for `QWEN.md` and merges what
 * it finds into the system prompt. Putting the timeless rules there instead of
 * in `--prompt` takes ~8k characters off every CODE and FIX round, which is the
 * single biggest lever on first-round timeouts.
 */

import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

import { CLI_CONTEXT_FILENAME, buildCliContextDoc } from './promptContracts.js';

export interface CliContextFileResult {
  /** False when an identical file was already there. */
  readonly written: boolean;
  readonly path: string;
  readonly chars: number;
}

/**
 * Write (or refresh) the workspace context file. Returns `written: false` when
 * the content already matched so re-runs do not churn the workspace.
 */
export async function ensureCliContextFile(
  workspace: string,
  options?: {
    readonly archetype?: string | null;
    readonly isIteration?: boolean;
  },
): Promise<CliContextFileResult> {
  const target = path.join(workspace, CLI_CONTEXT_FILENAME);
  const doc = buildCliContextDoc(options);
  try {
    const existing = await fsp.readFile(target, 'utf8');
    if (existing === doc) {
      return { written: false, path: target, chars: doc.length };
    }
  } catch {
    // Absent or unreadable — write it.
  }
  await fsp.mkdir(workspace, { recursive: true });
  await fsp.writeFile(target, doc, 'utf8');
  return { written: true, path: target, chars: doc.length };
}

/** Opt-out for debugging a prompt in isolation. */
export function cliContextFileEnabled(): boolean {
  return process.env['PLATFORM_CLI_CONTEXT_FILE'] !== 'false';
}
