/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * A line that adds nothing — no new fact, no shift in relation, plan, or
 * feeling — is not shown. Boredom pushes a person off a topic the town is
 * already stuck on.
 */

import { clamp01 } from './rng.js';

export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s,，。！？!?；;：:\-「」"'“”]+/)
    .filter((t) => (/[\u4e00-\u9fff]/.test(t) ? t.length >= 2 : t.length > 2));
}

export function jaccard(a: readonly string[], b: readonly string[]): number {
  if (!a.length || !b.length) return 0;
  const sb = new Set(b);
  let inter = 0;
  for (const t of new Set(a)) if (sb.has(t)) inter += 1;
  const union = new Set([...a, ...b]).size;
  return union ? inter / union : 0;
}

/** 1 means the line is new. 0 means it restates what was just said. */
export function noveltyScore(line: string, recent: readonly string[]): number {
  const mine = tokens(line);
  if (!mine.length) return 0;
  let max = 0;
  for (const prev of recent.slice(-12)) {
    max = Math.max(max, jaccard(mine, tokens(prev)));
  }
  return 1 - max;
}

export function topicKey(text: string): string {
  const t = tokens(text);
  return t.slice(0, 3).join('') || text.slice(0, 8);
}

export function topicWeight(key: string, counts: Readonly<Record<string, number>>): number {
  const total = Object.values(counts).reduce((s, n) => s + n, 0) || 1;
  const share = (counts[key] ?? 0) / total;
  if (share > 0.45) return 0.25;
  if (share > 0.3) return 0.5;
  return 1;
}

export function nextBoredom(prev: number, sameTopic: boolean): number {
  return clamp01(sameTopic ? prev + 0.18 : prev * 0.6);
}

export type DialogueDelta = {
  readonly newFact: boolean;
  readonly relationChanged: boolean;
  readonly planChanged: boolean;
  readonly emotionChanged: boolean;
};

export function dialogueChanged(delta: DialogueDelta): boolean {
  return (
    delta.newFact || delta.relationChanged || delta.planChanged || delta.emotionChanged
  );
}
