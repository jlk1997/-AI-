/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  healNarrativeArtifacts,
  narrativeHealChanged,
} from './narrativeHeal.js';

describe('healNarrativeArtifacts', () => {
  it('legalizes dangling chapter nextIds and writes CONTENT_GRAPH', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'og-heal-'));
    const publicDir = path.join(dir, 'public');
    await fsp.mkdir(path.join(publicDir, 'story'), { recursive: true });
    await fsp.writeFile(
      path.join(publicDir, 'STORY_BIBLE.json'),
      JSON.stringify({
        title: 'Heal Town',
        chapters: [{ id: 'c1', title: 'One', file: 'story/chapter_01.json' }],
        npcs: [
          { id: 'Guide', role: 'quest_giver', notes: 'hi' },
          { id: 'Smith', role: 'merchant', notes: 'iron' },
        ],
        quests: [{ id: 'relic', title: 'Find relic', status: 'available' }],
        flags: { ending_a: false, ending_b: false },
      }),
      'utf8',
    );
    await fsp.writeFile(
      path.join(publicDir, 'story', 'chapter_01.json'),
      JSON.stringify({
        entries: [
          { id: 'a', type: 'text', text: 'Hello', nextId: 'missing_node' },
          {
            id: 'b',
            type: 'choice',
            prompt: 'Go?',
            options: [
              { label: 'Yes', nextId: 'gone' },
              { label: 'No' },
            ],
          },
        ],
      }),
      'utf8',
    );

    const result = await healNarrativeArtifacts(dir, { archetype: 'ui_heavy' });
    expect(narrativeHealChanged(result)).toBe(true);
    expect(result.healedFiles.some((f) => f.includes('chapter_01'))).toBe(true);
    expect(result.bibleEndingsHealed).toBe(true);
    expect(result.graphRewritten).toBe(true);

    const chapter = JSON.parse(
      await fsp.readFile(
        path.join(publicDir, 'story', 'chapter_01.json'),
        'utf8',
      ),
    ) as { entries: Array<Record<string, unknown>> };
    expect(chapter.entries[0]?.nextId).toBeNull();
    const opts = chapter.entries[1]?.options as Array<Record<string, unknown>>;
    expect(opts[0]?.nextId).toBeNull();
    expect(opts[1]?.nextId).toBeNull();

    const bible = JSON.parse(
      await fsp.readFile(path.join(publicDir, 'STORY_BIBLE.json'), 'utf8'),
    ) as { endings: Array<{ id: string }> };
    expect(bible.endings.some((e) => e.id === 'ending_a')).toBe(true);
    expect(bible.endings.some((e) => e.id === 'ending_b')).toBe(true);

    const graph = JSON.parse(
      await fsp.readFile(path.join(publicDir, 'CONTENT_GRAPH.json'), 'utf8'),
    ) as { nodes: Array<{ kind?: string }> };
    expect(graph.nodes.length).toBeGreaterThan(2);
    expect(graph.nodes.some((n) => n.kind === 'ending')).toBe(true);
  });
});
