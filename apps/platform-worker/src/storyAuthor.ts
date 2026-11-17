/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Optional LLM story author — enriches STORY_BIBLE + chapter graphs.
 * Falls back to heuristic chapters when LLM is skipped / fails.
 */

import type { StoryBible } from './storyOutline.js';
import {
  buildChapterFromBible,
  buildHeuristicStoryBible,
  ensureStoryEndings,
  legalizeDialogueEntries,
} from './storyOutline.js';

function shouldSkipStoryLlm(): boolean {
  const v = process.env['PLATFORM_SKIP_STORY_LLM']?.trim().toLowerCase();
  if (v === 'true' || v === '1' || v === 'yes') return true;
  // Follow GDD skip when user hollowed design stage intentionally.
  const gdd = process.env['PLATFORM_SKIP_GDD_LLM']?.trim().toLowerCase();
  return gdd === 'true' || gdd === '1' || gdd === 'yes';
}

function extractJsonObject(text: string): unknown | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced?.[1]?.trim() ?? text.trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1)) as unknown;
  } catch {
    return null;
  }
}

/** Enrich chapter dialogue with prompt-specific flavor (no LLM). */
export function enrichChapterEntries(
  bible: StoryBible,
  chapterIndex: number,
  userPrompt: string,
): Record<string, unknown> {
  const base = buildChapterFromBible(bible, chapterIndex);
  const raw = [...((base.entries as Array<Record<string, unknown>>) ?? [])];
  const snippet = userPrompt.trim().slice(0, 80);
  const chapter = bible.chapters[chapterIndex];
  const isLast = chapterIndex >= bible.chapters.length - 1;
  const intro = raw.find((e) => e['id'] === 'intro');
  if (intro) {
    intro['text'] = `${chapter?.title ?? `Chapter ${chapterIndex + 1}`}: ${snippet || bible.title}`;
  }
  const meet = raw.find((e) => e['id'] === 'meet_a');
  if (meet && typeof meet['speaker'] === 'string') {
    const beats = [
      `${meet['speaker']}: The town gate opens — will you listen?`,
      `${meet['speaker']}: Rumors of scrap iron and a missing scroll…`,
      `${meet['speaker']}: The final choice will decide who remembers you.`,
      `${meet['speaker']}: Night falls. One more favor remains.`,
    ];
    meet['text'] = beats[chapterIndex % beats.length];
  }
  if (isLast) {
    const listen = raw.find((e) => e['id'] === 'path_listen');
    if (listen) {
      listen['text'] =
        'Your choice echoes — the ending is set by the flag you carry.';
    }
  }
  const { entries } = legalizeDialogueEntries(raw);
  return { ...base, entries, authored: 'heuristic-enriched' };
}

async function callStoryLlm(prompt: string): Promise<string | null> {
  const apiKey =
    process.env['OPENGAME_REASONING_API_KEY']?.trim() ||
    process.env['OPENAI_API_KEY']?.trim() ||
    process.env['MINIMAX_API_KEY']?.trim();
  const baseUrl = (
    process.env['OPENGAME_REASONING_BASE_URL']?.trim() ||
    process.env['OPENAI_BASE_URL']?.trim() ||
    'https://api.openai.com/v1'
  ).replace(/\/$/, '');
  const model =
    process.env['OPENGAME_REASONING_MODEL']?.trim() ||
    process.env['OPENAI_MODEL']?.trim() ||
    'gpt-4o-mini';
  if (!apiKey) return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 45_000);
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.7,
        messages: [
          {
            role: 'system',
            content:
              'You author short playable game stories as JSON only. Every dialogue branch terminal MUST use "nextId": null. No fall-through after branches.',
          },
          { role: 'user', content: prompt },
        ],
      }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return data.choices?.[0]?.message?.content ?? null;
  } catch {
    return null;
  }
}

export interface AuthoredStoryResult {
  readonly bible: StoryBible;
  readonly chapters: Array<{ readonly file: string; readonly json: Record<string, unknown> }>;
  readonly source: 'llm-outline' | 'heuristic-outline';
}

