/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * In-process latch: world/game generation owns MiniMax. Society heartbeat must
 * not start extra chat completions while a generate job is on the same worker.
 */

let depth = 0;

export function isGenerationBusy(): boolean {
  return depth > 0;
}

export async function withGenerationBusy<T>(
  fn: () => Promise<T>,
): Promise<T> {
  depth += 1;
  try {
    return await fn();
  } finally {
    depth = Math.max(0, depth - 1);
  }
}
