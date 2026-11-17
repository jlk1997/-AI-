/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Each resident keeps their own version. Night compresses the day.
 * Trauma sticks. Ordinary detail can fade or warp.
 */

import { clamp01 } from './rng.js';
import { shockEmotion, type Goal, type Psyche } from './psyche.js';

export type SubjectiveMemory = {
  readonly id: string;
  readonly text: string;
  readonly hour: number;
  readonly weight: number;
  readonly trauma: boolean;
  readonly distorted: boolean;
};

export function memoryWeight(text: string, psyche: Psyche): number {
  const goalHit = psyche.goals.some((g) => g.text && text.includes(g.text.slice(0, 4)))
    ? 0.35
    : 0;
  const emotion =
    (psyche.emotions.anger + psyche.emotions.fear + psyche.emotions.sadness) / 3;
  const trauma = /死|伤|抓|烧|血/.test(text) ? 0.4 : 0;
  return clamp01(0.2 + goalHit + emotion * 0.3 + trauma);
}

export function maybeDistort(text: string, rng: () => number, trauma: boolean): {
  readonly text: string;
  readonly distorted: boolean;
} {
  if (trauma || rng() > 0.08) return { text, distorted: false };
  return { text: `${text}（我后来觉得好像不是这样）`, distorted: true };
}

export function rankMemories(
  memories: readonly SubjectiveMemory[],
  psyche: Psyche,
): SubjectiveMemory[] {
  return [...memories].sort((a, b) => {
    const wa = a.weight * (a.trauma ? 1.4 : 1) + memoryWeight(a.text, psyche) * 0.2;
    const wb = b.weight * (b.trauma ? 1.4 : 1) + memoryWeight(b.text, psyche) * 0.2;
    return wb - wa;
  });
}

export function consolidateNight(
  psyche: Psyche,
  memories: readonly SubjectiveMemory[],
  rng: () => number,
): { readonly psyche: Psyche; readonly memories: SubjectiveMemory[] } {
  const ranked = rankMemories(memories, psyche);
  const kept = ranked.filter((m) => m.trauma || m.weight >= 0.25).slice(0, 24);
  const faded = ranked
    .filter((m) => !m.trauma && m.weight < 0.25)
    .slice(0, 4)
    .map((m) => maybeDistort(m.text, rng, false))
    .filter((m) => m.distorted)
    .map((m, i) => ({
      id: `fade_${i}`,
      text: m.text,
      hour: 0,
      weight: 0.2,
      trauma: false,
      distorted: true,
    }));
  const top = kept[0];
  let next = psyche;
  if (top) {
    const belief = top.text.slice(0, 40);
    next = {
      ...next,
      narrative: `${psyche.narrative} 夜里想起来：${belief}`.slice(0, 280),
    };
    if (top.trauma) next = shockEmotion(next, { fear: 0.05, sadness: 0.04 });
    const goals: Goal[] = next.goals.map((g) =>
      top.text.includes(g.text.slice(0, 4))
        ? { ...g, progress: clamp01(g.progress + 0.05) }
        : g,
    );
    next = { ...next, goals };
  }
  return { psyche: next, memories: [...kept, ...faded].slice(0, 28) };
}
