/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Content Graph SSOT — design truth that kernels / Scenes present.
 * Layers: content → kernel specialization → presentation.
 */

import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

import type { StoryBible } from './storyOutline.js';

export const CONTENT_GRAPH_SCHEMA = 'opengame-content-graph-v1' as const;

/** Deterministic WorldScene props for quest item / exit when game.json lacks them. */
export function questWorldLayoutForIndex(index: number): {
  item: { x: number; y: number };
  exit: { x: number; y: number };
} {
  const presets = [
    { item: { x: 700, y: 200 }, exit: { x: 900, y: 500 } },
    { item: { x: 640, y: 360 }, exit: { x: 880, y: 120 } },
    { item: { x: 760, y: 140 }, exit: { x: 120, y: 480 } },
  ] as const;
  return presets[Math.abs(index) % presets.length]!;
}

export interface ContentGraphNode {
  readonly id: string;
  readonly layer: 'content' | 'kernel' | 'presentation';
  readonly kind: string;
  readonly title: string;
  readonly refs?: readonly string[];
  readonly meta?: Record<string, unknown>;
}

export interface ContentGraph {
  readonly schema: typeof CONTENT_GRAPH_SCHEMA;
  readonly title: string;
  readonly archetype: string;
  readonly designBrief: string | null;
  readonly nodes: ContentGraphNode[];
  readonly edges: Array<{ readonly from: string; readonly to: string; readonly rel: string }>;
  readonly source: 'story-bible' | 'heuristic';
  readonly updatedAt: string;
}

export function buildContentGraph(options: {
  readonly bible: StoryBible;
  readonly archetype: string;
  readonly designBrief?: string | null;
  readonly userPrompt?: string;
}): ContentGraph {
  const { bible, archetype } = options;
  const nodes: ContentGraphNode[] = [];
  const edges: Array<{ from: string; to: string; rel: string }> = [];

  nodes.push({
    id: 'content:root',
    layer: 'content',
    kind: 'story_bible',
    title: bible.title,
    refs: ['public/STORY_BIBLE.json'],
    meta: {
      chapters: bible.chapters.length,
      npcs: bible.npcs.length,
      quests: bible.quests.length,
      endings: Array.isArray(bible.endings) ? bible.endings.length : 0,
      winCondition: bible.winCondition,
    },
  });

  for (const ch of bible.chapters) {
    const cid = `content:chapter:${ch.id}`;
    nodes.push({
      id: cid,
      layer: 'content',
      kind: 'chapter',
      title: ch.title,
      refs: [`public/${ch.file}`],
      meta: { winCondition: ch.winCondition, npcs: ch.npcs, quests: ch.quests },
    });
    edges.push({ from: 'content:root', to: cid, rel: 'contains' });
  }

  for (const npc of bible.npcs) {
    const nid = `content:npc:${npc.id}`;
    nodes.push({
      id: nid,
      layer: 'content',
      kind: 'npc',
      title: npc.id,
      refs: [`public/assets/npc_${npc.id.toLowerCase()}.png`],
      meta: { role: npc.role, notes: npc.notes },
    });
    edges.push({ from: 'content:root', to: nid, rel: 'cast' });
  }

  for (let qi = 0; qi < bible.quests.length; qi++) {
    const q = bible.quests[qi]!;
    const qid = `content:quest:${q.id}`;
    const layout = questWorldLayoutForIndex(qi);
    nodes.push({
      id: qid,
      layer: 'content',
      kind: 'quest',
      title: q.title,
      meta: {
        status: q.status,
        giverNpcId: q.giverNpcId,
        layout,
      },
    });
    edges.push({ from: 'content:root', to: qid, rel: 'quest' });
  }

  const endings = Array.isArray(bible.endings) ? bible.endings : [];
  for (const ending of endings) {
    const eid = `content:ending:${ending.id}`;
    nodes.push({
      id: eid,
      layer: 'content',
      kind: 'ending',
      title: ending.title,
      meta: { body: ending.body, flag: ending.id },
    });
    edges.push({ from: 'content:root', to: eid, rel: 'ending' });
  }

  // Kernel specialization — which playable carrier presents the content
  const kernelId =
    archetype === 'top_down'
      ? 'kernel:world'
      : archetype === 'ui_heavy'
        ? 'kernel:chapter'
        : `kernel:${archetype}`;
  nodes.push({
    id: kernelId,
    layer: 'kernel',
    kind: 'playable_kernel',
    title:
      archetype === 'top_down'
        ? 'WorldScene + dialogue seeds'
        : archetype === 'ui_heavy'
          ? 'ChapterScene + DialogueManager'
          : `${archetype} kernel`,
    refs:
      archetype === 'top_down'
        ? ['src/scenes/WorldScene.ts', 'public/WORLD_SEED.json']
        : ['src/scenes/ChapterScene.ts'],
    meta: { archetype },
  });
  edges.push({ from: 'content:root', to: kernelId, rel: 'presented_by' });

  // Presentation — UI kit + optional cinematic highlight (not gameplay SSOT)
  nodes.push({
    id: 'presentation:ui_kit',
    layer: 'presentation',
    kind: 'ui_kit',
    title: 'GameUiKit dialogue / HUD',
    refs: ['@opengame/module-platform GameUiKit'],
  });
  edges.push({ from: kernelId, to: 'presentation:ui_kit', rel: 'renders' });

  nodes.push({
    id: 'presentation:cinematic',
    layer: 'presentation',
    kind: 'chapter_highlight',
    title: 'Optional LingBot-style chapter highlight',
    refs: ['src/presentation/ChapterCinematicPresenter.ts'],
    meta: {
      note: 'Presenter only — never replace STORY_BIBLE / CONTENT_GRAPH as truth',
    },
  });
  edges.push({
    from: kernelId,
    to: 'presentation:cinematic',
    rel: 'optional_highlight',
  });

  return {
    schema: CONTENT_GRAPH_SCHEMA,
    title: bible.title,
    archetype,
    designBrief: options.designBrief?.trim() || null,
    nodes,
    edges,
    source: 'story-bible',
    updatedAt: new Date().toISOString(),
  };
}

export async function writeContentGraphArtifacts(options: {
  readonly workspace: string;
  readonly bible: StoryBible;
  readonly archetype: string;
  readonly designBrief?: string | null;
  readonly userPrompt?: string;
}): Promise<{ path: string; nodeCount: number; layers: string[] }> {
  const graph = buildContentGraph(options);
  const publicDir = path.join(options.workspace, 'public');
  await fsp.mkdir(publicDir, { recursive: true });
  const outPath = path.join(publicDir, 'CONTENT_GRAPH.json');
  await fsp.writeFile(outPath, `${JSON.stringify(graph, null, 2)}\n`, 'utf8');
  const layers = [...new Set(graph.nodes.map((n) => n.layer))];
  return { path: outPath, nodeCount: graph.nodes.length, layers };
}
