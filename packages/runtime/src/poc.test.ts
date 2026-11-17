/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { validateGameDsl } from './dsl/schema.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXAMPLES_DIR = resolve(HERE, '..', 'examples', 'poc');

const PoCs = [
  { id: 'flappy', dir: 'flappy', expectedCanvas: { width: 480, height: 720 } },
  { id: 'snake', dir: 'snake', expectedCanvas: { width: 600, height: 600 } },
  { id: '2048', dir: '2048', expectedCanvas: { width: 480, height: 560 } },
] as const;

describe('PoC baselines', () => {
  for (const poc of PoCs) {
    it(`${poc.id} game.json validates and matches its canvas contract`, () => {
      const raw = readFileSync(resolve(EXAMPLES_DIR, poc.dir, 'game.json'), 'utf8');
      const dsl = JSON.parse(raw);
      expect(validateGameDsl(dsl)).toEqual([]);
      expect(dsl.meta.canvas.width).toBe(poc.expectedCanvas.width);
      expect(dsl.meta.canvas.height).toBe(poc.expectedCanvas.height);
      // Every PoC ships at least one custom module so future Coder Agent
      // output isn't accidentally short-circuited to a DSL-only path.
      expect(Array.isArray(dsl.customModules) && dsl.customModules.length).toBeGreaterThan(0);
    });
  }
});
