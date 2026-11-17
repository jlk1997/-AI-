/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildChapterFromBible,
  buildHeuristicStoryBible,
  legalizeDialogueEntries,
  validateDialogueGraph,
  writeStoryOutlineArtifacts,
} from './storyOutline.js';
import { formatChangePlanConfirmLabel, parseChangePlan } from './changePlan.js';

describe('storyOutline', () => {
  it('builds bible with ≥3 NPCs and quests from town prompt', () => {
    const bible = buildHeuristicStoryBible(
      '做一个小镇剧情：3 NPC、2 任务、对话选项影响结局，铁匠要出场',
    );
    expect(bible.npcs.length).toBeGreaterThanOrEqual(3);
    expect(bible.quests.length).toBeGreaterThanOrEqual(2);
    expect(bible.npcs.some((n) => n.id === 'Smith')).toBe(true);
    expect(Object.keys(bible.flags).length).toBeGreaterThan(0);
    expect(bible.winCondition).toMatch(/ending|flag/i);
    expect(bible.endings.length).toBeGreaterThanOrEqual(2);
    expect(bible.endings.some((e) => e.id === 'ending_a' && e.body.length > 0)).toBe(
      true,
    );
    expect(bible.endings.some((e) => e.id === 'ending_b' && e.body.length > 0)).toBe(
      true,
    );
    expect(bible.endings[0]!.title).not.toBe(bible.endings[1]!.title);
  });

  it('writes STORY_BIBLE + multi-chapter JSON with terminal null nextId', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-outline-'));
    const { biblePath, chapterPath, bible } = await writeStoryOutlineArtifacts(
      dir,
      '做一个 RPG 武侠小镇，三章剧情，铁匠与向导',
      { force: true },
    );
    expect(fs.existsSync(biblePath)).toBe(true);
    expect(fs.existsSync(chapterPath)).toBe(true);
    expect(bible.chapters.length).toBeGreaterThanOrEqual(2);
    expect(bible.source).toBe('heuristic-outline');
    const chapter = JSON.parse(fs.readFileSync(chapterPath, 'utf8')) as {
      entries: Array<Record<string, unknown>>;
    };
    expect(chapter.entries.some((e) => e.type === 'choice')).toBe(true);
    const terminals = chapter.entries.filter((e) => e.nextId === null);
    expect(terminals.length).toBeGreaterThanOrEqual(2);
    expect(validateDialogueGraph(chapter.entries)).toEqual([]);
    // second chapter exists
    const ch2 = path.join(dir, 'public', bible.chapters[1]!.file);
    expect(fs.existsSync(ch2)).toBe(true);
  });

  it('legalizes dangling nextId and leaf terminals', () => {
    const { entries, issues } = legalizeDialogueEntries([
      { id: 'a', type: 'text', nextId: 'missing' },
      {
        id: 'c',
        type: 'choice',
        options: [
          { label: 'x' },
          { label: 'y', nextId: 'gone' },
        ],
      },
    ]);
    expect(entries[0]?.nextId).toBeNull();
    const opts = entries[1]?.options as Array<Record<string, unknown>>;
    expect(opts[0]?.nextId).toBeNull();
    expect(opts[1]?.nextId).toBeNull();
    expect(issues.filter((i) => /不存在/.test(i))).toEqual([]);
  });
});

describe('formatChangePlanConfirmLabel', () => {
  it('renders 本轮将改 strip', () => {
    const plan = parseChangePlan({
      userPrompt: '第1关多一个金币',
      intent: 'iterate',
      sceneIds: ['TitleScene', 'Level1Scene', 'GameOverScene'],
    });
    const label = formatChangePlanConfirmLabel(plan);
    expect(label).toMatch(/^本轮将改：/);
    expect(label).toMatch(/Level1/i);
  });
});
