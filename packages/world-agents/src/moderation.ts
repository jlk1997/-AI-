/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Last-line check before a spoken turn is stored. This is a denylist, not a
 * rewrite of the town's voice.
 */

const BLOCKED: readonly RegExp[] = [
  /儿童色情|幼童色情|child\s*porn|csam/i,
  /未成年.{0,6}(性交|裸照)/,
];

export function reviewTalkLine(text: string): { readonly ok: boolean; readonly text: string } {
  const raw = text ?? '';
  if (BLOCKED.some((rule) => rule.test(raw))) {
    return { ok: false, text: '……' };
  }
  return { ok: true, text: raw };
}

export function moderateSocietyEvents<
  T extends { readonly kind: string; readonly payload: Record<string, unknown> },
>(events: readonly T[]): T[] {
  return events.map((event) => {
    if (event.kind !== 'dialogue' || !Array.isArray(event.payload['turns'])) return event;
    let changed = false;
    const turns = (event.payload['turns'] as Array<Record<string, unknown>>).map((turn) => {
      if (!turn || typeof turn['text'] !== 'string') return turn;
      const reviewed = reviewTalkLine(turn['text']);
      if (reviewed.ok) return turn;
      changed = true;
      return { ...turn, text: reviewed.text, moderated: true };
    });
    if (!changed) return event;
    return { ...event, payload: { ...event.payload, turns, moderated: true } };
  });
}
