/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import {
  clipNeeds,
  mergeTalkLog,
  objectLooksBroken,
  pinTalkEvents,
  talkLinesFromEvent,
  type SocietyEvt,
} from './societyTownStageModel';

describe('societyTownStageModel', () => {
  it('clips needs into the 0–1 box', () => {
    expect(clipNeeds({ hunger: 2, energy: 0.4, social: -1, curiosity: 0.2 })).toEqual({
      hunger: 1,
      energy: 0.4,
      social: 0,
      curiosity: 0.2,
    });
  });

  it('keeps intervene lines when pinning talk', () => {
    const events: SocietyEvt[] = [
      { id: 'a', simTime: 1, kind: 'dialogue', payload: {} },
      { id: 'b', simTime: 2, kind: 'intervene', payload: {} },
    ];
    expect(pinTalkEvents(events).map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('pins a course canon observation into the town talk stream', () => {
    const events: SocietyEvt[] = [
      { id: 'a', simTime: 1, kind: 'dialogue', payload: {} },
      {
        id: 'course-settle:n',
        simTime: 3,
        kind: 'observation',
        payload: { course: true, text: '杏花镇今夜：出走成了' },
      },
    ];
    expect(pinTalkEvents(events).map((e) => e.id)).toEqual([
      'a',
      'course-settle:n',
    ]);
    expect(
      talkLinesFromEvent(events[1]!, () => '林', {
        nodText: '点了点头',
        townLabel: '镇上',
        locale: 'zh-CN',
        skipText: () => '',
      })[0]?.text,
    ).toBe('杏花镇今夜：出走成了');
  });

  it('merges talk by id and keeps the newest 40', () => {
    const merged = mergeTalkLog(
      [{ id: '1', eventId: '1', turnIndex: 0, simTime: 1, kind: 'dialogue', who: 'A', text: 'old' }],
      [{ id: '1', eventId: '1', turnIndex: 0, simTime: 1, kind: 'dialogue', who: 'A', text: 'new' }],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.text).toBe('new');
  });

  it('keeps an author whisper after newer dialogue fills the window', () => {
    const prev = [
      {
        id: 'whisper',
        eventId: 'whisper',
        turnIndex: 0,
        simTime: 1,
        kind: 'intervene',
        who: '全镇',
        text: '交班日志少了一页',
      },
    ];
    const extra = Array.from({ length: 45 }, (_, i) => ({
      id: `d${i}`,
      eventId: `d${i}`,
      turnIndex: 0,
      simTime: 10 + i,
      kind: 'dialogue',
      who: '织娘',
      text: `第${i}句`,
    }));
    const merged = mergeTalkLog(prev, extra);
    expect(merged.some((line) => line.text === '交班日志少了一页')).toBe(true);
    expect(merged.length).toBeLessThanOrEqual(40);
  });

  it('reads a broken lamp from object state', () => {
    expect(objectLooksBroken('灯灭了')).toBe(true);
    expect(objectLooksBroken('still on')).toBe(false);
  });
});
