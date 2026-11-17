/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { summarizeWorldSpec, type WorldSpec } from '@opengame/world-spec';

export type MemoryKind = 'fact' | 'episode' | 'dialogue' | 'quest';

export interface WorldMemoryEntry {
  readonly id: string;
  readonly kind: MemoryKind;
  readonly text: string;
  readonly tags: string[];
  readonly createdAt: string;
  readonly importance: number;
}

export interface WorldMemoryStore {
  readonly entries: WorldMemoryEntry[];
}

export function createMemoryStore(
  seed?: readonly WorldMemoryEntry[],
): WorldMemoryStore {
  return { entries: [...(seed ?? [])] };
}

export function remember(
  store: WorldMemoryStore,
  entry: Omit<WorldMemoryEntry, 'id' | 'createdAt'> & {
    readonly id?: string;
  },
): WorldMemoryStore {
  const next: WorldMemoryEntry = {
    id: entry.id ?? `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    kind: entry.kind,
    text: entry.text,
    tags: entry.tags,
    importance: entry.importance,
    createdAt: new Date().toISOString(),
  };
  return { entries: [...store.entries, next] };
}

/** Keyword retrieval — replaceable with embeddings later. */
export function retrieveMemories(
  store: WorldMemoryStore,
  query: string,
  limit = 8,
): WorldMemoryEntry[] {
  const tokens = query
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length > 2);
  const scored = store.entries.map((e) => {
    const hay = `${e.text} ${e.tags.join(' ')}`.toLowerCase();
    let score = e.importance;
    for (const t of tokens) {
      if (hay.includes(t)) score += 1;
    }
    return { e, score };
  });
  return scored
    .filter((s) => s.score > 0 || tokens.length === 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.e);
}

/**
 * Build a sparse prompt block: world summary + retrieved memories.
 * Replaces dumping full chat history into the coder agent.
 */
export function formatWorldContextForPrompt(
  world: WorldSpec,
  store: WorldMemoryStore,
  userQuery: string,
  maxChars = 4000,
): string {
  const summary = summarizeWorldSpec(world, 1200);
  const worldFacts = extractFactsFromWorld(world)
    .filter((f) => /^(rumor|secret|object):/.test(f))
    .slice(0, 8);
  const mems = retrieveMemories(store, userQuery, 6);
  const memBlock =
    mems.length > 0
      ? mems.map((m) => `- [${m.kind}] ${m.text}`).join('\n')
      : '(no memories yet)';
  const text = [
    '【World Spec 摘要】',
    summary,
    ...(worldFacts.length
      ? ['', '【开场事实】', worldFacts.map((f) => `- ${f}`).join('\n')]
      : []),
    '',
    '【相关记忆】',
    memBlock,
    '',
    '【本轮指令】',
    userQuery,
  ].join('\n');
  return text.slice(0, maxChars);
}

export function ingestSimEvents(
  store: WorldMemoryStore,
  events: readonly { type: string; payload?: Record<string, unknown> }[],
): WorldMemoryStore {
  let next = store;
  for (const ev of events) {
    if (
      ev.type === 'quest_started' ||
      ev.type === 'quest_completed' ||
      ev.type === 'flag_set'
    ) {
      next = remember(next, {
        kind: ev.type.startsWith('quest') ? 'quest' : 'fact',
        text: `${ev.type}: ${JSON.stringify(ev.payload ?? {})}`,
        tags: [ev.type],
        importance: 2,
      });
    }
  }
  return next;
}

/** Extract fact lines from world flags/quests for curator-style seeding. */
export function extractFactsFromWorld(world: WorldSpec): string[] {
  const facts: string[] = [];
  const rumor = world.presentation.openingRumor?.trim();
  if (rumor) facts.push(`rumor:${rumor}`);
  for (const [k, v] of Object.entries(world.narrative.flags)) {
    facts.push(`flag:${k}=${v}`);
  }
  for (const q of world.narrative.quests) {
    facts.push(`quest:${q.id}:${q.status}:${q.title}`);
  }
  for (const e of world.entities.filter((x) => x.kind === 'npc')) {
    facts.push(`npc:${e.id}:${e.name}:${e.personality ?? ''}`);
    const secret = e.identity?.secret?.trim();
    if (secret) facts.push(`secret:${e.name}:${secret}`);
    const stance = e.identity?.stance?.trim();
    if (stance) facts.push(`stance:${e.name}:${stance}`);
  }
  for (const area of world.space.areas ?? []) {
    for (const obj of area.objects ?? []) {
      const state = obj.state?.trim() ?? '';
      if (state.length >= 6) facts.push(`object:${obj.name}:${state}`);
    }
  }
  return facts;
}
