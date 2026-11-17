/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Core-resident opinions and the prompt budget that keeps a belief card small.
 */

export {
  applyAppraisal,
  applyTalkOutcomes,
  noteUtterance,
  parseAppraisal,
  parseTalkOutcomes,
  rewriteBeliefCard,
  rollTopicSummary,
  topicIsStale,
  trimBelief,
  utteranceFingerprint,
  type OpinionRow,
  type TalkOutcomes,
} from './societyMind.js';

/** One short belief line per speaker, never a full memory dump. */
export function beliefNoteFor(
  cards: Readonly<Record<string, string>> | undefined,
  ids: readonly string[],
): string {
  if (!cards) return '';
  return ids
    .map((id) => cards[id]?.trim())
    .filter((s): s is string => Boolean(s))
    .join(' / ')
    .slice(0, 400);
}

/** Drop memory lines once the shared character budget is spent. */
export function takeMemoryBudget(
  lines: readonly string[],
  budget: number,
): string[] {
  const out: string[] = [];
  let left = Math.max(0, budget);
  for (const line of lines) {
    if (left <= 0) break;
    const bit = line.slice(0, Math.min(90, left));
    if (!bit) break;
    out.push(bit);
    left -= bit.length;
  }
  return out;
}
