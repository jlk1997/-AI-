/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { createEmptyTownWorld, createSocietyTownWorld } from '@opengame/world-spec';
import {
  createMemoryStore,
  extractFactsFromWorld,
  formatWorldContextForPrompt,
  remember,
  retrieveMemories,
} from './memory.js';

describe('world-memory', () => {
  it('retrieves by keyword', () => {
    let store = createMemoryStore();
    store = remember(store, {
      kind: 'fact',
      text: 'The blacksmith is a traitor',
      tags: ['smith', 'traitor'],
      importance: 3,
    });
    const hits = retrieveMemories(store, 'tell me about the traitor smith');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.text).toContain('traitor');
  });

  it('formats sparse prompt', () => {
    const world = createEmptyTownWorld();
    const store = createMemoryStore();
    const block = formatWorldContextForPrompt(world, store, 'expand the forest');
    expect(block).toContain('World Spec');
    expect(block.length).toBeLessThan(4500);
  });

  it('extracts the opening rumor and object traces', () => {
    const world = createSocietyTownWorld({ title: 'Facts' });
    const facts = extractFactsFromWorld(world);
    expect(facts.some((f) => f.startsWith('rumor:') && /告示|铁砧/.test(f))).toBe(
      true,
    );
    expect(facts.some((f) => f.startsWith('object:') && /告示/.test(f))).toBe(
      true,
    );
  });
});
