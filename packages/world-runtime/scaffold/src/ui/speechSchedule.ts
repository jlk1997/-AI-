/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Turn-taking for live speech bubbles.
 *
 * A society tick delivers a whole conversation (and often several parallel
 * conversations) in one frame. Pinning every speaker at once made the town pop
 * six bubbles in the same instant with no readable order, so this module lays
 * the turns out on a wall-clock timeline: one turn at a time inside a
 * conversation, each bubble holding only as long as its line takes to read.
 */

export interface SpeechTurnInput {
  readonly speakerId: string;
  readonly speakerName?: string;
  readonly text: string;
  /** Who the line is aimed at — used for the caption, not for timing. */
  readonly toName?: string;
}

export interface SpeechCue extends SpeechTurnInput {
  /** Wall-clock time (same base as `startAtMs`) the bubble appears. */
  readonly atMs: number;
  /** How long the bubble stays before it fades on its own. */
  readonly holdMs: number;
  readonly turnIndex: number;
}

export interface SpeechPacing {
  readonly baseMs: number;
  readonly msPerChar: number;
  readonly minHoldMs: number;
  readonly maxHoldMs: number;
  /** The reply overlaps the tail of the previous line so it reads as a exchange. */
  readonly overlapMs: number;
  /** A single conversation may not occupy the stage for longer than this. */
  readonly budgetMs: number;
  readonly maxTurns: number;
  /** Never compress below this or the lines become unreadable flickers. */
  readonly minPace: number;
}

export const DEFAULT_SPEECH_PACING: SpeechPacing = {
  baseMs: 480,
  msPerChar: 28,
  minHoldMs: 800,
  maxHoldMs: 1600,
  overlapMs: 120,
  budgetMs: 4200,
  maxTurns: 3,
  minPace: 0.45,
};

/** Reading time for one line, clamped so neither extreme stalls the town. */
export function speechHoldMs(
  text: string,
  pacing: SpeechPacing = DEFAULT_SPEECH_PACING,
): number {
  const chars = text.trim().length;
  const raw = pacing.baseMs + chars * pacing.msPerChar;
  return Math.round(
    Math.min(pacing.maxHoldMs, Math.max(pacing.minHoldMs, raw)),
  );
}

export interface ScheduleOptions {
  readonly startAtMs: number;
  readonly pacing?: SpeechPacing;
  /**
   * Per-speaker wall-clock time the resident is free again. Keeps a resident who
   * appears in two conversations from talking over themselves.
   */
  readonly busyUntilMs?: ReadonlyMap<string, number>;
}

/**
 * Lay one conversation out as an ordered exchange. Returned cues are sorted by
 * `atMs` and never overlap for the same speaker.
 */
export function scheduleConversation(
  turns: readonly SpeechTurnInput[],
  opts: ScheduleOptions,
): SpeechCue[] {
  const pacing = opts.pacing ?? DEFAULT_SPEECH_PACING;
  const usable = turns
    .filter((t) => t.speakerId && t.text.trim().length > 0)
    .slice(0, pacing.maxTurns);
  if (!usable.length) return [];

  const holds = usable.map((t) => speechHoldMs(t.text, pacing));
  const span =
    holds.reduce((sum, h) => sum + h, 0) -
    pacing.overlapMs * (holds.length - 1);
  const pace =
    span > pacing.budgetMs
      ? Math.max(pacing.minPace, pacing.budgetMs / span)
      : 1;

  const busy = new Map(opts.busyUntilMs ?? []);
  const cues: SpeechCue[] = [];
  let openAt = opts.startAtMs;
  usable.forEach((turn, index) => {
    const holdMs = Math.max(700, Math.round(holds[index]! * pace));
    const free = busy.get(turn.speakerId) ?? 0;
    const atMs = Math.round(Math.max(openAt, free));
    cues.push({ ...turn, atMs, holdMs, turnIndex: index });
    busy.set(turn.speakerId, atMs + holdMs);
    openAt = atMs + Math.max(280, holdMs - Math.round(pacing.overlapMs * pace));
  });
  return cues;
}

/** When the last bubble of a scheduled exchange goes away. */
export function conversationEndMs(cues: readonly SpeechCue[]): number {
  let end = 0;
  for (const cue of cues) end = Math.max(end, cue.atMs + cue.holdMs);
  return end;
}

/** Gap after one circle finishes before the next circle may open. */
export const CIRCLE_GAP_MS = 700;

/** Next circle starts after the previous one has been heard. */
export function nextCircleStartMs(
  prevEndMs: number,
  now: number,
  gapMs = CIRCLE_GAP_MS,
): number {
  return Math.max(now, prevEndMs + gapMs);
}

