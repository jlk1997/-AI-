/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Batch importance scoring (Park et al.) — one LLM call for many memories.
 */

import type { LlmTextFn } from './reflect.js';

/** Heuristic 1–10 when no LLM. */
export function heuristicImportance(text: string): number {
  const t = text.toLowerCase();
  let score = 3;
  if (/party|聚会|gathering|valentine|invitation|invite|rumor|whisper|秘密|阴谋|传闻|悄悄|在传/.test(t)) {
    score += 4;
  }
  if (/death|die|attack|danger|fire|broken|alarm|背叛|危险|死了|出事/.test(t)) {
    score += 3;
  }
  if (/love|friend|relation|promise|gift|love|朋友|约定/.test(t)) {
    score += 2;
  }
  if (/work|lunch|breakfast|sleep|chore|idle/.test(t)) {
    score -= 1;
  }
  return Math.max(1, Math.min(10, score));
}

/**
 * Score many texts in one LLM call. Falls back to heuristics per-item.
 */
export async function scoreImportanceBatch(
  texts: readonly string[],
  llm?: LlmTextFn,
): Promise<number[]> {
  if (!texts.length) return [];
  if (!llm) return texts.map(heuristicImportance);

  const prompt = `Rate the lasting importance of each memory for a generative agent (1=trivial daily chore, 10=life-changing).
Return ONLY a JSON array of ${texts.length} integers.
Memories:
${texts.map((t, i) => `${i + 1}. ${t.slice(0, 160)}`).join('\n')}`;

  try {
    const raw = await llm(prompt);
    const start = raw.indexOf('[');
    const end = raw.lastIndexOf(']');
    const arr = JSON.parse(raw.slice(start, end + 1)) as unknown[];
    if (!Array.isArray(arr) || arr.length !== texts.length) {
      return texts.map(heuristicImportance);
    }
    return arr.map((v, i) => {
      const n = Number(v);
      if (!Number.isFinite(n)) return heuristicImportance(texts[i]!);
      return Math.max(1, Math.min(10, Math.round(n)));
    });
  } catch {
    return texts.map(heuristicImportance);
  }
}
