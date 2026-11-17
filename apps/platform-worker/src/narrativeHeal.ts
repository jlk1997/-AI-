/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Deterministic narrative heal — legalize dialogue graphs + ensure CONTENT_GRAPH
 * before spending another LLM FIX round on sticky story gates.
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

import { writeContentGraphArtifacts } from './contentGraph.js';
import {
  ensureStoryEndings,
  legalizeDialogueEntries,
  type StoryBible,
  writeContentDirectorScaffold,
} from './storyOutline.js';

export type NarrativeHealResult = {
  readonly healedFiles: string[];
  readonly graphRewritten: boolean;
  readonly directorRewritten: boolean;
  readonly bibleEndingsHealed: boolean;
};

/**
 * Best-effort: rewrite chapter graphs to legal nextId edges, refresh CONTENT_GRAPH
 * from bible when missing/thin, refresh ContentDirector scaffold.
 */
export async function healNarrativeArtifacts(
  workspace: string,
  options?: { readonly archetype?: string; readonly designBrief?: string | null },
): Promise<NarrativeHealResult> {
  const healedFiles: string[] = [];
  const publicDir = path.join(workspace, 'public');
  const biblePath = path.join(publicDir, 'STORY_BIBLE.json');
  let bible: StoryBible | null = null;
  let bibleEndingsHealed = false;

  if (fs.existsSync(biblePath)) {
    try {
      bible = JSON.parse(fs.readFileSync(biblePath, 'utf8')) as StoryBible;
    } catch {
      bible = null;
    }
  }

  if (bible) {
    const healed = ensureStoryEndings(bible);
    const before = JSON.stringify(bible.endings ?? []);
    const after = JSON.stringify(healed.endings);
    if (before !== after) {
      bible = healed;
      await fsp.writeFile(
        biblePath,
        `${JSON.stringify(bible, null, 2)}\n`,
        'utf8',
      );
      healedFiles.push('STORY_BIBLE.json');
      bibleEndingsHealed = true;
    } else {
      bible = healed;
    }
  }

  const chapterFiles = new Set<string>();
  if (bible?.chapters?.length) {
    for (const ch of bible.chapters) {
      if (ch.file) chapterFiles.add(ch.file.replace(/^\.\//, ''));
    }
  }
  const storyDir = path.join(publicDir, 'story');
  if (fs.existsSync(storyDir)) {
    for (const f of await fsp.readdir(storyDir)) {
      if (f.endsWith('.json')) chapterFiles.add(path.join('story', f).replace(/\\/g, '/'));
    }
  }

  for (const rel of chapterFiles) {
    const full = path.join(publicDir, rel);
    if (!fs.existsSync(full)) continue;
    try {
      const raw = JSON.parse(await fsp.readFile(full, 'utf8')) as {
        entries?: unknown[];
        [k: string]: unknown;
      };
      if (!Array.isArray(raw.entries) || raw.entries.length === 0) continue;
      const before = JSON.stringify(raw.entries);
      const { entries } = legalizeDialogueEntries(
        raw.entries as Array<Record<string, unknown>>,
      );
      if (JSON.stringify(entries) === before) continue;
      await fsp.writeFile(
        full,
        `${JSON.stringify({ ...raw, entries }, null, 2)}\n`,
        'utf8',
      );
      healedFiles.push(rel);
    } catch {
      /* skip corrupt chapter */
    }
  }

  let graphRewritten = false;
  const graphPath = path.join(publicDir, 'CONTENT_GRAPH.json');
  const needGraph =
    bibleEndingsHealed ||
    !fs.existsSync(graphPath) ||
    (() => {
      try {
        const g = JSON.parse(fs.readFileSync(graphPath, 'utf8')) as {
          nodes?: unknown[];
        };
        return !Array.isArray(g.nodes) || g.nodes.length < 2;
      } catch {
        return true;
      }
    })();

  if (bible && needGraph) {
    await writeContentGraphArtifacts({
      workspace,
      bible,
      archetype: options?.archetype ?? 'ui_heavy',
      designBrief: options?.designBrief ?? null,
    });
    graphRewritten = true;
  }

  let directorRewritten = false;
  const directorPath = path.join(workspace, 'src', 'content', 'ContentDirector.ts');
  if (
    !fs.existsSync(directorPath) ||
    !/resolveWorldLayoutFromGame/.test(fs.readFileSync(directorPath, 'utf8')) ||
    !/endings\?/.test(fs.readFileSync(directorPath, 'utf8'))
  ) {
    await writeContentDirectorScaffold(workspace);
    directorRewritten = true;
  }

  return { healedFiles, graphRewritten, directorRewritten, bibleEndingsHealed };
}

export function narrativeHealChanged(result: NarrativeHealResult): boolean {
  return (
    result.healedFiles.length > 0 ||
    result.graphRewritten ||
    result.directorRewritten ||
    result.bibleEndingsHealed
  );
}
