/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { createMemoryEntry, MemoryStream } from './memory.js';
import { retrieveMemories } from './retrieval.js';
import { interviewAgent } from './interview.js';
import { whisperMemory } from './copyLocale.js';
import {
  evolveRelation,
  formatCommitmentLines,
  parseRelation,
} from './relations.js';
import {
  ADOPT_REFLECTION_THRESHOLD,
  maybeReflectAfterAdopt,
  paidInterveneTouch,
  stampAdoptedRelation,
  stampRumorRelation,
  VISITOR_AGENT_ID,
} from './paidInfluence.js';

describe('paid 认养 / 巷议 graph', () => {
  it('stamps an adopted edge that parseRelation round-trips', () => {
    const relations = new Map();
    const rel = stampAdoptedRelation(relations, 'npc_a');
    expect(rel.kind).toBe('adopted');
    expect(rel.affinity).toBeGreaterThanOrEqual(0.55);
    expect(rel.summary).toMatch(/^【认养】/);
    const key = [...relations.keys()][0];
    expect(key).toBe(`npc_a|${VISITOR_AGENT_ID}`);
    const parsed = parseRelation(rel.summary, rel.affinity);
    expect(parsed.kind).toBe('adopted');
  });

  it('does not let a later 巷议 overwrite an adopted edge', () => {
    const relations = new Map();
    stampAdoptedRelation(relations, 'npc_a');
    const kept = stampRumorRelation(relations, 'npc_a', '夜市加一场灯会');
    expect(kept.kind).toBe('adopted');
  });

  it('does not reclassify adopted as promise on 答应', () => {
    const adopted = stampAdoptedRelation(new Map(), 'npc_a');
    const next = evolveRelation(adopted, {
      summary: '答应明天见一起合作',
      spreadCount: 1,
    });
    expect(next.kind).toBe('adopted');
    expect(next.summary).toMatch(/^【认养】/);
  });

  it('ranks 【认养】 first when asked about being adopted', () => {
    const adopt = createMemoryEntry({
      id: 'adopt1',
      agentId: 'a',
      kind: 'observation',
      text: '【认养】有人认养了你，要把日子记得更清楚。',
      simTime: 10,
      importance: 13,
    });
    const whisper = createMemoryEntry({
      id: 'wh1',
      agentId: 'a',
      kind: 'observation',
      text: whisperMemory('夜市灯笼巷要提前收摊', false),
      simTime: 10.1,
      importance: 14,
    });
    const wind = createMemoryEntry({
      id: 'day1',
      agentId: 'a',
      kind: 'observation',
      text: '今天风有点大',
      simTime: 10.2,
      importance: 5,
    });
    const top = retrieveMemories(
      [wind, whisper, adopt],
      '你被认养了吗',
      12,
      { limit: 2 },
    );
    expect(top[0]?.id).toBe('adopt1');
  });

  it('interview on 谁认养了你 cites the adopt memory', async () => {
    const stream = new MemoryStream();
    stream.add(
      createMemoryEntry({
        id: 'adopt1',
        agentId: 'a',
        kind: 'observation',
        text: '【认养】有人认养了你，要把日子记得更清楚。',
        simTime: 10,
        importance: 13,
      }),
    );
    stream.add(
      createMemoryEntry({
        id: 'day1',
        agentId: 'a',
        kind: 'observation',
        text: '今天风有点大',
        simTime: 10.2,
        importance: 5,
      }),
    );
    const result = await interviewAgent({
      stream,
      agentId: 'a',
      agentName: '林嫂',
      identity: '摊主',
      occupation: '摊主',
      question: '谁认养了你？',
      nowSimTime: 12,
      llm: async (prompt) => {
        expect(prompt).toMatch(/认养/);
        expect(prompt).toMatch(/adopt1/);
        return '有人认养了我，我得把日子记得更清楚。';
      },
    });
    expect(result.citedMemoryIds).toContain('adopt1');
  });

  it('reflects after one adopt memory without waiting for the 150 threshold', async () => {
    const stream = new MemoryStream();
    stream.add(
      createMemoryEntry({
        id: 'adopt1',
        agentId: 'a',
        kind: 'observation',
        text: '【认养】有人认养了你，要把日子记得更清楚。',
        simTime: 11,
        importance: 13,
      }),
    );
    expect(ADOPT_REFLECTION_THRESHOLD).toBeLessThan(13);
    const reflections = await maybeReflectAfterAdopt({
      stream,
      agentId: 'a',
      agentName: '林嫂',
      nowSimTime: 11,
      idFactory: () => 'refl1',
    });
    expect(reflections.length).toBeGreaterThan(0);
    expect(reflections[0]?.kind).toBe('reflection');
    expect(reflections.some((r) => r.pointers.includes('adopt1'))).toBe(true);
  });

  it('formats an adopted commitment chip', () => {
    const lines = formatCommitmentLines(
      [
        {
          from: 'a',
          to: VISITOR_AGENT_ID,
          kind: 'adopted',
          summary: '【认养】有人认养了你',
        },
      ],
      'a',
      (id) => (id === VISITOR_AGENT_ID ? '访客' : id),
    );
    expect(lines.some((l) => l.includes('认养') && l.includes('访客'))).toBe(
      true,
    );
  });

  it('pairs town 巷议 with the visitor only, not N² residents', () => {
    const touch = paidInterveneTouch({
      town: true,
      targetIds: ['a', 'b', 'c'],
      adopt: false,
    });
    expect(touch.influenceOf).toBe(VISITOR_AGENT_ID);
    expect(touch.influenceTargets).toEqual(['a', 'b', 'c']);
    expect(touch.participants).toEqual([VISITOR_AGENT_ID]);
    expect(touch.paid).toBe(true);
  });
});
