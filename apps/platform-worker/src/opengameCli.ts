/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Resolves PLATFORM_OPENGAME_CLI to an absolute path to the CLI entry JS file.
 * Accepts `C:\\path\\dist\\cli.js` or `node:C:\\path\\dist\\cli.js`.
 */
export function resolveOpenGameCliJs(raw: string): string {
  const trimmed = raw.trim();
  const withoutPrefix = trimmed.startsWith('node:')
    ? trimmed.slice('node:'.length).trim()
    : trimmed;
  const abs = path.isAbsolute(withoutPrefix)
    ? withoutPrefix
    : path.resolve(process.cwd(), withoutPrefix);
  if (!fs.existsSync(abs)) {
    throw new Error(`PLATFORM_OPENGAME_CLI file not found: ${abs}`);
  }
  return abs;
}
