/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * First-create Outline → STORY_BIBLE.json + chapter JSON (data before Scene code).
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

import { contentDirectorLayoutHelpersSource } from './worldLayout.js';

export const STORY_BIBLE_SCHEMA = 'opengame-story-bible-v1' as const;

export interface StoryNpcOutline {
  readonly id: string;
  readonly role: string;
  readonly notes: string;
}

export interface StoryQuestOutline {
  readonly id: string;
  readonly title: string;
  readonly status: 'locked' | 'available' | 'active' | 'completed' | 'failed';
  readonly giverNpcId?: string;
}

export interface StoryEndingOutline {
  readonly id: 'ending_a' | 'ending_b';
  readonly title: string;
  readonly body: string;
}

export interface StoryBible {
  readonly schema: typeof STORY_BIBLE_SCHEMA;
  readonly title: string;
  readonly chapters: Array<{
    readonly id: string;
    readonly title: string;
    readonly file: string;
    readonly npcs: string[];
    readonly quests: string[];
    readonly winCondition: string;
  }>;
  readonly npcs: StoryNpcOutline[];
  readonly quests: StoryQuestOutline[];
  readonly endings: StoryEndingOutline[];
  readonly flags: Record<string, boolean>;
  readonly winCondition: string;
  readonly source: 'heuristic-outline' | 'scaffold' | 'llm-outline';
}

/** Two distinct Chinese endings driven by cast / title (SSOT for Result scenes). */
export function buildHeuristicEndings(
  title: string,
  npcNames: readonly string[],
): StoryEndingOutline[] {
  const giver = npcNames[0] ?? '向导';
  const flavor = npcNames[2] ?? npcNames[1] ?? '旅人';
  const short = title.trim().slice(0, 24) || '小镇';
  return [
    {
      id: 'ending_a',
      title: `结局甲 · 守约归来`,
      body: `你把约定带回给${giver}。《${short}》里的人情得以保全——这是一条被记住的路。`,
    },
    {
      id: 'ending_b',
      title: `结局乙 · 旁支夜路`,
      body: `你听从了${flavor}的低语，走上另一条夜路。《${short}》仍在，但回声已经不同。`,
    },
  ];
}

/** Ensure bible has ≥2 valid endings (heal / author merge). */
export function ensureStoryEndings(
  bible: StoryBible,
  userPrompt?: string,
): StoryBible {
  const existing = Array.isArray(bible.endings) ? bible.endings : [];
  const valid = existing.filter(
    (e) =>
      (e.id === 'ending_a' || e.id === 'ending_b') &&
      typeof e.title === 'string' &&
      e.title.trim().length > 0 &&
      typeof e.body === 'string' &&
      e.body.trim().length > 0,
  );
  if (valid.some((e) => e.id === 'ending_a') && valid.some((e) => e.id === 'ending_b')) {
    return { ...bible, endings: valid.slice(0, 4) };
  }
  const fallback = buildHeuristicEndings(
    bible.title || userPrompt || 'Short tale',
    bible.npcs.map((n) => n.id),
  );
  const byId = new Map(valid.map((e) => [e.id, e]));
  for (const e of fallback) {
    if (!byId.has(e.id)) byId.set(e.id, e);
  }
  return {
    ...bible,
    endings: [byId.get('ending_a')!, byId.get('ending_b')!],
  };
}

function extractNpcNames(prompt: string): string[] {
  const names: string[] = [];
  const patterns = [
    /铁匠|smith/i,
    /旅人|traveler|merchant|商人/i,
    /向导|guide|村长|elder|阿青/i,
    /反派|villain|boss|守卫|guard|疤面/i,
    /和尚|玄机|住持|abbot/i,
  ];
  const defaults = ['Guide', 'Smith', 'Traveler'];
  for (const re of patterns) {
    if (re.test(prompt)) {
      if (/铁匠|smith/i.test(re.source)) names.push('Smith');
      else if (/旅人|traveler|merchant|商人/i.test(re.source)) names.push('Traveler');
      else if (/向导|guide|村长|elder|阿青/i.test(re.source)) names.push('Guide');
      else if (/反派|villain|boss|守卫|guard|疤面/i.test(re.source))
        names.push('Guard');
      else if (/和尚|玄机|住持|abbot/i.test(re.source)) names.push('Abbot');
    }
  }
  const unique = [...new Set(names.length ? names : defaults)];
  while (unique.length < 3) {
    for (const d of defaults) {
      if (!unique.includes(d)) unique.push(d);
      if (unique.length >= 3) break;
    }
  }
  return unique.slice(0, 4);
}

