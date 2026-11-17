/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import {
  CIRCLE_GAP_MS,
  DEFAULT_SPEECH_PACING,
  conversationEndMs,
  liveSpeechCaption,
  nextCircleStartMs,
  openingCirclesAtTip,
  pickCurrentTalkEvent,
  pinNarrativeTalkEvents,
  scheduleConversation,
  shouldArmCircleStage,
  speechHoldMs,
  type SpeechTurnInput,
} from '../scaffold/src/ui/speechSchedule';

const turn = (speakerId: string, text: string): SpeechTurnInput => ({
  speakerId,
  text,
});

describe('speechHoldMs', () => {
  it('gives longer lines more time on screen', () => {
    const short = speechHoldMs('嗯。');
    const long = speechHoldMs('阿禾，炭火我盯着，你放心把摊子交给我，晚上人多也不会烧过头。');
    expect(long).toBeGreaterThan(short);
  });

  it('clamps both extremes', () => {
    expect(speechHoldMs('')).toBe(DEFAULT_SPEECH_PACING.minHoldMs);
    expect(speechHoldMs('字'.repeat(400))).toBe(DEFAULT_SPEECH_PACING.maxHoldMs);
  });
});

describe('scheduleConversation', () => {
  it('plays one turn at a time in the order they were spoken', () => {
    const cues = scheduleConversation(
      [
        turn('a', '玛拉，去竹棚顺便帮我瞅瞅阿禾那桌稳不稳。'),
        turn('b', '成，我这就去。'),
        turn('a', '谢了。'),
      ],
      { startAtMs: 1_000 },
    );
    expect(cues).toHaveLength(3);
    expect(cues[0]!.atMs).toBe(1_000);
    expect(cues[0]!.speakerId).toBe('a');
    expect(cues[1]!.atMs).toBeGreaterThan(cues[0]!.atMs);
    expect(cues[2]!.atMs).toBeGreaterThan(cues[1]!.atMs);
    expect(cues.map((c) => c.turnIndex)).toEqual([0, 1, 2]);
  });

  it('never lets a resident talk over their own previous line', () => {
    const cues = scheduleConversation(
      [turn('a', '第一句话在这里。'), turn('a', '第二句话紧接着。')],
      { startAtMs: 0 },
    );
    expect(cues[1]!.atMs).toBeGreaterThanOrEqual(
      cues[0]!.atMs + cues[0]!.holdMs,
    );
  });

  it('respects a speaker still busy in another conversation', () => {
    const cues = scheduleConversation([turn('a', '这边也说一句。')], {
      startAtMs: 1_000,
      busyUntilMs: new Map([['a', 6_000]]),
    });
    expect(cues[0]!.atMs).toBe(6_000);
  });

  it('compresses a long exchange into the stage budget', () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      turn(i % 2 === 0 ? 'a' : 'b', `这是第 ${i} 句相当长的台词，需要一点阅读时间。`),
    );
    const cues = scheduleConversation(many, { startAtMs: 0 });
    const uncompressed = many.reduce((sum, t) => sum + speechHoldMs(t.text), 0);
    expect(conversationEndMs(cues)).toBeLessThan(uncompressed);
    expect(cues.every((c) => c.holdMs >= 700)).toBe(true);
  });

  it('drops empty turns and caps how many are staged', () => {
    const cues = scheduleConversation(
      [
        turn('a', '  '),
        turn('', '没有说话人'),
        ...Array.from({ length: 12 }, (_, i) => turn(`s${i}`, `第 ${i} 句。`)),
      ],
      { startAtMs: 0 },
    );
    expect(cues).toHaveLength(DEFAULT_SPEECH_PACING.maxTurns);
    expect(cues.every((c) => c.speakerId && c.text.trim())).toBe(true);
  });

  it('returns nothing when there is nothing to say', () => {
    expect(scheduleConversation([], { startAtMs: 0 })).toEqual([]);
  });

  it('opens the next circle after the previous one ends', () => {
    const cues = scheduleConversation(
      [turn('a', '窑火天亮前就灭了'), turn('b', '我看见了')],
      { startAtMs: 1_000 },
    );
    const end = conversationEndMs(cues);
    expect(nextCircleStartMs(end, 0)).toBe(end + CIRCLE_GAP_MS);
    expect(CIRCLE_GAP_MS).toBeGreaterThanOrEqual(500);
    expect(nextCircleStartMs(end, end + 5_000)).toBe(end + 5_000);
  });

  it('scrubs to one circle at a simTime, in talkSeq order', () => {
    const events = [
      {
        id: 'c3',
        simTime: 14,
        kind: 'dialogue',
        payload: { talkSeq: 3, turns: [{ text: 'third' }] },
      },
      {
        id: 'c1',
        simTime: 14,
        kind: 'dialogue',
        payload: { talkSeq: 1, turns: [{ text: 'first' }] },
      },
      {
        id: 'c2',
        simTime: 14,
        kind: 'dialogue',
        payload: { talkSeq: 2, turns: [{ text: 'second' }] },
      },
    ];
    expect(pickCurrentTalkEvent(events, 14)?.id).toBe('c3');
    expect(pickCurrentTalkEvent(events, 14, 'c1')?.id).toBe('c1');
  });

  it('opens the first circle of the tip hour, not the last', () => {
    const events = [
      {
        id: 'old',
        simTime: 8,
        kind: 'dialogue',
        payload: { talkSeq: 1, turns: [{ text: 'yesterday' }] },
      },
      {
        id: 'c3',
        simTime: 14,
        kind: 'dialogue',
        payload: { talkSeq: 4, turns: [{ text: 'third' }] },
      },
      {
        id: 'c1',
        simTime: 14,
        kind: 'dialogue',
        payload: { talkSeq: 2, turns: [{ text: 'first' }] },
      },
      {
        id: 'c2',
        simTime: 14,
        kind: 'dialogue',
        payload: { talkSeq: 3, turns: [{ text: 'second' }] },
      },
    ];
    const opening = openingCirclesAtTip(events);
    expect(opening.map((e) => e.id)).toEqual(['c1', 'c2', 'c3']);
    expect(
      pickCurrentTalkEvent(events, 14, opening[0]!.id)?.id,
    ).toBe('c1');
  });

  it('pins same-hour circles in talkSeq order after a trim', () => {
    const older = Array.from({ length: 8 }, (_, i) => ({
      id: `m${i}`,
      simTime: i,
      kind: 'move' as const,
      payload: {},
    }));
    const talks = [
      {
        id: 'c3',
        simTime: 14,
        kind: 'dialogue' as const,
        payload: { talkSeq: 3 },
      },
      {
        id: 'c1',
        simTime: 14,
        kind: 'dialogue' as const,
        payload: { talkSeq: 1 },
      },
      {
        id: 'c2',
        simTime: 14,
        kind: 'dialogue' as const,
        payload: { talkSeq: 2 },
      },
    ];
    const pinned = pinNarrativeTalkEvents([...talks, ...older], 6);
    expect(
      pinned.filter((e) => e.kind === 'dialogue').map((e) => e.id),
    ).toEqual(['c1', 'c2', 'c3']);
    expect(pinned[pinned.length - 1]!.id).toBe('c3');
  });

  it('arms a circle only when it actually opens', () => {
    expect(shouldArmCircleStage(null, 'c1')).toBe(true);
    expect(shouldArmCircleStage('c1', 'c1')).toBe(false);
    expect(shouldArmCircleStage('c1', 'c2')).toBe(true);
    expect(shouldArmCircleStage('c2', '')).toBe(false);
  });

  it('writes the line being heard, not a colon pile', () => {
    expect(
      liveSpeechCaption({
        circleIndex: 2,
        speakerName: '石头',
        toName: '铁柱',
        text: '窑火天亮前就灭了',
      }),
    ).toBe('第2圈 · 石头 → 铁柱 · 窑火天亮前就灭了');
    expect(
      liveSpeechCaption({
        circleIndex: 1,
        speakerName: 'Mara',
        text: 'I saw the kiln go dark.',
        ascii: true,
      }),
    ).toBe('Circle 1 · Mara · I saw the kiln go dark.');
  });
});
