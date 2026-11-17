/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

describe('processJob path honesty', () => {
  it('looks up package.json with ASCII parens', () => {
    const src = [
      'processJob.ts',
      'processJobHelpers.ts',
      'generateFsm.ts',
    ]
      .map((name) => readFileSync(join(here, name), 'utf8'))
      .join('\n');
    expect(src).not.toMatch(/package\.json）'/);
    expect(src).not.toMatch(/PLATFORM_ALLOW_ASSET_FIX\)/);
    expect(src).toMatch(/path\.join\([^)]*'package\.json'\)/);
    expect(src).toMatch(/process\.env\['PLATFORM_ALLOW_ASSET_FIX'\]/);
  });
});
