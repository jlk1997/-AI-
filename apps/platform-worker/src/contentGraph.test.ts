/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import {
  buildContentGraph,
  questWorldLayoutForIndex,
} from './contentGraph.js';
import { buildHeuristicStoryBible } from './storyOutline.js';

describe('questWorldLayoutForIndex', () => {
  it('returns deterministic item/exit coords', () => {
    const a = questWorldLayoutForIndex(0);
    const b = questWorldLayoutForIndex(3);
    expect(a.item.x).toBeGreaterThan(0);
    expect(a.exit.x).toBeGreaterThan(0);
    expect(b).toEqual(a);
  });
});

describe('buildContentGraph', () => {
  it('embeds quest layout meta for WorldScene', () => {
    const bible = buildHeuristicStoryBible('小镇探索找遗物');
    const graph = buildContentGraph({
      bible,
      archetype: 'top_down',
      designBrief: 'walk and talk',
    });
    const quest = graph.nodes.find((n) => n.kind === 'quest');
    expect(quest?.meta?.['layout']).toBeTruthy();
    const layout = quest!.meta!['layout'] as {
      item: { x: number; y: number };
      exit: { x: number; y: number };
    };
    expect(layout.item.x).toBe(700);
    expect(layout.exit.y).toBe(500);
  });
});