function extractQuestCount(prompt: string): number {
  const m = prompt.match(/(\d+)\s*(?:个)?\s*(?:任务|quests?)/i);
  if (m) return Math.min(4, Math.max(1, Number(m[1])));
  if (/支线|side\s*quest|两任务|2\s*任务/i.test(prompt)) return 2;
  return 2;
}

function extractChapterCount(prompt: string): number {
  const m = prompt.match(/(\d+)\s*(?:章|chapter)/i);
  if (m) return Math.min(4, Math.max(1, Number(m[1])));
  if (/三章|3\s*章|三段|几段剧情/i.test(prompt)) return 3;
  if (/rpg|武侠|小镇|探索/i.test(prompt)) return 3;
  return 2;
}

/** Build a short playable story bible from the user prompt (no LLM required). */
export function buildHeuristicStoryBible(userPrompt: string): StoryBible {
  const title = userPrompt.trim().slice(0, 72) || 'Short town tale';
  const npcNames = extractNpcNames(userPrompt);
  const questCount = extractQuestCount(userPrompt);
  const chapterCount = extractChapterCount(userPrompt);
  const npcs: StoryNpcOutline[] = npcNames.map((id, i) => ({
    id,
    role: i === 0 ? 'quest_giver' : i === 1 ? 'merchant' : 'flavor',
    notes: `${id} appears in chapter ${(i % chapterCount) + 1}`,
  }));
  const quests: StoryQuestOutline[] = Array.from({ length: questCount }, (_, i) => ({
    id: i === 0 ? 'q_intro' : `q_favor_${i}`,
    title: i === 0 ? `Meet ${npcNames[0]}` : `Favor for ${npcNames[Math.min(i, npcNames.length - 1)]}`,
    status: i === 0 ? 'available' : 'locked',
    giverNpcId: npcNames[Math.min(i, npcNames.length - 1)],
  }));
  const flags: Record<string, boolean> = {
    listened_to_guide: false,
    ending_a: false,
    ending_b: false,
  };
  for (const n of npcNames) {
    flags[`talked_${n.toLowerCase()}`] = false;
  }
  const chapters = Array.from({ length: chapterCount }, (_, i) => {
    const n = i + 1;
    const pad = String(n).padStart(2, '0');
    return {
      id: `chapter_${pad}`,
      title: `Chapter ${n}`,
      file: `story/chapter_${pad}.json`,
      npcs: [npcNames[i % npcNames.length]!],
      quests: quests.map((q) => q.id),
      winCondition:
        n === chapterCount
          ? 'Dialogue choice sets ending_a/ending_b → EndingScene'
          : 'Advance to next chapter',
    };
  });
  return {
    schema: STORY_BIBLE_SCHEMA,
    title,
    chapters,
    npcs,
    quests,
    endings: buildHeuristicEndings(title, npcNames),
    flags,
    winCondition:
      'Player reaches EndingScene with ending_a or ending_b from dialogue flags',
    source: 'heuristic-outline',
  };
}

/**
 * Force legal graph edges: choice options and leaf text/event get explicit nextId:null.
 * Then validate; returns issues (empty = ok).
 */