/** Arm camera / partner chrome only when this circle actually opens. */
export function shouldArmCircleStage(
  followEventId: string | null | undefined,
  nextEventId: string,
): boolean {
  return Boolean(nextEventId) && followEventId !== nextEventId;
}

/** `第2圈 · 石头 → 铁柱 · 窑火天亮前就灭了` — one line, the one being heard. */
export function liveSpeechCaption(input: {
  readonly text: string;
  readonly speakerName?: string;
  readonly toName?: string;
  readonly circleIndex?: number;
  readonly ascii?: boolean;
}): string {
  const sep = ' · ';
  const who = input.speakerName?.trim();
  const line = input.text.trim();
  const body = !who
    ? line
    : input.toName?.trim()
      ? `${who} → ${input.toName.trim()}${sep}${line}`
      : `${who}${sep}${line}`;
  const n = Number(input.circleIndex);
  if (Number.isFinite(n) && n > 0) {
    return input.ascii ? `Circle ${n}${sep}${body}` : `第${n}圈${sep}${body}`;
  }
  return body;
}

export function talkSeqOfPayload(
  payload: Record<string, unknown> | null | undefined,
): number {
  const n = Number(payload?.['talkSeq']);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function circleIndexOfPayload(
  payload: Record<string, unknown> | null | undefined,
): number {
  const n = Number(payload?.['circleIndex']);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function compareReplayTalkOrder(
  a: { id: string; simTime: number; payload?: Record<string, unknown> | null },
  b: { id: string; simTime: number; payload?: Record<string, unknown> | null },
): number {
  if (a.simTime !== b.simTime) return a.simTime - b.simTime;
  const sa = talkSeqOfPayload(a.payload);
  const sb = talkSeqOfPayload(b.payload);
  if (sa !== sb) return sa - sb;
  return String(a.id).localeCompare(String(b.id));
}

/**
 * Keep a live buffer of recent beats, plus every intervene and the last
 * dialogues, then restore talkSeq order. A simTime-only trim used to shuffle
 * same-hour circles.
 */
export function pinNarrativeTalkEvents<
  T extends {
    id: string;
    simTime: number;
    kind: string;
    payload?: Record<string, unknown> | null;
  },
>(events: readonly T[], cap: number): T[] {
  const filtered = events.filter((e) => e.kind !== 'emergence_report');
  const ordered = [...filtered].sort(compareReplayTalkOrder);
  const keep = Math.max(1, Math.trunc(cap) || 1);
  const recent = ordered.slice(-keep);
  const extra = [
    ...ordered.filter((e) => e.kind === 'intervene'),
    ...ordered.filter((e) => e.kind === 'dialogue').slice(-24),
  ];
  const byId = new Map<string, T>();
  for (const e of extra) byId.set(e.id, e);
  for (const e of recent) byId.set(e.id, e);
  return [...byId.values()].sort(compareReplayTalkOrder);
}

/** Latest clock hour's dialogues, earliest talkSeq first. */
export function openingCirclesAtTip<
  T extends {
    id: string;
    simTime: number;
    kind: string;
    payload?: Record<string, unknown> | null;
  },
>(events: readonly T[]): T[] {
  const talks = events
    .filter(
      (e) => e.kind === 'dialogue' && e.payload?.['degraded'] !== true,
    )
    .slice()
    .sort(compareReplayTalkOrder);
  if (!talks.length) return [];
  const tip = talks[talks.length - 1]!.simTime;
  return talks.filter((e) => Math.abs(e.simTime - tip) < 0.01);
}

/** One circle at a given cursor: live event, else latest talkSeq at this hour. */
export function pickCurrentTalkEvent<
  T extends {
    id: string;
    simTime: number;
    kind: string;
    payload?: Record<string, unknown> | null;
  },
>(
  events: readonly T[],
  cursor: number,
  liveEventId?: string | null,
): T | undefined {
  const due = events.filter(
    (e) =>
      e.kind === 'dialogue' &&
      e.simTime <= cursor &&
      e.payload?.['degraded'] !== true,
  );
  if (liveEventId) {
    const live = due.find((e) => e.id === liveEventId);
    if (live) return live;
  }
  if (!due.length) return undefined;
  let latestT = -Infinity;
  for (const e of due) if (e.simTime > latestT) latestT = e.simTime;
  const atHour = due
    .filter((e) => e.simTime === latestT)
    .sort(compareReplayTalkOrder);
  return atHour[atHour.length - 1];
}