/**
 * Author multi-chapter story. Tries LLM when design stage is open; always
 * returns a legal graph (terminals nextId:null).
 */
export async function authorMultiChapterStory(
  userPrompt: string,
  options?: { readonly designBrief?: string | null },
): Promise<AuthoredStoryResult> {
  const heuristic = buildHeuristicStoryBible(userPrompt);
  if (shouldSkipStoryLlm()) {
    return {
      bible: heuristic,
      chapters: heuristic.chapters.map((_, i) => ({
        file: heuristic.chapters[i]!.file,
        json: enrichChapterEntries(heuristic, i, userPrompt),
      })),
      source: 'heuristic-outline',
    };
  }

  const prompt = `User game request:
${userPrompt.slice(0, 1200)}

Design brief (if any):
${(options?.designBrief ?? '').slice(0, 800)}

Return JSON:
{
  "title": "...",
  "npcs": [{"id":"Guide","role":"quest_giver","notes":"..."}, ...],
  "quests": [{"id":"q_intro","title":"...","status":"available","giverNpcId":"Guide"}, ...],
  "flags": {"ending_a":false,"ending_b":false},
  "winCondition": "...",
  "endings": [
    {"id":"ending_a","title":"结局甲 · ...","body":"完成任务/守约的中文短结局"},
    {"id":"ending_b","title":"结局乙 · ...","body":"另一条路的中文短结局，须与甲不同"}
  ],
  "chapters": [
    {
      "id":"chapter_01","title":"...","file":"story/chapter_01.json",
      "npcs":["Guide"],"quests":["q_intro"],"winCondition":"...",
      "entries":[
        {"id":"intro","type":"text","speaker":"Narrator","text":"...","nextId":"meet"},
        {"id":"meet","type":"text","speaker":"Guide","text":"...","nextId":"choice"},
        {"id":"choice","type":"choice","prompt":"...","options":[
          {"label":"A","nextId":"path_a"},{"label":"B","nextId":"path_b"}
        ]},
        {"id":"path_a","type":"event","action":"set_flag","data":{"flag":"ending_a","value":true},"nextId":null},
        {"id":"path_b","type":"text","speaker":"Guide","text":"...","nextId":null}
      ]
    }
  ]
}
Rules: 2-4 chapters for RPG/story; ≥3 NPCs; ≥2 quests; ≥2 endings (ending_a/ending_b with distinct Chinese title+body); every branch ends with nextId:null; include a choice node per chapter.`;

  const llmText = await callStoryLlm(prompt);
  const parsed = llmText ? extractJsonObject(llmText) : null;
  if (!parsed || typeof parsed !== 'object') {
    return {
      bible: heuristic,
      chapters: heuristic.chapters.map((_, i) => ({
        file: heuristic.chapters[i]!.file,
        json: enrichChapterEntries(heuristic, i, userPrompt),
      })),
      source: 'heuristic-outline',
    };
  }

  try {
    const obj = parsed as Record<string, unknown>;
    const npcsRaw = Array.isArray(obj['npcs']) ? obj['npcs'] : heuristic.npcs;
    const questsRaw = Array.isArray(obj['quests']) ? obj['quests'] : heuristic.quests;
    const chaptersRaw = Array.isArray(obj['chapters'])
      ? obj['chapters']
      : [];
    if (chaptersRaw.length < 1) throw new Error('no chapters');

    const npcs = (npcsRaw as Array<Record<string, unknown>>)
      .map((n, i) => ({
        id: String(n['id'] ?? heuristic.npcs[i]?.id ?? `Npc${i + 1}`),
        role: String(n['role'] ?? 'flavor'),
        notes: String(n['notes'] ?? ''),
      }))
      .slice(0, 6);
    while (npcs.length < 2) {
      npcs.push({
        id: heuristic.npcs[npcs.length]?.id ?? `Npc${npcs.length + 1}`,
        role: 'flavor',
        notes: '',
      });
    }

    const quests = (questsRaw as Array<Record<string, unknown>>)
      .map((q, i) => ({
        id: String(q['id'] ?? `q_${i}`),
        title: String(q['title'] ?? `Quest ${i + 1}`),
        status: (String(q['status'] ?? 'available') as StoryBible['quests'][number]['status']),
        giverNpcId:
          typeof q['giverNpcId'] === 'string' ? q['giverNpcId'] : npcs[0]?.id,
      }))
      .slice(0, 4);

    const flags =
      obj['flags'] && typeof obj['flags'] === 'object'
        ? (obj['flags'] as Record<string, boolean>)
        : heuristic.flags;

    const chaptersMeta: StoryBible['chapters'] = [];
    const chaptersOut: AuthoredStoryResult['chapters'] = [];

    for (let i = 0; i < Math.min(4, chaptersRaw.length); i++) {
      const ch = chaptersRaw[i] as Record<string, unknown>;
      const pad = String(i + 1).padStart(2, '0');
      const id = String(ch['id'] ?? `chapter_${pad}`);
      const file = String(ch['file'] ?? `story/chapter_${pad}.json`);
      const title = String(ch['title'] ?? `Chapter ${i + 1}`);
      chaptersMeta.push({
        id,
        title,
        file,
        npcs: Array.isArray(ch['npcs'])
          ? (ch['npcs'] as string[])
          : [npcs[i % npcs.length]!.id],
        quests: quests.map((q) => q.id),
        winCondition: String(ch['winCondition'] ?? 'Advance or set ending flag'),
      });
      let entries = Array.isArray(ch['entries'])
        ? (ch['entries'] as Array<Record<string, unknown>>)
        : [];
      if (entries.length < 3) {
        entries = enrichChapterEntries(
          {
            ...heuristic,
            chapters: chaptersMeta,
            npcs,
            quests,
          },
          i,
          userPrompt,
        ).entries as Array<Record<string, unknown>>;
      }
      const legalized = legalizeDialogueEntries(entries);
      if (legalized.issues.length > 0) {
        // Fall back to heuristic chapter for this index
        entries = enrichChapterEntries(
          {
            ...heuristic,
            chapters: chaptersMeta.length
              ? chaptersMeta
              : heuristic.chapters,
            npcs,
            quests,
          },
          i,
          userPrompt,
        ).entries as Array<Record<string, unknown>>;
        const again = legalizeDialogueEntries(entries);
        entries = again.entries;
      } else {
        entries = legalized.entries;
      }
      chaptersOut.push({
        file,
        json: {
          schema: 'opengame-story-chapter-v1',
          id,
          title,
          bibleTitle: String(obj['title'] ?? heuristic.title),
          entries,
          authored: 'llm-outline',
        },
      });
    }

    const endingsRaw = Array.isArray(obj['endings']) ? obj['endings'] : [];
    const endingsParsed = (endingsRaw as Array<Record<string, unknown>>)
      .map((e) => ({
        id: String(e['id'] ?? '') as 'ending_a' | 'ending_b',
        title: String(e['title'] ?? ''),
        body: String(e['body'] ?? ''),
      }))
      .filter((e) => e.id === 'ending_a' || e.id === 'ending_b');

    const bible: StoryBible = ensureStoryEndings({
      schema: 'opengame-story-bible-v1',
      title: String(obj['title'] ?? heuristic.title),
      chapters: chaptersMeta,
      npcs,
      quests,
      endings: endingsParsed.length
        ? endingsParsed
        : heuristic.endings,
      flags,
      winCondition: String(obj['winCondition'] ?? heuristic.winCondition),
      source: 'llm-outline',
    }, userPrompt);

    return { bible, chapters: chaptersOut, source: 'llm-outline' };
  } catch {
    return {
      bible: heuristic,
      chapters: heuristic.chapters.map((_, i) => ({
        file: heuristic.chapters[i]!.file,
        json: enrichChapterEntries(heuristic, i, userPrompt),
      })),
      source: 'heuristic-outline',
    };
  }
}