export function legalizeDialogueEntries(
  entries: Array<Record<string, unknown>>,
): { entries: Array<Record<string, unknown>>; issues: string[] } {
  const out = entries.map((e) => {
    const copy = { ...e };
    if (copy['type'] === 'choice' && Array.isArray(copy['options'])) {
      copy['options'] = (copy['options'] as Array<Record<string, unknown>>).map(
        (opt) => {
          if (!Object.prototype.hasOwnProperty.call(opt, 'nextId')) {
            return { ...opt, nextId: null };
          }
          if (opt['nextId'] === '') return { ...opt, nextId: null };
          return { ...opt };
        },
      );
    }
    return copy;
  });

  const ids = new Set(
    out
      .map((e) => e['id'])
      .filter((id): id is string => typeof id === 'string' && id.length > 0),
  );

  // Resolve dangling nextIds → null
  for (const e of out) {
    const nid = e['nextId'];
    if (typeof nid === 'string' && nid.trim() && !ids.has(nid.trim())) {
      e['nextId'] = null;
    }
    if (e['type'] === 'choice' && Array.isArray(e['options'])) {
      e['options'] = (e['options'] as Array<Record<string, unknown>>).map(
        (opt) => {
          const on = opt['nextId'];
          if (typeof on === 'string' && on.trim() && !ids.has(on.trim())) {
            return { ...opt, nextId: null };
          }
          return opt;
        },
      );
    }
  }

  // BFS from first entry — any visited text/event with no outbound edge → nextId null
  const byId = new Map<string, Record<string, unknown>>();
  for (const e of out) {
    if (typeof e['id'] === 'string') byId.set(e['id'], e);
  }
  const start = out[0];
  const startId = typeof start?.['id'] === 'string' ? start['id'] : null;
  if (startId) {
    const visited = new Set<string>();
    const queue = [startId];
    while (queue.length) {
      const id = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);
      const node = byId.get(id);
      if (!node) continue;
      const hasField = Object.prototype.hasOwnProperty.call(node, 'nextId');
      const nid = node['nextId'];
      if (typeof nid === 'string' && nid.trim() && byId.has(nid.trim())) {
        queue.push(nid.trim());
      } else if (
        (node['type'] === 'text' || node['type'] === 'event') &&
        (!hasField || nid === '' || nid === undefined)
      ) {
        node['nextId'] = null;
      }
      if (node['type'] === 'choice' && Array.isArray(node['options'])) {
        for (const opt of node['options'] as Array<Record<string, unknown>>) {
          const on = opt['nextId'];
          if (typeof on === 'string' && on.trim() && byId.has(on.trim())) {
            queue.push(on.trim());
          }
        }
      }
    }
  }

  return { entries: out, issues: validateDialogueGraph(out) };
}

/**
 * Validate dialogue graph: every nextId resolves; no fall-through after explicit null.
 */
export function validateDialogueGraph(entries: Array<Record<string, unknown>>): string[] {
  const issues: string[] = [];
  const ids = new Set<string>();
  for (const e of entries) {
    if (typeof e['id'] === 'string') ids.add(e['id']);
  }
  const referenced = new Set<string>();
  for (const e of entries) {
    const nid = e['nextId'];
    if (typeof nid === 'string' && nid.trim()) {
      referenced.add(nid.trim());
      if (!ids.has(nid.trim())) {
        issues.push(`dialogue nextId "${nid}" 不存在`);
      }
    }
    if (e['type'] === 'choice' && Array.isArray(e['options'])) {
      for (const opt of e['options'] as Array<Record<string, unknown>>) {
        const on = opt['nextId'];
        if (typeof on === 'string' && on.trim()) {
          referenced.add(on.trim());
          if (!ids.has(on.trim())) {
            issues.push(`choice nextId "${on}" 不存在`);
          }
        }
      }
    }
  }
  // Detect orphan iter_ lines with no inbound edge (common ChangePlan bug)
  for (const e of entries) {
    const id = e['id'];
    if (
      typeof id === 'string' &&
      id.startsWith('iter_') &&
      !referenced.has(id)
    ) {
      issues.push(`孤立对话节点 ${id}（无入口边，易造成线性串台）`);
    }
  }
  return issues;
}

