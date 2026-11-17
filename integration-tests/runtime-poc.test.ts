/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNTIME_EXAMPLES = resolve(HERE, '..', 'packages', 'runtime', 'examples', 'poc');

/**
 * Top-level acceptance smoke test for the three P0 baseline PoCs
 * (Flappy / Snake / 2048). These fixtures are also exercised by the runtime's
 * own vitest suite; this layer ensures the integration-tests gate (which
 * runs in CI alongside the agent E2E tests) cannot silently break the
 * baseline DSL contract.
 */
describe('runtime PoC baselines (integration-tests smoke)', () => {
  const ids = ['flappy', 'snake', '2048'] as const;
  for (const id of ids) {
    it(`${id}/game.json is well-formed`, () => {
      const path = resolve(RUNTIME_EXAMPLES, id, 'game.json');
      const raw = readFileSync(path, 'utf8');
      const dsl = JSON.parse(raw) as {
        dslVersion?: string;
        meta?: { title?: string; canvas?: { width?: number; height?: number } };
        scenes?: Array<{ id?: string; entities?: unknown[] }>;
        customModules?: string[];
      };
      expect(typeof dsl.dslVersion).toBe('string');
      expect(dsl.meta?.title?.length).toBeGreaterThan(0);
      expect(dsl.meta?.canvas?.width).toBeGreaterThan(0);
      expect(dsl.meta?.canvas?.height).toBeGreaterThan(0);
      expect(Array.isArray(dsl.scenes)).toBe(true);
      expect(dsl.scenes!.length).toBeGreaterThan(0);
      for (const s of dsl.scenes!) {
        expect(typeof s.id).toBe('string');
        expect(Array.isArray(s.entities)).toBe(true);
      }
      expect(Array.isArray(dsl.customModules)).toBe(true);
      expect(dsl.customModules!.length).toBeGreaterThan(0);
    });

    it(`${id} ships its custom module file`, () => {
      const game = JSON.parse(
        readFileSync(resolve(RUNTIME_EXAMPLES, id, 'game.json'), 'utf8'),
      ) as { customModules?: string[] };
      const moduleRel = game.customModules?.[0];
      expect(moduleRel).toBeTruthy();
      // game.json references modules under `src/foo.ts`; in the example dir the
      // module file sits next to game.json named `<id>.ts` (or g2048.ts for the
      // numeric-prefix case). We assert any sibling .ts exists so the Coder
      // Agent's custom module pattern is intact.
      const moduleName = moduleRel!.split('/').pop()!;
      const fallbackName = id === '2048' ? 'g2048.ts' : `${id}.ts`;
      const candidate1 = resolve(RUNTIME_EXAMPLES, id, moduleName);
      const candidate2 = resolve(RUNTIME_EXAMPLES, id, fallbackName);
      const found = [candidate1, candidate2].some((p) => {
        try {
          readFileSync(p, 'utf8');
          return true;
        } catch {
          return false;
        }
      });
      expect(found).toBe(true);
    });
  }
});
