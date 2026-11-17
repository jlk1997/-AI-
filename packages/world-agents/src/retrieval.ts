/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * score = α·recency + β·importance + γ·relevance  (Park et al.)
 */

import type { MemoryEntry } from './memory.js';
import { isAdoptMemoryText, isPaidTraceMemory } from './copyLocale.js';

export interface RetrievalWeights {
  readonly alphaRecency: number;
  readonly betaImportance: number;
  readonly gammaRelevance: number;
  /** Hours half-life for exponential recency decay. */
  readonly recencyHalfLifeHours: number;
}

export const DEFAULT_RETRIEVAL_WEIGHTS: RetrievalWeights = {
  alphaRecency: 1,
  betaImportance: 1,
  gammaRelevance: 1,
  recencyHalfLifeHours: 24,
};

export function cosineSimilarity(
  a: readonly number[],
  b: readonly number[],
): number {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Keyword fallback when embeddings are absent. */
export function keywordRelevance(query: string, text: string): number {
  const q = query
    .toLowerCase()
    .split(/[\s,，。.!？?；;：:]+/)
    .filter((t) => t.length > 1);
  if (!q.length) return 0;
  const hay = text.toLowerCase();
  let hits = 0;
  for (const t of q) {
    if (hay.includes(t)) hits += 1;
  }
  return hits / q.length;
}

/** Park-style spatial recall: "where is X?" and "X …" should surface witness lines. */
function whereaboutsBoost(query: string, text: string): number {
  const witness =
    /在[^，,]{1,16}，正在/.test(text) ||
    /在[^，,]{1,16}(?:里|前)/.test(text) ||
    / is at /i.test(text);
  if (!witness) return 0;
  if (/在哪|哪里|去哪|去了哪儿|where\s+is|whereabouts/i.test(query)) {
    return 0.4;
  }
  // Converse queries are names + topic, not "在哪". Still prefer "铁砧在喷泉…"
  // when the query mentions 铁砧.
  const name = /^(.{1,12})在/.exec(text)?.[1];
  if (name && query.includes(name)) return 0.25;
  const nameEn = /^(.{1,24}) is at /i.exec(text)?.[1];
  if (nameEn && query.toLowerCase().includes(nameEn.toLowerCase())) return 0.25;
  return 0;
}

export function recencyScore(
  entry: MemoryEntry,
  nowSimTime: number,
  halfLifeHours: number,
): number {
  const age = Math.max(0, nowSimTime - entry.lastAccessSimTime);
  const decay = Math.pow(0.5, age / Math.max(0.1, halfLifeHours));
  return decay;
}

export function scoreMemory(
  entry: MemoryEntry,
  query: string,
  queryEmbedding: readonly number[] | undefined,
  nowSimTime: number,
  weights: RetrievalWeights = DEFAULT_RETRIEVAL_WEIGHTS,
): number {
  const recency = recencyScore(entry, nowSimTime, weights.recencyHalfLifeHours);
  // Paid traces (13–16) outrank ordinary max-10 gossip without flattening the 1–10 scale.
  const importance = Math.min(1.25, entry.importance / 10);
  let relevance = 0;
  // Dimensions differ while a world is migrating from the hash fallback to a
  // real embedding provider; comparing across spaces would score 0 for every
  // memory, so fall back to keywords per entry instead.
  if (
    queryEmbedding &&
    entry.embedding?.length === queryEmbedding.length
  ) {
    relevance = cosineSimilarity(queryEmbedding, entry.embedding);
  } else {
    relevance = keywordRelevance(query, entry.text);
  }
  relevance = Math.min(
    1,
    relevance +
      whereaboutsBoost(query, entry.text) +
      interventionBoost(entry.text) +
      adoptQueryBoost(query, entry.text),
  );
  return (
    weights.alphaRecency * recency +
    weights.betaImportance * importance +
    weights.gammaRelevance * relevance
  );
}

/** Paid 巷议 / whisper / 认养 must surface on the next speak, not only when asked. */
function interventionBoost(text: string): number {
  return isPaidTraceMemory(text) ? 0.35 : 0;
}

/** Asking about 认养 must rank the adopt memory above other paid traces. */
function adoptQueryBoost(query: string, text: string): number {
  if (!/认养|adopt/i.test(query)) return 0;
  if (isAdoptMemoryText(text)) return 0.6;
  if (isPaidTraceMemory(text)) return 0.2;
  return 0;
}

export function retrieveMemories(
  memories: readonly MemoryEntry[],
  query: string,
  nowSimTime: number,
  options?: {
    readonly limit?: number;
    readonly queryEmbedding?: readonly number[];
    readonly weights?: RetrievalWeights;
  },
): MemoryEntry[] {
  const limit = options?.limit ?? 8;
  const weights = options?.weights ?? DEFAULT_RETRIEVAL_WEIGHTS;
  const scored = memories.map((m) => ({
    m,
    s: scoreMemory(m, query, options?.queryEmbedding, nowSimTime, weights),
  }));
  scored.sort((a, b) => b.s - a.s);
  const top = scored.slice(0, limit).map((x) => x.m);
  for (const m of top) {
    m.lastAccessSimTime = nowSimTime;
  }
  return top;
}
