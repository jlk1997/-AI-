/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import { createMemoryEntry, MemoryStream } from './memory.js';
import {
  assignTalkTopics,
  rumorAwareness,
  rumorIsSaturated,
  type TalkTopicCircle,
} from './talkTopics.js';

const rumor = '镇上在传：春妮是杀人犯，床温还在';

function circle(
  regionId: string,
  ids: string[],
  extra: Partial<TalkTopicCircle> = {},
): TalkTopicCircle {
  return {
    regionId,
    participantIds: ids,
    rumorText: rumor,
    rumorHasUnknownListener: true,
    ...extra,
  };
}

describe('assignTalkTopics', () => {
  it('offers the rumor to at most one circle per region and keeps that topic', () => {
    const assigned = assignTalkTopics([
      circle('workshop', ['a', 'b'], {
        witness: '铁柱在作坊，正在搬布',
        objectState: '被子还温着，有人刚躺',
      }),
      circle('workshop', ['c', 'd'], {
        witness: '桂花在作坊，正在缝衣',
        objectState: '炉子熄了',
      }),
      circle('workshop', ['e', 'f'], {
        stanceSplit: '信春妮 / 不信',
        activity: '看见 阿禾 在附近，自己正在织布',
      }),
    ]);
    expect(assigned.filter((a) => a.kind === 'rumor')).toHaveLength(1);
    expect(assigned.filter((a) => a.forceRumor)).toHaveLength(1);
    expect(assigned[0]?.kind).toBe('rumor');
    expect(assigned[0]?.topicHint).toBe('春妮是杀人犯，床温还在');
    expect(assigned[1]?.forceRumor).toBe(false);
    expect(assigned[1]?.kind).toMatch(/witness|object/);
    expect(assigned[2]?.forceRumor).toBe(false);
    expect(new Set(assigned.map((a) => a.topicHint)).size).toBe(3);
    expect(assigned.slice(1).every((a) => !/想起传闻/.test(a.topicHint))).toBe(
      true,
    );
  });

  it('lets a second region carry its own rumor circle', () => {
    const assigned = assignTalkTopics([
      circle('workshop', ['a', 'b']),
      circle('square', ['c', 'd'], {
        witness: '老周在广场，正在扫地',
      }),
    ]);
    expect(assigned.filter((a) => a.kind === 'rumor')).toHaveLength(2);
    expect(assigned.every((a) => a.forceRumor === true)).toBe(true);
  });

  it('stops forcing the rumor once the town already knows it', () => {
    const assigned = assignTalkTopics(
      [
        circle('workshop', ['a', 'b'], {
          witness: '石头在作坊，正在喝茶',
        }),
        circle('workshop', ['c', 'd'], {
          objectState: '被子还温着，有人刚躺',
        }),
        circle('workshop', ['e', 'f'], {
          activity: '织布',
        }),
      ],
      { rumorSaturated: true },
    );
    expect(assigned.every((a) => a.forceRumor === false)).toBe(true);
    expect(assigned.every((a) => a.kind !== 'rumor')).toBe(true);
    expect(assigned.some((a) => a.kind === 'witness')).toBe(true);
    expect(assigned.some((a) => a.kind === 'object')).toBe(true);
  });

  it('still puts a fresh rumor on one circle after everyone has heard it', () => {
    const assigned = assignTalkTopics(
      [
        circle('workshop', ['a', 'b'], {
          rumorHasUnknownListener: false,
          rumorFresh: true,
          witness: '石头在作坊，正在喝茶',
        }),
        circle('workshop', ['c', 'd'], {
          rumorHasUnknownListener: false,
          rumorFresh: true,
          activity: '织布',
        }),
      ],
      { rumorSaturated: true },
    );
    expect(assigned[0]?.kind).toBe('rumor');
    expect(assigned[0]?.forceRumor).toBe(true);
    expect(assigned[0]?.topicHint).toBe('春妮是杀人犯，床温还在');
    expect(assigned[1]?.kind).not.toBe('rumor');
  });

  it('keeps a concrete object hint instead of rewriting it as a rumor recall', () => {
    const assigned = assignTalkTopics([
      circle('workshop', ['a', 'b'], {
        rumorHasUnknownListener: false,
        existingHint: '在烤炉边歇了歇',
      }),
    ]);
    expect(assigned[0]?.forceRumor).toBe(false);
    expect(assigned[0]?.topicHint).toBe('在烤炉边歇了歇');
  });
});

describe('rumor saturation', () => {
  it('treats 60% awareness as saturated', () => {
    expect(rumorIsSaturated(3, 5)).toBe(true);
    expect(rumorIsSaturated(2, 5)).toBe(false);
    expect(rumorIsSaturated(0, 0)).toBe(true);
  });

  it('counts who already stored the rumor', () => {
    const stream = new MemoryStream();
    stream.add(
      createMemoryEntry({
        id: '1',
        agentId: 'a',
        kind: 'observation',
        text: rumor,
        simTime: 10,
        importance: 9,
      }),
    );
    stream.add(
      createMemoryEntry({
        id: '2',
        agentId: 'b',
        kind: 'observation',
        text: rumor,
        simTime: 10,
        importance: 9,
      }),
    );
    const aware = rumorAwareness({
      stream,
      agentIds: ['a', 'b', 'c', 'd'],
      rumorText: rumor,
    });
    expect(aware.awareCount).toBe(2);
    expect(aware.saturated).toBe(false);
  });
});
