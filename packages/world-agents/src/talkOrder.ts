/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Clock copy is hour-only. Same-simTime circles need a monotone talkSeq so
 * stage, inspector, and replay all agree on who spoke first.
 */

export interface TalkOrderStamp {
  readonly talkSeq: number;
  readonly circleIndex: number;
}

export interface TalkOrderEvent {
  readonly id: string;
  readonly simTime: number;
  readonly payload?: Record<string, unknown> | null;
  readonly createdAtMs?: number;
}

export function talkSeqOf(
  payload: Record<string, unknown> | null | undefined,
): number {
  const n = Number(payload?.['talkSeq']);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function circleIndexOf(
  payload: Record<string, unknown> | null | undefined,
): number {
  const n = Number(payload?.['circleIndex']);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function stampNextTalk(
  state: { talkSeq?: number },
  circleIndex: number,
): TalkOrderStamp {
  state.talkSeq = (state.talkSeq ?? 0) + 1;
  return { talkSeq: state.talkSeq, circleIndex };
}

export function restoreTalkSeqFromEvents(
  state: { talkSeq?: number },
  events: ReadonlyArray<{ payload?: Record<string, unknown> | null }>,
): void {
  let max = state.talkSeq ?? 0;
  for (const e of events) {
    const n = talkSeqOf(e.payload);
    if (n > max) max = n;
  }
  state.talkSeq = max;
}

export function compareSocietyTalkOrder(
  a: TalkOrderEvent,
  b: TalkOrderEvent,
): number {
  if (a.simTime !== b.simTime) return a.simTime - b.simTime;
  const sa = talkSeqOf(a.payload);
  const sb = talkSeqOf(b.payload);
  if (sa !== sb) return sa - sb;
  const ca = a.createdAtMs ?? 0;
  const cb = b.createdAtMs ?? 0;
  if (ca !== cb) return ca - cb;
  return String(a.id).localeCompare(String(b.id));
}