export function buildChapterFromBible(
  bible: StoryBible,
  chapterIndex = 0,
): Record<string, unknown> {
  const chapter = bible.chapters[chapterIndex] ?? bible.chapters[0];
  const a = bible.npcs[chapterIndex % Math.max(1, bible.npcs.length)]?.id ?? 'Guide';
  const b = bible.npcs[(chapterIndex + 1) % Math.max(1, bible.npcs.length)]?.id ?? 'Smith';
  const c = bible.npcs[(chapterIndex + 2) % Math.max(1, bible.npcs.length)]?.id ?? 'Traveler';
  const isLast = chapterIndex >= bible.chapters.length - 1;
  return {
    schema: 'opengame-story-chapter-v1',
    id: chapter?.id ?? 'chapter_01',
    title: chapter?.title ?? `Chapter ${chapterIndex + 1}`,
    bibleTitle: bible.title,
    entries: [
      {
        id: 'intro',
        type: 'text',
        speaker: 'Narrator',
        text: `${bible.title} — ${chapter?.title ?? 'a new chapter'} begins.`,
        nextId: 'meet_a',
      },
      {
        id: 'meet_a',
        type: 'text',
        speaker: a,
        text: `I am ${a}. Will you help our town?`,
        nextId: 'choice_main',
      },
      {
        id: 'choice_main',
        type: 'choice',
        prompt: 'What do you do?',
        options: [
          { label: `Listen to ${a}`, nextId: 'path_listen' },
          { label: `Ask ${b}`, nextId: 'path_smith' },
          { label: `Walk with ${c}`, nextId: 'path_leave' },
        ],
      },
      {
        id: 'path_listen',
        type: 'text',
        speaker: a,
        text: isLast
          ? 'Complete the favors — your choice will decide the ending.'
          : 'Good. Meet me again in the next chapter.',
        nextId: 'flag_a',
      },
      {
        id: 'flag_a',
        type: 'event',
        action: 'set_flag',
        data: { flag: isLast ? 'ending_a' : 'listened_to_guide', value: true },
        nextId: null,
      },
      {
        id: 'path_smith',
        type: 'text',
        speaker: b,
        text: `${b}: Bring scrap iron and I will forge your path.`,
        nextId: 'flag_b',
      },
      {
        id: 'flag_b',
        type: 'event',
        action: 'set_flag',
        data: { flag: isLast ? 'ending_b' : `talked_${b.toLowerCase()}`, value: true },
        nextId: null,
      },
      {
        id: 'path_leave',
        type: 'text',
        speaker: c,
        text: `${c}: Suit yourself — the road ahead is colder alone.`,
        nextId: null,
      },
    ],
  };
}

