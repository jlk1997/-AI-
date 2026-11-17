/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { V1_ROUTE_MANIFEST } from './routeManifest.js';

describe('V1_ROUTE_MANIFEST', () => {
  it('every listed path still appears in the API source tree', () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const srcRoot = join(dir, '..');
    const hay = [
      readFileSync(join(srcRoot, 'v1.ts'), 'utf8'),
      ...['auth', 'billing', 'projects', 'jobs', 'world', 'community', 'public'].map(
        (name) => {
          try {
            return readFileSync(join(dir, `${name}.ts`), 'utf8');
          } catch {
            return '';
          }
        },
      ),
      readFileSync(join(srcRoot, 'lib', 'kaiCommerceRoutes.ts'), 'utf8'),
    ].join('\n');
    for (const entry of V1_ROUTE_MANIFEST) {
      const path = entry.split(' ').slice(1).join(' ');
      expect(hay.includes(`'${path}'`) || hay.includes(`"${path}"`)).toBe(true);
    }
  });
});
