/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  auditDialogueReachability,
  auditSceneLayoutOverflow,
} from './experienceGate.js';
import { buildContentGraph } from './contentGraph.js';
import { buildHeuristicStoryBible } from './storyOutline.js';
import { enrichChapterEntries } from './storyAuthor.js';

describe('experienceGate', () => {
  it('flags unreachable dialogue nodes', () => {
    const issues = auditDialogueReachability([
      { id: 'a', type: 'text', nextId: null },
      { id: 'orphan', type: 'text', nextId: null },
    ]);
    expect(issues.some((i) => /不可达/.test(i))).toBe(true);
  });

  it('accepts legal branched graph', () => {
    const issues = auditDialogueReachability([
      { id: 'a', type: 'text', nextId: 'c' },
      {
        id: 'c',
        type: 'choice',
        options: [
          { label: 'x', nextId: 'x' },
          { label: 'y', nextId: 'y' },
        ],
      },
      { id: 'x', type: 'text', nextId: null },
      { id: 'y', type: 'text', nextId: null },
    ]);
    expect(issues).toEqual([]);
  });

  it('flags ChoicePanel colliding with dialogue bar', () => {
    const blob = `
      new DialogueManager(this);
      new ChoicePanel(this, 480, 120, { wordWrap: true, buttonHeight: 40 });
    `;
    expect(
      auditSceneLayoutOverflow(blob).some((i) => /ChoicePanel|底栏|重叠/.test(i)),
    ).toBe(true);
  });

  it('accepts ChoicePanel with dim + y reposition', () => {
    const blob = `
      new DialogueManager(this);
      GameUiKit.addDialoguePanel(this);
      new ChoicePanel(this, 480, 120, { wordWrap: true, buttonHeight: 40 });
      this.choices.on('selected', (index) => this.dialogue.selectChoice(index));
      GameUiKit.dimDialogueForChoices(this.ui);
      this.choices.y = 120;
      wordWrap: { width: 100, useAdvancedWrap: true },
    `;
    expect(auditSceneLayoutOverflow(blob)).toEqual([]);
  });

  it('flags ChoicePanel missing selected → selectChoice wiring', () => {
    const blob = `
      new DialogueManager(this);
      GameUiKit.addDialoguePanel(this);
      new ChoicePanel(this, 480, 120, { wordWrap: true, buttonHeight: 40 });
      this.ui.panel.setAlpha(0.22);
      this.choices.y = 120;
    `;
    expect(
      auditSceneLayoutOverflow(blob).some((i) => /selectChoice|无法点击/.test(i)),
    ).toBe(true);
  });

  it('flags thin hand-rolled Skip button', () => {
    const blob = `
      this.add.rectangle(100, 36, 100, 32, 0x0f172a, 0.85);
      this.add.text(100, 36, 'Skip · S');
    `;
    expect(
      auditSceneLayoutOverflow(blob).some((i) => /addChromeButton|Skip/.test(i)),
    ).toBe(true);
  });
});

describe('contentGraph', () => {
  it('builds three-layer graph from story bible', () => {
    const bible = buildHeuristicStoryBible('武侠小镇 RPG 三章');
    const graph = buildContentGraph({
      bible,
      archetype: 'top_down',
      designBrief: 'preferredArchetype=top_down',
    });
    expect(graph.nodes.some((n) => n.layer === 'content')).toBe(true);
    expect(graph.nodes.some((n) => n.layer === 'kernel')).toBe(true);
    expect(graph.nodes.some((n) => n.layer === 'presentation')).toBe(true);
    expect(graph.edges.length).toBeGreaterThan(0);
  });
});

describe('storyAuthor', () => {
  it('enriches chapters with prompt flavor and terminal nulls', () => {
    const bible = buildHeuristicStoryBible('武侠小镇三章剧情');
    const ch = enrichChapterEntries(bible, 0, '铁匠与向导的故事');
    const entries = ch.entries as Array<Record<string, unknown>>;
    expect(entries.some((e) => e.nextId === null)).toBe(true);
    expect(String(ch.authored)).toMatch(/heuristic/);
  });
});