export async function writeStoryOutlineArtifacts(
  workspace: string,
  userPrompt: string,
  options?: {
    readonly force?: boolean;
    readonly designBrief?: string | null;
    readonly useLlmAuthor?: boolean;
  },
): Promise<{ biblePath: string; chapterPath: string; bible: StoryBible }> {
  const publicDir = path.join(workspace, 'public');
  const storyDir = path.join(publicDir, 'story');
  await fsp.mkdir(storyDir, { recursive: true });
  const biblePath = path.join(publicDir, 'STORY_BIBLE.json');
  const chapterPath = path.join(storyDir, 'chapter_01.json');

  const useLlm = options?.useLlmAuthor !== false;
  let bible: StoryBible;
  let authoredChapters: Array<{ file: string; json: Record<string, unknown> }> | null =
    null;

  if (useLlm) {
    const { authorMultiChapterStory } = await import('./storyAuthor.js');
    const authored = await authorMultiChapterStory(userPrompt, {
      designBrief: options?.designBrief ?? null,
    });
    bible = authored.bible;
    authoredChapters = authored.chapters;
  } else {
    bible = buildHeuristicStoryBible(userPrompt);
  }
  bible = ensureStoryEndings(bible, userPrompt);

  const shouldWriteBible =
    options?.force ||
    !fs.existsSync(biblePath) ||
    (() => {
      try {
        const prev = JSON.parse(fs.readFileSync(biblePath, 'utf8')) as {
          source?: string;
          endings?: unknown[];
        };
        return (
          prev.source === 'scaffold' ||
          !Array.isArray(prev.endings) ||
          prev.endings.length < 2
        );
      } catch {
        return true;
      }
    })();

  if (shouldWriteBible) {
    await fsp.writeFile(biblePath, `${JSON.stringify(bible, null, 2)}\n`, 'utf8');
  } else {
    // Patch endings onto existing bible without full rewrite of chapters
    try {
      const prev = JSON.parse(fs.readFileSync(biblePath, 'utf8')) as StoryBible;
      const patched = ensureStoryEndings(prev, userPrompt);
      if (JSON.stringify(prev.endings ?? []) !== JSON.stringify(patched.endings)) {
        await fsp.writeFile(
          biblePath,
          `${JSON.stringify(patched, null, 2)}\n`,
          'utf8',
        );
        bible = patched;
      }
    } catch {
      /* keep */
    }
  }

  const activeBible = shouldWriteBible
    ? bible
    : ensureStoryEndings(
        JSON.parse(fs.readFileSync(biblePath, 'utf8')) as StoryBible,
        userPrompt,
      );

  for (let i = 0; i < activeBible.chapters.length; i++) {
    const chMeta = activeBible.chapters[i]!;
    const chPath = path.join(publicDir, chMeta.file);
    await fsp.mkdir(path.dirname(chPath), { recursive: true });
    const shouldWrite =
      options?.force ||
      !fs.existsSync(chPath) ||
      (() => {
        try {
          const prev = JSON.parse(fs.readFileSync(chPath, 'utf8')) as {
            entries?: unknown[];
          };
          return !Array.isArray(prev.entries) || prev.entries.length < 3;
        } catch {
          return true;
        }
      })();
    if (shouldWrite) {
      const fromAuthor = authoredChapters?.find(
        (c) => c.file === chMeta.file || c.file.endsWith(path.basename(chMeta.file)),
      );
      let chapter =
        fromAuthor?.json ??
        (await import('./storyAuthor.js').then((m) =>
          m.enrichChapterEntries(activeBible, i, userPrompt),
        ));
      if (chapter && Array.isArray(chapter['entries'])) {
        const { entries } = legalizeDialogueEntries(
          chapter['entries'] as Array<Record<string, unknown>>,
        );
        chapter = { ...chapter, entries };
      }
      await fsp.writeFile(chPath, `${JSON.stringify(chapter, null, 2)}\n`, 'utf8');
    }
  }

  // Runtime ContentDirector helper for Scenes
  await writeContentDirectorScaffold(workspace);

  return { biblePath, chapterPath, bible: activeBible };
}

/** Writes src/content/ContentDirector.ts — Scenes load bible/graph/NPC keys. */
export async function writeContentDirectorScaffold(
  workspace: string,
): Promise<string> {
  const dir = path.join(workspace, 'src', 'content');
  await fsp.mkdir(dir, { recursive: true });
  const outPath = path.join(dir, 'ContentDirector.ts');
  const body = `/**
 * GENERATED — Content Graph / STORY_BIBLE runtime director.
 * Scenes present this data; do not hardcode cast or chapter titles.
 */
export type StoryNpc = { id: string; role?: string; notes?: string };
export type StoryChapter = {
  id: string;
  title: string;
  file: string;
  npcs?: string[];
  quests?: string[];
};

export type StoryBible = {
  title: string;
  chapters: StoryChapter[];
  npcs: StoryNpc[];
  quests?: Array<{ id: string; title: string; giverNpcId?: string }>;
  endings?: Array<{ id: string; title: string; body: string }>;
  flags?: Record<string, boolean>;
  winCondition?: string;
};

${contentDirectorLayoutHelpersSource()}
export function npcAssetKey(npcId: string): string {
  return 'npc_' + npcId.toLowerCase().replace(/[^a-z0-9_]/g, '_');
}

export function chapterJsonKey(index: number): string {
  const pad = String(Math.max(1, index + 1)).padStart(2, '0');
  return 'og_story_chapter_' + pad;
}

export function chapterFile(index: number): string {
  const pad = String(Math.max(1, index + 1)).padStart(2, '0');
  return './story/chapter_' + pad + '.json';
}

export function readBibleFromCache(cache: {
  json: { get: (key: string) => unknown };
}): StoryBible | null {
  const raw = cache.json.get('og_story_bible') as StoryBible | undefined;
  if (!raw || !Array.isArray(raw.chapters)) return null;
  return raw;
}

export function chapterCount(bible: StoryBible | null): number {
  return Math.max(1, bible?.chapters?.length ?? 1);
}
`;
  await fsp.writeFile(outPath, body, 'utf8');
  return outPath;
}
