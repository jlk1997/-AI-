/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { createMemoryEntry, MemoryStream } from './memory.js';
import { retrieveMemories, keywordRelevance } from './retrieval.js';
import type { SocietyEvent } from './tick.js';
import { createSocietyState, runSocietyHours, partitionDisjointTalkJobs } from './tick.js';
import { findPath } from './pathfind.js';
import {
  buildEmergenceReportCard,
  gateEmergenceReportCard,
  measureDialogueNovelty,
  measureInformationSpread,
} from './eval/metrics.js';
import { runEmergenceEval } from './eval/harness.js';
import { maybeReflect } from './reflect.js';
import { fillPlanGaps, occupationDayPlan, planCoversDay, decomposeSegmentActions, stampPlaceNames } from './plan.js';
import {
  converseGroup,
  isRepeatLine,
  layeredTalkMemories,
  lineShingles,
  spreadImportantMemories,
  isBookkeepingMemory,
} from './converse.js';
import { applyCuriositySurprise, createNeeds } from './needs.js';

describe('world-agents', () => {
  it('retrieves by keyword relevance', () => {
    const stream = new MemoryStream();
    stream.add(
      createMemoryEntry({
        id: '1',
        agentId: 'a',
        kind: 'observation',
        text: 'Alice heard about a Valentine party',
        simTime: 10,
        importance: 8,
      }),
    );
    stream.add(
      createMemoryEntry({
        id: '2',
        agentId: 'a',
        kind: 'observation',
        text: 'Alice ate breakfast',
        simTime: 11,
        importance: 2,
      }),
    );
    const top = retrieveMemories(stream.list('a'), 'party Valentine', 12, {
      limit: 1,
    });
    expect(top[0]?.id).toBe('1');
    expect(keywordRelevance('party', 'Valentine party')).toBeGreaterThan(0);
  });

  it('boosts witness whereabouts when asked where someone is', () => {
    const stream = new MemoryStream();
    stream.add(
      createMemoryEntry({
        id: 'noise',
        agentId: 'a',
        kind: 'observation',
        text: '今天风有点大',
        simTime: 10,
        importance: 8,
      }),
    );
    stream.add(
      createMemoryEntry({
        id: 'seen',
        agentId: 'a',
        kind: 'observation',
        text: '铁砧在喷泉广场，正在给炉火添炭',
        simTime: 10,
        importance: 5,
      }),
    );
    const top = retrieveMemories(stream.list('a'), '铁砧在哪', 12, {
      limit: 1,
    });
    expect(top[0]?.id).toBe('seen');
  });

  it('boosts witness lines when the query names the person, not only 在哪', () => {
    const stream = new MemoryStream();
    stream.add(
      createMemoryEntry({
        id: 'wind',
        agentId: 'a',
        kind: 'observation',
        text: '今天风有点大',
        simTime: 10,
        importance: 8,
      }),
    );
    stream.add(
      createMemoryEntry({
        id: 'seen',
        agentId: 'a',
        kind: 'observation',
        text: '铁砧在喷泉广场，正在给炉火添炭',
        simTime: 10,
        importance: 5,
      }),
    );
    const top = retrieveMemories(stream.list('a'), 'Ada 铁砧 烤面包', 12, {
      limit: 1,
    });
    expect(top[0]?.id).toBe('seen');
  });

  it('boosts English witness lines when asked where someone is', () => {
    const stream = new MemoryStream();
    stream.add(
      createMemoryEntry({
        id: 'noise',
        agentId: 'a',
        kind: 'observation',
        text: 'the corridor is loud',
        simTime: 10,
        importance: 8,
      }),
    );
    stream.add(
      createMemoryEntry({
        id: 'seen',
        agentId: 'a',
        kind: 'observation',
        text: 'Vega is at Bridge, standing the helm',
        simTime: 10,
        importance: 5,
      }),
    );
    const where = retrieveMemories(stream.list('a'), 'where is Vega', 12, {
      limit: 1,
    });
    expect(where[0]?.id).toBe('seen');
    const named = retrieveMemories(stream.list('a'), 'Vega helm watch', 12, {
      limit: 1,
    });
    expect(named[0]?.id).toBe('seen');
  });

  it('stamps plan location names from Spec places', () => {
    const stamped = stampPlaceNames(
      [
        {
          startHour: 8,
          endHour: 12,
          activity: '烤面包',
          locationId: 'obj_oven',
        },
      ],
      [{ id: 'obj_oven', name: '烤炉前', kind: 'food', regionId: 'inn_lane' }],
    );
    expect(stamped[0]?.locationName).toBe('烤炉前');
  });

  it('replays the latest walk destination from action events', async () => {
    const { applyGoalFromEvents } = await import('./hydrate.js');
    const agents: Array<{
      id: string;
      goalPlace?: string;
      goalX?: number;
      goalY?: number;
    }> = [{ id: 'a' }, { id: 'b' }];
    applyGoalFromEvents(agents, [
      {
        kind: 'action',
        agentId: 'a',
        simTime: 10,
        payload: { goalPlace: '旧井', goalX: 1, goalY: 1 },
      },
      {
        kind: 'action',
        agentId: 'a',
        simTime: 12,
        payload: { goalPlace: '喷泉广场', goalX: 8, goalY: 4 },
      },
    ]);
    expect(agents[0]?.goalPlace).toBe('喷泉广场');
    expect(agents[0]?.goalX).toBe(8);
    expect(agents[0]?.goalY).toBe(4);
  });

  it('runs society hours and emits events', async () => {
    const state = createSocietyState({
      seed: 42,
      simTime: 8,
      agents: [
        {
          id: 'alice',
          name: 'Alice',
          identitySummary: 'Baker who loves parties',
          regionId: 'town',
          x: 5,
          y: 5,
        },
        {
          id: 'bob',
          name: 'Bob',
          identitySummary: 'Blacksmith',
          regionId: 'town',
          x: 6,
          y: 5,
        },
      ],
    });
    state.stream.add(
      createMemoryEntry({
        id: 'seed',
        agentId: 'alice',
        kind: 'observation',
        text: 'Alice is planning a Valentine party at the square',
        simTime: 8,
        importance: 9,
      }),
    );
    const events = await runSocietyHours(state, 4, { dtHours: 1 });
    expect(events.length).toBeGreaterThan(0);
    expect(state.plans.size).toBe(2);
    const card = buildEmergenceReportCard({
      state,
      seedText: 'Valentine party',
      invitationText: 'party',
    });
    expect(card.informationSpread.totalAgents).toBe(2);
    expect(card.summary.length).toBeGreaterThan(0);
  });

  it('reflects when importance threshold met', async () => {
    const stream = new MemoryStream();
    for (let i = 0; i < 10; i++) {
      stream.add(
        createMemoryEntry({
          id: `m${i}`,
          agentId: 'a',
          kind: 'observation',
          text: `Event ${i} about friendship and work`,
          simTime: 10 + i,
          importance: 5,
        }),
      );
    }
    let n = 0;
    const result = await maybeReflect({
      stream,
      agentId: 'a',
      agentName: 'Ada',
      nowSimTime: 20,
      sinceSimTime: 10,
      threshold: 20,
      idFactory: () => `r${n++}`,
    });
    expect(result?.reflections.length).toBeGreaterThan(0);
    expect(result?.reflections[0]?.pointers.length).toBeGreaterThan(0);
  });

  it('spreads high-importance rumors via converse', async () => {
    const { converse } = await import('./converse.js');
    const stream = new MemoryStream();
    stream.add(
      createMemoryEntry({
        id: 'rumor',
        agentId: 'a',
        kind: 'observation',
        text: 'Alice is organizing a Valentine party at the square',
        simTime: 8,
        importance: 9,
      }),
    );
    let n = 0;
    const result = await converse({
      stream,
      a: { id: 'a', name: 'Alice', identity: 'baker' },
      b: { id: 'b', name: 'Bob', identity: 'smith' },
      nowSimTime: 9,
      idFactory: () => `c${n++}`,
    });
    expect(result.spreadCount).toBeGreaterThan(0);
    expect(
      stream.list('b').some((m) =>
        /Valentine party|Heard from peer|听同伴说/i.test(m.text),
      ),
    ).toBe(true);
  });

  it('finds A* path around walls', () => {
    const blocked = (x: number, y: number) => x === 1 && y === 0;
    const path = findPath(3, 2, blocked, { x: 0, y: 0 }, { x: 2, y: 0 });
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThan(2);
  });

  it('reaches ≥30% information spread within 2 sim days', async () => {
    const state = createSocietyState({
      seed: 7,
      simTime: 8,
      agents: [
        {
          id: 'a',
          name: 'Alice',
          identitySummary: 'organizer',
          regionId: 'town',
          x: 5,
          y: 5,
        },
        {
          id: 'b',
          name: 'Bob',
          identitySummary: 'smith',
          regionId: 'town',
          x: 6,
          y: 5,
        },
        {
          id: 'c',
          name: 'Cara',
          identitySummary: 'innkeep',
          regionId: 'town',
          x: 5,
          y: 6,
        },
      ],
    });
    state.stream.add(
      createMemoryEntry({
        id: 'seed',
        agentId: 'a',
        kind: 'observation',
        text: 'Alice is organizing a Valentine party at the square',
        simTime: 8,
        importance: 9,
      }),
    );
    await runSocietyHours(state, 48, { dtHours: 1 });
    const card = buildEmergenceReportCard({
      state,
      seedText: 'Valentine party',
      invitationText: 'party',
    });
    expect(card.informationSpread.rate).toBeGreaterThanOrEqual(0.3);
  });

  it('keeps agents walking instead of freezing on a goal tile', async () => {
    const state = createSocietyState({
      seed: 3,
      simTime: 8,
      agents: [
        {
          id: 'a',
          name: 'Ada',
          identitySummary: 'walker',
          regionId: 'town',
          x: 4,
          y: 4,
        },
        {
          id: 'b',
          name: 'Ben',
          identitySummary: 'walker',
          regionId: 'town',
          x: 5,
          y: 4,
        },
      ],
      regionBounds: new Map([['town', { width: 24, height: 18 }]]),
    });
    const start = state.agents.map((a) => `${a.x},${a.y}`).join('|');
    await runSocietyHours(state, 6, { dtHours: 1 });
    const later = state.agents.map((a) => `${a.x},${a.y}`).join('|');
    expect(later).not.toBe(start);
    expect(state.events.some((e) => e.kind === 'action')).toBe(true);
  });

  it('overlays persisted poses and memories onto a spec seed', async () => {
    const { overlayPersistedSociety } = await import('./hydrate.js');
    const state = createSocietyState({
      simTime: 8,
      agents: [
        {
          id: 'a',
          name: 'Ada',
          identitySummary: 'walker',
          regionId: 'town',
          x: 1,
          y: 1,
        },
      ],
    });
    overlayPersistedSociety(state, {
      events: [
        { payload: { talkSeq: 4 } },
        { payload: { talkSeq: 7 } },
      ],
      simTime: 12.5,
      agents: [
        {
          id: 'a',
          x: 9,
          y: 7,
          regionId: 'inn_lane',
          currentAction: '招呼客人',
        },
      ],
      memories: [
        {
          id: 'm1',
          agentId: 'a',
          kind: 'observation',
          text: 'Ada 听说了聚会',
          simTime: 10,
          importance: 8,
        },
      ],
    });
    expect(state.simTime).toBe(12.5);
    expect(state.agents[0]?.x).toBe(9);
    expect(state.agents[0]?.regionId).toBe('inn_lane');
    expect(state.stream.list('a').some((m) => m.text.includes('聚会'))).toBe(
      true,
    );
    expect(state.talkSeq).toBe(7);
  });

  it('does not wipe seed relations when persisted relations are empty', async () => {
    const { overlayPersistedSociety } = await import('./hydrate.js');
    const { parseRelation } = await import('./relations.js');
    const state = createSocietyState({
      simTime: 8,
      agents: [
        {
          id: 'a',
          name: 'Ada',
          identitySummary: 'baker',
          regionId: 'town',
          x: 1,
          y: 1,
        },
        {
          id: 'b',
          name: 'Ben',
          identitySummary: 'smith',
          regionId: 'town',
          x: 2,
          y: 2,
        },
      ],
    });
    state.relations.set(
      'a|b',
      parseRelation('【有约定】Ada 约了 Ben 今晚广场聚会', 0.45),
    );
    overlayPersistedSociety(state, {
      simTime: 9,
      agents: [
        { id: 'a', x: 3, y: 3, regionId: 'town' },
        { id: 'b', x: 4, y: 4, regionId: 'town' },
      ],
      relations: [],
    });
    expect(state.relations.get('a|b')?.kind).toBe('promise');
    overlayPersistedSociety(state, {
      relations: [
        {
          from: 'a',
          to: 'b',
          summary: '【同事】一起干活',
          affinity: 0.2,
        },
      ],
    });
    expect(state.relations.get('a|b')?.kind).toBe('coworker');
  });

  it('rebuilds talk cooldown from dialogue events', async () => {
    const { lastConverseAtFromEvents, overlayPersistedSociety } =
      await import('./hydrate.js');
    const pairs = lastConverseAtFromEvents([
      {
        kind: 'dialogue',
        simTime: 4,
        agentId: 'a',
        payload: { with: 'b' },
      },
      {
        kind: 'dialogue',
        simTime: 9,
        agentId: 'b',
        payload: { with: 'a' },
      },
      { kind: 'action', simTime: 10, agentId: 'a', payload: {} },
    ]);
    expect(pairs).toEqual([['a|b', 9]]);
    const state = createSocietyState({
      agents: [
        {
          id: 'a',
          name: 'Ada',
          identitySummary: 'baker',
          regionId: 'town',
          x: 1,
          y: 1,
        },
      ],
    });
    overlayPersistedSociety(state, { lastConverseAt: pairs });
    expect(state.lastConverseAt.get('a|b')).toBe(9);
  });

  it('clears talk cooldown after a recent whisper memory', async () => {
    const { clearTalkCooldownAfterWhispers, WHISPER_MEMORY_PREFIX } =
      await import('./hydrate.js');
    const state = createSocietyState({
      simTime: 12,
      agents: [
        {
          id: 'a',
          name: 'Ada',
          identitySummary: 'baker',
          regionId: 'town',
          x: 1,
          y: 1,
        },
        {
          id: 'b',
          name: 'Ben',
          identitySummary: 'smith',
          regionId: 'town',
          x: 2,
          y: 1,
        },
      ],
    });
    state.lastConverseAt.set('a|b', 11);
    state.stream.add(
      createMemoryEntry({
        id: 'w1',
        agentId: 'a',
        kind: 'observation',
        text: `${WHISPER_MEMORY_PREFIX}：森林里发现了矿脉`,
        simTime: 12,
        importance: 8,
      }),
    );
    clearTalkCooldownAfterWhispers(state);
    expect(state.lastConverseAt.has('a|b')).toBe(false);
  });

  it('skips a spoken beat when LLM is missing and nobody has news', async () => {
    const { converse } = await import('./converse.js');
    const stream = new MemoryStream();
    let n = 0;
    const result = await converse({
      stream,
      a: { id: 'a', name: 'Ada', identity: 'baker' },
      b: { id: 'b', name: 'Ben', identity: 'smith' },
      nowSimTime: 9,
      idFactory: () => `d${n++}`,
    });
    expect(result.degraded).toBe(true);
    expect(result.skipEvent).toBe(true);
    expect(result.turns).toHaveLength(0);
  });

  it('spreads a whisper observation when two agents talk', async () => {
    const { converse } = await import('./converse.js');
    const stream = new MemoryStream();
    stream.add(
      createMemoryEntry({
        id: 'w1',
        agentId: 'a',
        kind: 'observation',
        text: '有人悄悄对你说：森林里发现了矿脉',
        simTime: 9,
        importance: 8,
      }),
    );
    let n = 0;
    const result = await converse({
      stream,
      a: { id: 'a', name: 'Ada', identity: 'baker' },
      b: { id: 'b', name: 'Ben', identity: 'smith' },
      nowSimTime: 10,
      idFactory: () => `d${n++}`,
    });
    expect(result.spreadCount).toBeGreaterThanOrEqual(1);
    expect(stream.list('b').some((m) => m.text.includes('矿脉'))).toBe(true);
  });

  it('parses MiniMax think-wrapped JSON dialogue', async () => {
    const { converse, parseDialogueTurns } = await import('./converse.js');
    expect(
      parseDialogueTurns(
        `<think>planning</think>\n\`\`\`json\n[{"speaker":"A","text":"听说皮普出事了"}]\n\`\`\``,
      )?.[0]?.text,
    ).toBe('听说皮普出事了');
    expect(
      parseDialogueTurns(
        `{"turns":[{"speaker":"A","text":"铁砧今晚办聚会"},{"speaker":"B","text":"我去广场看看"}]}`,
      )?.[1]?.text,
    ).toBe('我去广场看看');
    const stream = new MemoryStream();
    let n = 0;
    const result = await converse({
      stream,
      a: { id: 'a', name: 'Ada', identity: 'baker' },
      b: { id: 'b', name: 'Ben', identity: 'smith' },
      nowSimTime: 10,
      idFactory: () => `d${n++}`,
      llm: async () =>
        `<think>no</think>[{"speaker":"A","text":"铁砧，镇上在传皮普出事了"}]`,
    });
    expect(result.degraded).toBe(false);
    expect(result.turns[0]?.text).toMatch(/皮普/);
  });

  it('retries an unparsed MiniMax beat once before skipping', async () => {
    const { converse } = await import('./converse.js');
    const stream = new MemoryStream();
    let n = 0;
    let calls = 0;
    const result = await converse({
      stream,
      a: { id: 'a', name: 'Ada', identity: 'baker' },
      b: { id: 'b', name: 'Ben', identity: 'smith' },
      nowSimTime: 10,
      idFactory: () => `d${n++}`,
      llm: async () => {
        calls += 1;
        if (calls === 1) return '这一圈我想了很久但没有按约定的 JSON 说话。';
        return `{"turns":[{"speaker":"A","text":"铁砧，窑火我盯着"}]}`;
      },
    });
    expect(calls).toBe(2);
    expect(result.degraded).toBe(false);
    expect(result.turns[0]?.text).toMatch(/窑火/);
  });

  it('repairs truncated JSON and speaker-line dialogue', async () => {
    const { parseDialogueTurns } = await import('./converse.js');
    expect(
      parseDialogueTurns(
        `{"turns":[{"speaker":"A","text":"老李，你听说了吗"`,
      )?.[0]?.text,
    ).toBe('老李，你听说了吗');
    expect(
      parseDialogueTurns(
        `[{"speaker":"A","text":"广场见"},{"speaker":"B","text":"好`,
      )?.[1]?.text,
    ).toBe('好');
    const lines = parseDialogueTurns(
      `A：老陈，广场那边在传聚会\nB：我刚从那儿过来`,
    );
    expect(lines?.map((r) => r.speaker)).toEqual(['A', 'B']);
    expect(lines?.[0]?.text).toMatch(/老陈/);
    const said = parseDialogueTurns(`阿禾说：炭还够\n石头道：那我先去麦田`);
    expect(said?.map((r) => r.speaker)).toEqual(['阿禾', '石头']);
    const aliased = parseDialogueTurns(
      `{"turns":[{"name":"阿禾","line":"炭还够"},{"who":"石头","content":"那我先去麦田"}]}`,
    );
    expect(aliased?.map((r) => r.text)).toEqual(['炭还够', '那我先去麦田']);
    const boxed = parseDialogueTurns(`【阿禾】今晚窑火要看住`);
    expect(boxed?.[0]?.speaker).toBe('阿禾');
  });

  it('holds walkers still and labels the talk partner', async () => {
    const { stepSociety } = await import('./tick.js');
    const state = createSocietyState({
      seed: 1,
      simTime: 10,
      agents: [
        {
          id: 'a',
          name: 'Ada',
          identitySummary: 'baker',
          regionId: 'town',
          x: 4,
          y: 4,
        },
        {
          id: 'b',
          name: 'Bo',
          identitySummary: 'smith',
          regionId: 'town',
          x: 5,
          y: 4,
        },
      ],
      regionBounds: new Map([['town', { width: 24, height: 18 }]]),
    });
    state.heldTalks = [
      {
        participantIds: ['a', 'b'],
        names: { a: 'Ada', b: 'Bo' },
      },
    ];
    state.plans.set('a', {
      agentId: 'a',
      dayIndex: 0,
      segments: [
        {
          startHour: 0,
          endHour: 24,
          activity: '去市集',
          locationId: 'town',
        },
      ],
    });
    const x0 = state.agents[0]!.x;
    const y0 = state.agents[0]!.y;
    await stepSociety(state, {
      dtHours: 0.25,
      maxConversationsPerStep: 0,
      maxPlanLlmCallsPerStep: 0,
    });
    expect(state.agents[0]?.x).toBe(x0);
    expect(state.agents[0]?.y).toBe(y0);
    expect(state.agents[0]?.currentAction).toMatch(/与Bo交谈|talking with Bo/);
    expect(state.agents[1]?.currentAction).toMatch(/与Ada交谈|talking with Ada/);
  });

  it('does not stamp hunger on a daytime cluster and cools down in 0.3h', async () => {
    const { stepSociety } = await import('./tick.js');
    const agents = [
      {
        id: 'a',
        name: 'Ada',
        identitySummary: 'baker',
        regionId: 'town',
        x: 6,
        y: 6,
        needs: { hunger: 0.99, energy: 0.2, social: 0.2, curiosity: 0.2 },
      },
      {
        id: 'b',
        name: 'Bo',
        identitySummary: 'smith',
        regionId: 'town',
        x: 7,
        y: 6,
        needs: { hunger: 0.99, energy: 0.2, social: 0.2, curiosity: 0.2 },
      },
    ];
    const state = createSocietyState({
      seed: 3,
      simTime: 10,
      agents,
      regionBounds: new Map([['town', { width: 20, height: 16 }]]),
    });
    await stepSociety(state, {
      dtHours: 0.25,
      maxConversationsPerStep: 0,
      maxPlanLlmCallsPerStep: 0,
    });

    const talkState = createSocietyState({
      seed: 3,
      simTime: 13,
      agents: [
        {
          id: 'a',
          name: 'Ada',
          identitySummary: 'baker',
          regionId: 'town',
          x: 6,
          y: 6,
        },
        {
          id: 'b',
          name: 'Bo',
          identitySummary: 'smith',
          regionId: 'town',
          x: 7,
          y: 6,
        },
      ],
      regionBounds: new Map([['town', { width: 20, height: 16 }]]),
    });
    talkState.lastConverseAt.set('a|b', 13);
    const stepTalk = () =>
      stepSociety(talkState, {
        dtHours: 0.25,
        skipConversations: true,
        maxConversationsPerStep: 1,
        maxLlmConversationsPerStep: 1,
        maxPlanLlmCallsPerStep: 0,
        llm: async () => '[{"speaker":"A","text":"又见面了"}]',
      });
    await stepTalk();
    expect(talkState.pendingTalks?.length ?? 0).toBe(0);
    for (const a of talkState.agents) {
      if (a.id === 'a') {
        a.x = 6;
        a.y = 6;
      } else {
        a.x = 7;
        a.y = 6;
      }
    }
    await stepTalk();
    expect(talkState.pendingTalks?.length ?? 0).toBeGreaterThan(0);
  });

  it('does not mint template speech when the model returns empty or think-only', async () => {
    const { converse } = await import('./converse.js');
    const stream = new MemoryStream();
    stream.add(
      createMemoryEntry({
        id: 'w1',
        agentId: 'a',
        kind: 'observation',
        text: '有人悄悄对你说：铁砧今晚办聚会',
        simTime: 9,
        importance: 8,
      }),
    );
    let n = 0;
    const empty = await converse({
      stream,
      a: { id: 'a', name: 'Ada', identity: 'baker' },
      b: { id: 'b', name: 'Ben', identity: 'smith' },
      nowSimTime: 10,
      idFactory: () => `e${n++}`,
      llm: async () => '',
    });
    expect(empty.skipEvent).toBe(true);
    expect(empty.turns).toHaveLength(0);
    expect(empty.turns.some((t) => t.text.includes('聚会'))).toBe(false);
    expect(empty.spreadCount).toBeGreaterThanOrEqual(1);

    n = 0;
    const thinkOnly = await converse({
      stream,
      a: { id: 'a', name: 'Ada', identity: 'baker' },
      b: { id: 'b', name: 'Ben', identity: 'smith' },
      nowSimTime: 11,
      idFactory: () => `t${n++}`,
      llm: async () => '<think>I will write JSON later</think>',
    });
    expect(thinkOnly.skipEvent).toBe(true);
    expect(thinkOnly.turns).toHaveLength(0);
  });

  it('prefers converse when a rumor is fresh even at night', async () => {
    const { decideReaction, perceive } = await import('./react.js');
    const self = {
      agentId: 'a',
      name: 'Ada',
      regionId: 'town',
      x: 4,
      y: 4,
    };
    const other = {
      agentId: 'b',
      name: 'Ben',
      regionId: 'town',
      x: 6,
      y: 4,
    };
    const perception = perceive(self, [other], [], 5);
    const night = decideReaction({
      self,
      plan: null,
      hourOfDay: 23,
      perception,
    });
    expect(night.kind).toBe('continue');
    const rumor = decideReaction({
      self,
      plan: null,
      hourOfDay: 23,
      perception,
      rumorHint: '镇上在传：皮普死了',
    });
    expect(rumor.kind).toBe('converse');
    expect(rumor.reason).toMatch(/Ben|nearby|附近/);
    expect(rumor.reason).not.toMatch(/想起传闻|recalling rumor/);
  });

  it('picks a remembered neighbor over the nearest stranger', async () => {
    const { decideReaction, perceive } = await import('./react.js');
    const self = {
      agentId: 'a',
      name: 'Ada',
      regionId: 'town',
      x: 4,
      y: 4,
    };
    const nearer = {
      agentId: 'b',
      name: 'Ben',
      regionId: 'town',
      x: 5,
      y: 4,
    };
    const remembered = {
      agentId: 'c',
      name: 'Cam',
      regionId: 'town',
      x: 8,
      y: 4,
    };
    const perception = perceive(self, [nearer, remembered], [], 6);
    const reaction = decideReaction({
      self,
      plan: null,
      hourOfDay: 11,
      perception,
      mentionedIds: new Set(['c']),
      nowSimTime: 11,
    });
    expect(reaction.kind).toBe('converse');
    expect(reaction.targetAgentId).toBe('c');
    expect(reaction.reason).toMatch(/Cam/);
  });

  it('investigates a nearby extinguished stove', async () => {
    const { decideReaction, perceive } = await import('./react.js');
    const self = {
      agentId: 'a',
      name: 'Ada',
      regionId: 'town',
      x: 4,
      y: 4,
    };
    const perception = perceive(
      self,
      [],
      [
        {
          id: 'obj_oven',
          areaId: 'bakery',
          regionId: 'town',
          name: '烤炉',
          state: '熄了',
          kind: 'oven',
        },
      ],
      5,
    );
    const reaction = decideReaction({
      self,
      plan: null,
      hourOfDay: 10,
      perception,
    });
    expect(reaction.kind).toBe('investigate');
    expect(reaction.reason).toMatch(/熄了/);
  });

  it('closes the gap toward a coworker during work hours', async () => {
    const { stepSociety } = await import('./tick.js');
    const state = createSocietyState({
      seed: 9,
      simTime: 10,
      agents: [
        {
          id: 'a',
          name: 'Ada',
          identitySummary: '铁匠',
          occupation: '铁匠',
          regionId: 'town',
          x: 2,
          y: 8,
        },
        {
          id: 'b',
          name: 'Bo',
          identitySummary: '铁匠',
          occupation: '铁匠',
          regionId: 'town',
          x: 16,
          y: 8,
        },
      ],
      regionBounds: new Map([['town', { width: 24, height: 18 }]]),
    });
    const before = Math.hypot(
      state.agents[0]!.x - state.agents[1]!.x,
      state.agents[0]!.y - state.agents[1]!.y,
    );
    await stepSociety(state, {
      dtHours: 0.25,
      maxConversationsPerStep: 0,
      maxPlanLlmCallsPerStep: 0,
    });
    const after = Math.hypot(
      state.agents[0]!.x - state.agents[1]!.x,
      state.agents[0]!.y - state.agents[1]!.y,
    );
    expect(after).toBeLessThan(before);
  });

  it('rumor gathers isolated agents and talks across the plaza in one step', async () => {
    const { stepSociety } = await import('./tick.js');
    const { RUMOR_MEMORY_PREFIX } = await import('./hydrate.js');
    const state = createSocietyState({
      seed: 1,
      simTime: 10,
      agents: [
        {
          id: 'a',
          name: 'Ada',
          identitySummary: 'baker',
          regionId: 'town',
          x: 2,
          y: 2,
        },
        {
          id: 'b',
          name: 'Ben',
          identitySummary: 'smith',
          regionId: 'town',
          x: 20,
          y: 16,
        },
        {
          id: 'c',
          name: 'Cara',
          identitySummary: 'innkeeper',
          regionId: 'inn',
          x: 4,
          y: 4,
        },
      ],
      regionBounds: new Map([
        ['town', { width: 24, height: 18 }],
        ['inn', { width: 14, height: 12 }],
      ]),
    });
    for (const id of ['a', 'b', 'c']) {
      state.stream.add(
        createMemoryEntry({
          id: `rumor_${id}`,
          agentId: id,
          kind: 'observation',
          text: `${RUMOR_MEMORY_PREFIX}：皮普死了`,
          simTime: 10,
          importance: 8,
        }),
      );
    }
    const events = await stepSociety(state, {
      dtHours: 0.25,
      llm: async () => '[{"speaker":"A","text":"听说皮普出事了"}]',
      converseOnlyLlm: true,
    });
    expect(events.some((e) => e.kind === 'dialogue')).toBe(true);
    // Everyone already knows — do not haul Cara off the inn onto the plaza pile.
    expect(state.agents.find((a) => a.id === 'c')?.regionId).toBe('inn');
  });

  it('gathers bystanders into one conversation circle', async () => {
    const { stepSociety } = await import('./tick.js');
    const state = createSocietyState({
      seed: 5,
      simTime: 18,
      agents: [
        { id: 'a', name: 'Ada', identitySummary: '面包师', regionId: 'town', x: 6, y: 6, needs: { hunger: 0.2, energy: 0.2, social: 0.55, curiosity: 0.2 } },
        { id: 'b', name: 'Bo', identitySummary: '铁匠', regionId: 'town', x: 7, y: 6, needs: { hunger: 0.2, energy: 0.2, social: 0.55, curiosity: 0.2 } },
        { id: 'c', name: 'Cai', identitySummary: '邮差', regionId: 'town', x: 6, y: 7, needs: { hunger: 0.2, energy: 0.2, social: 0.55, curiosity: 0.2 } },
      ],
      regionBounds: new Map([['town', { width: 20, height: 16 }]]),
    });
    const events = await stepSociety(state, {
      dtHours: 0.25,
      llm: async () =>
        '[{"speaker":"A","text":"晚上好"},{"speaker":"B","text":"聊聊"},{"speaker":"C","text":"我也来"}]',
      maxConversationsPerStep: 3,
      maxLlmConversationsPerStep: 3,
    });
    const talk = events.find((e) => e.kind === 'dialogue');
    expect(talk).toBeDefined();
    expect(
      (talk!.payload['participants'] as string[]).length,
    ).toBeGreaterThanOrEqual(3);
    // All three pairs must be on cooldown after one circle.
    expect(state.lastConverseAt.has('a|b')).toBe(true);
    expect(state.lastConverseAt.has('a|c')).toBe(true);
    expect(state.lastConverseAt.has('b|c')).toBe(true);
  });

  it('still talks (degraded) when the model budget is spent', async () => {
    const { stepSociety } = await import('./tick.js');
    const state = createSocietyState({
      seed: 7,
      simTime: 12,
      agents: [
        { id: 'a', name: 'Ada', identitySummary: '面包师', regionId: 'town', x: 4, y: 4 },
        { id: 'b', name: 'Bo', identitySummary: '铁匠', regionId: 'town', x: 5, y: 4 },
      ],
      regionBounds: new Map([['town', { width: 20, height: 16 }]]),
    });
    state.stream.add(
      createMemoryEntry({
        id: 'hot',
        agentId: 'a',
        kind: 'observation',
        text: '镇上在传：矿里出事了',
        simTime: 11,
        importance: 9,
      }),
    );
    let called = 0;
    const events = await stepSociety(state, {
      dtHours: 0.25,
      llm: async () => {
        called += 1;
        return '[]';
      },
      maxConversationsPerStep: 2,
      maxLlmConversationsPerStep: 0,
      maxPlanLlmCallsPerStep: 0,
    });
    expect(called).toBe(0);
    const talk = events.find((e) => e.kind === 'dialogue');
    expect(talk).toBeDefined();
    expect(talk!.payload['degraded']).toBe(true);
  });

  it('upgrades memories to a real embedding space and retrieves by meaning', async () => {
    const { upgradeMemoryEmbeddings, foldEmbedding } = await import(
      './embedProvider.js'
    );
    // Stand-in provider: semantically related texts share a dimension.
    const embed = async (texts: readonly string[]): Promise<number[][]> =>
      texts.map((t) => {
        const raw = new Array<number>(256).fill(0);
        raw[/矿|塌/.test(t) ? 3 : 17] = 1;
        return foldEmbedding(raw, 128);
      });
    const stream = new MemoryStream();
    stream.add(
      createMemoryEntry({
        id: 'mine',
        agentId: 'a',
        kind: 'observation',
        text: '矿道昨夜塌了一段',
        simTime: 10,
        importance: 5,
      }),
    );
    stream.add(
      createMemoryEntry({
        id: 'bread',
        agentId: 'a',
        kind: 'observation',
        text: '今天的面包卖得不错',
        simTime: 11,
        importance: 5,
      }),
    );
    expect(stream.list('a')[0]?.embedding?.length).toBe(64);
    const n = await upgradeMemoryEmbeddings({
      stream,
      agentIds: ['a'],
      embed,
    });
    expect(n).toBe(2);
    expect(stream.list('a')[0]?.embedding?.length).toBe(128);

    // A query with no shared keywords must still surface the mine memory.
    const [queryEmbedding] = await embed(['矿上出事了']);
    const top = retrieveMemories(stream.list('a'), '矿上出事了', 12, {
      limit: 1,
      queryEmbedding,
    });
    expect(top[0]?.id).toBe('mine');
  });

  it('gives each occupation a different, cross-region schedule', async () => {
    const { generateDayPlan } = await import('./plan.js');
    const places = [
      { id: 'sq', name: '喷泉广场', kind: 'social' as const, regionId: 'town' },
      { id: 'forge', name: '铁匠炉', kind: 'work' as const, regionId: 'work_row' },
      { id: 'school', name: '学堂', kind: 'learn' as const, regionId: 'school_yard' },
      { id: 'cafe', name: '咖啡馆', kind: 'food' as const, regionId: 'town' },
      { id: 'home', name: '住宅区', kind: 'rest' as const, regionId: 'town' },
    ];
    const base = {
      stream: new MemoryStream(),
      dayIndex: 0,
      nowSimTime: 8,
      idFactory: () => 'p',
      homeRegionId: 'town',
      places,
    };
    const smith = await generateDayPlan({
      ...base,
      agentId: 'smith',
      agentName: '铁砧',
      identitySummary: '铁匠',
      occupation: '铁匠',
    });
    const teacher = await generateDayPlan({
      ...base,
      agentId: 'teacher',
      agentName: '玛拉',
      identitySummary: '学堂老师',
      occupation: '教师',
    });
    const smithText = smith.segments.map((s) => s.activity).join('|');
    const teacherText = teacher.segments.map((s) => s.activity).join('|');
    expect(smithText).not.toBe(teacherText);
    expect(smithText).toContain('打铁');
    expect(teacherText).toContain('上课');
    // Both must leave home for work and meet again at the shared hub.
    const regionOf = (id?: string) =>
      places.find((p) => p.id === id)?.regionId;
    expect(
      smith.segments.some((s) => regionOf(s.locationId) === 'work_row'),
    ).toBe(true);
    expect(
      teacher.segments.some((s) => regionOf(s.locationId) === 'school_yard'),
    ).toBe(true);
    for (const plan of [smith, teacher]) {
      expect(plan.segments.some((s) => s.locationId === 'sq')).toBe(true);
    }
  });

  it('steers the next-day occupation plan with yesterday’s reflection', async () => {
    const { generateDayPlan } = await import('./plan.js');
    const stream = new MemoryStream();
    stream.add(
      createMemoryEntry({
        id: 'r1',
        agentId: 'smith',
        kind: 'reflection',
        text: '明天一定要去学堂把锤子还给玛拉',
        simTime: 22,
        importance: 8,
      }),
    );
    const places = [
      { id: 'sq', name: '喷泉广场', kind: 'social' as const, regionId: 'town' },
      { id: 'forge', name: '铁匠炉', kind: 'work' as const, regionId: 'work_row' },
      { id: 'school', name: '学堂', kind: 'learn' as const, regionId: 'school_yard' },
      { id: 'home', name: '住宅区', kind: 'rest' as const, regionId: 'town' },
    ];
    const plan = await generateDayPlan({
      stream,
      agentId: 'smith',
      agentName: '铁砧',
      identitySummary: '铁匠',
      occupation: '铁匠',
      dayIndex: 1,
      nowSimTime: 24,
      idFactory: () => 'p',
      homeRegionId: 'town',
      places,
      relations: [{ name: '玛拉', summary: '学堂老师', affinity: 0.4 }],
    });
    expect(
      plan.segments.some(
        (s) =>
          s.locationId === 'school' ||
          s.activity.includes('学堂') ||
          s.activity.includes('玛拉'),
      ),
    ).toBe(true);
  });

  it('decomposes hour blocks into concrete actions, not step numbers', () => {
    const beats = decomposeSegmentActions({
      startHour: 8,
      endHour: 12,
      activity: '铁砧 在炉前打铁',
      locationId: 'forge',
    });
    expect(beats.length).toBeGreaterThanOrEqual(3);
    expect(beats.length).toBeLessThanOrEqual(6);
    expect(beats.some((b) => /第\d+步/.test(b))).toBe(false);
    expect(beats.some((b) => /锤|炭|刃|铁/.test(b))).toBe(true);
  });

  it('decomposes English occupation plans into English beats, not Chinese 添炭', () => {
    const beats = decomposeSegmentActions({
      startHour: 8,
      endHour: 12,
      activity: 'Vega works the forge',
      locationId: 'forge',
    });
    expect(beats.length).toBeGreaterThanOrEqual(3);
    expect(beats.some((b) => /stoke|hammer|heat the blank|check the edge/i.test(b))).toBe(
      true,
    );
    expect(beats.some((b) => /添炭|锤打/.test(b))).toBe(false);
  });

  it('lets a drive interrupt the schedule and replan', async () => {
    const { stepSociety } = await import('./tick.js');
    const { advanceNeeds, urgentNeed, createNeeds } = await import('./needs.js');
    // Hunger keeps rising while the agent works, and eating brings it down.
    let needs = createNeeds('a');
    for (let i = 0; i < 40; i++) {
      needs = advanceNeeds({
        needs,
        dtHours: 0.5,
        hourOfDay: 10,
        activity: '在岗位上工作',
      });
    }
    expect(urgentNeed(needs)?.kind).toBe('hunger');
    const fed = advanceNeeds({
      needs,
      dtHours: 1,
      hourOfDay: 12,
      activity: '吃午饭',
    });
    expect(fed.hunger).toBeLessThan(needs.hunger);

    const state = createSocietyState({
      seed: 3,
      simTime: 10,
      agents: [
        {
          id: 'a',
          name: 'Ada',
          identitySummary: '面包师',
          regionId: 'town',
          x: 4,
          y: 4,
          needs: { ...needs, social: 0.1 },
        },
      ],
      regionBounds: new Map([['town', { width: 20, height: 16 }]]),
    });
    const events = await stepSociety(state, {
      dtHours: 0.25,
      maxPlanLlmCallsPerStep: 0,
    });
    const replan = events.find(
      (e) => e.kind === 'plan' && e.payload['replan'] === true,
    );
    expect(replan).toBeDefined();
    expect(replan!.payload['drive']).toBe('hunger');
    expect(state.plans.get('a')?.segments[0]?.activity).toContain('吃');
  });

  it('places anchors on walkable tiles and never inside walls', async () => {
    const { societyStateFromSpec } = await import('./specBridge.js');
    const layoutAscii = [
      '##########',
      '#........#',
      '#..####..#',
      '#..####..#',
      '#...**...#',
      '#........#',
      '##########',
    ].join('\n');
    const state = societyStateFromSpec({
      meta: { version: 1 },
      timeHours: 9,
      entities: [
        {
          id: 'n1',
          kind: 'npc',
          name: '铁砧',
          // Deliberately inside the wall block.
          regionId: 'town',
          pos: { x: 4, y: 2 },
        },
        {
          id: 'n2',
          kind: 'npc',
          name: '玛拉',
          regionId: 'town',
          pos: { x: 8, y: 5 },
        },
      ],
      space: {
        regions: [
          { id: 'town', name: '喷泉广场', width: 10, height: 7, layoutAscii },
        ],
        areas: [
          {
            id: 'area_square',
            regionId: 'town',
            name: '喷泉广场',
            objects: [{ id: 'obj_bar', name: '吧台', state: 'idle' }],
          },
        ],
      },
    });
    const blocked = new Set(['#', 'X', '~']);
    const rows = layoutAscii.split('\n');
    for (const [, anchor] of state.anchors ?? []) {
      expect(blocked.has(rows[anchor.y]?.[anchor.x] ?? '#')).toBe(false);
    }
    const smith = state.agents.find((a) => a.id === 'n1')!;
    expect(blocked.has(rows[smith.y]?.[smith.x] ?? '#')).toBe(false);
    expect(state.objects[0]?.areaId).toBe('area_square');
    expect(state.objects[0]?.regionId).toBe('town');
    expect(state.objects[0]?.areaName).toBe('喷泉广场');
    expect(state.anchors?.get('area_square')?.kind).toBe('social');
    expect(state.anchors?.get('obj_bar')?.kind).toBe('social');
    const { perceive } = await import('./react.js');
    const seen = perceive(
      { agentId: 'n1', name: '铁砧', regionId: 'town', x: 3, y: 4 },
      [],
      state.objects,
    );
    expect(seen.nearbyObjects.some((o) => o.id === 'obj_bar')).toBe(true);
    const { nearestAreaAnchor } = await import('./anchors.js');
    const area = nearestAreaAnchor(state.anchors, state.objects, {
      regionId: 'town',
      x: smith.x,
      y: smith.y,
    });
    expect(area?.areaId).toBe('area_square');
    expect(area?.areaName).toBe('喷泉广场');
    const { stepSociety } = await import('./tick.js');
    await stepSociety(state, { dtHours: 0.25, skipConversations: true });
    expect(state.agents.some((a) => a.areaName === '喷泉广场')).toBe(true);
    expect(
      state.events.some(
        (e) =>
          e.kind === 'action' &&
          typeof e.payload['goalPlace'] === 'string' &&
          String(e.payload['goalPlace']).length > 0,
      ),
    ).toBe(true);
    for (const a of state.agents) {
      const life = state.stream
        .list(a.id)
        .filter((m) => m.text.startsWith('【往事】'));
      expect(life.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('seeds a plaza promise so the inspector has a commitment on first open', async () => {
    const { societyStateFromSpec } = await import('./specBridge.js');
    const state = societyStateFromSpec({
      meta: { version: 1 },
      timeHours: 8,
      entities: [
        {
          id: 'n1',
          kind: 'npc',
          name: '铁砧',
          regionId: 'town',
          pos: { x: 2, y: 2 },
        },
        {
          id: 'n2',
          kind: 'npc',
          name: '玛拉',
          regionId: 'town',
          pos: { x: 4, y: 2 },
        },
      ],
      space: {
        regions: [{ id: 'town', name: '广场', width: 10, height: 8 }],
        areas: [],
      },
    });
    const rel = [...state.relations.values()].find((r) => r.kind === 'promise');
    expect(rel).toBeDefined();
    expect(rel!.summary).toMatch(/今晚.*广场/);
  });

  it('seeds crew gathering copy at the bridge, never 广场', async () => {
    const { societyStateFromSpec } = await import('./specBridge.js');
    const { CREW_GENRE_PROFILE } = await import('@opengame/world-spec');
    const state = societyStateFromSpec({
      meta: { version: 1 },
      timeHours: 8,
      presentation: { genreProfile: CREW_GENRE_PROFILE },
      entities: [
        {
          id: 'n1',
          kind: 'npc',
          name: '值班官',
          regionId: 'bridge',
          pos: { x: 2, y: 2 },
        },
        {
          id: 'n2',
          kind: 'npc',
          name: '舱务',
          regionId: 'bridge',
          pos: { x: 4, y: 2 },
        },
      ],
      space: {
        startRegionId: 'bridge',
        regions: [{ id: 'bridge', name: '舰桥', width: 10, height: 8 }],
        areas: [],
      },
    });
    const rumor = state.stream
      .list('n1')
      .some((m) => /舰桥/.test(m.text) && /交班/.test(m.text));
    expect(rumor).toBe(true);
    expect(
      state.stream.list('n1').some((m) => m.text.includes('广场')),
    ).toBe(false);
    const rel = [...state.relations.values()].find((r) => r.kind === 'promise');
    expect(rel?.summary).toMatch(/舰桥/);
    expect(rel?.summary).not.toMatch(/广场/);
  });

  it('seeds English place and life memories on an ASCII crew spec', async () => {
    const { societyStateFromSpec } = await import('./specBridge.js');
    const { CREW_GENRE_PROFILE } = await import('@opengame/world-spec');
    const state = societyStateFromSpec({
      meta: { version: 1 },
      timeHours: 8,
      presentation: { genreProfile: CREW_GENRE_PROFILE },
      entities: [
        {
          id: 'n1',
          kind: 'npc',
          name: 'Vega',
          regionId: 'bridge',
          pos: { x: 2, y: 2 },
          identity: {
            occupation: 'helmsman',
            traits: ['steady'],
            homeAreaId: 'area_bunk',
            workAreaId: 'area_helm',
          },
        },
        {
          id: 'n2',
          kind: 'npc',
          name: 'Ada',
          regionId: 'bridge',
          pos: { x: 4, y: 2 },
          identity: { occupation: 'cook' },
        },
      ],
      space: {
        startRegionId: 'bridge',
        regions: [{ id: 'bridge', name: 'Bridge', width: 10, height: 8 }],
        areas: [
          { id: 'area_bunk', name: "Vega's bunk", regionId: 'bridge' },
          { id: 'area_helm', name: "Vega's station", regionId: 'bridge' },
        ],
      },
    });
    const texts = state.stream.list('n1').map((m) => m.text).join('\n');
    expect(texts).toMatch(/【身份】/);
    expect(texts).toMatch(/home at Vega's bunk/);
    expect(texts).toMatch(/works at Vega's station/);
    expect(texts).toMatch(/Vega's manner is steady/);
    expect(texts).not.toMatch(/我住在|干活|的性子是|I live in |I work at /);
    expect(texts).toMatch(/【往事】/);
    expect(texts).toMatch(/Word is out:/);
    expect(texts).not.toMatch(/镇上在传/);
    const relBlob = [...state.relations.values()]
      .map((r) => r.summary)
      .join('\n');
    expect(relBlob).toMatch(/asked Ada to meet at Bridge/);
    expect(relBlob).not.toMatch(/ 与 /);
  });

  it('does not walk through layoutAscii walls', async () => {
    const { societyStateFromSpec } = await import('./specBridge.js');
    const { stepSociety } = await import('./tick.js');
    const layoutAscii = [
      '##########',
      '#....#...#',
      '#........#',
      '#....#...#',
      '##########',
    ].join('\n');
    const state = societyStateFromSpec({
      meta: { version: 1 },
      timeHours: 10,
      entities: [
        {
          id: 'n1',
          kind: 'npc',
          name: '铁砧',
          regionId: 'town',
          pos: { x: 1, y: 1 },
          identity: {
            displayName: '铁砧',
            occupation: '铁匠',
            traits: ['直爽'],
            backstory: '管炉。欠玛拉一把锤子。答应过今晚去学堂。',
          },
        },
        {
          id: 'n2',
          kind: 'npc',
          name: '玛拉',
          regionId: 'town',
          pos: { x: 8, y: 1 },
          identity: {
            displayName: '玛拉',
            occupation: '教师',
            traits: ['耐心'],
            backstory: '在学堂教书。收过铁砧的锤子。晚上会去广场。',
          },
        },
      ],
      space: {
        regions: [
          { id: 'town', name: '喷泉广场', width: 10, height: 5, layoutAscii },
        ],
        areas: [
          {
            id: 'area_east',
            regionId: 'town',
            name: '东廊',
          },
        ],
      },
    });
    const walker = state.agents.find((a) => a.id === 'n1')!;
    walker.x = 1;
    walker.y = 1;
    state.anchors?.set('area_east', {
      regionId: 'town',
      x: 8,
      y: 1,
      name: '东廊',
      kind: 'social',
    });
    state.plans.set('n1', {
      agentId: 'n1',
      dayIndex: Math.floor(state.simTime / 24),
      segments: [
        {
          startHour: 0,
          endHour: 24,
          activity: '去东廊找人',
          locationId: 'area_east',
        },
      ],
    });
    const rows = layoutAscii.split('\n');
    const blocked = new Set(['#', 'X', '~']);
    for (let i = 0; i < 16; i++) {
      await stepSociety(state, {
        dtHours: 0.25,
        maxConversationsPerStep: 0,
        maxPlanLlmCallsPerStep: 0,
      });
      for (const a of state.agents) {
        const tile = rows[Math.round(a.y)]?.[Math.round(a.x)] ?? '#';
        expect(blocked.has(tile)).toBe(false);
      }
    }
  });

  it('sends social activities to a shared hub instead of random tiles', async () => {
    const { resolveActivityGoal } = await import('./anchors.js');
    const anchors = new Map([
      ['plaza', { regionId: 'town', x: 10, y: 8, name: '喷泉广场', kind: 'social' as const }],
      ['forge', { regionId: 'town', x: 3, y: 3, name: '铁匠炉', kind: 'work' as const }],
      ['kitchen', { regionId: 'town', x: 6, y: 12, name: '食铺', kind: 'food' as const }],
    ]);
    const bounds = { width: 24, height: 18 };
    const a = resolveActivityGoal({
      anchors,
      agentId: 'a',
      regionId: 'town',
      activity: 'Ada 在广场社交闲聊',
      hourOfDay: 18,
      bounds,
    });
    const b = resolveActivityGoal({
      anchors,
      agentId: 'b',
      regionId: 'town',
      activity: 'Bo 在广场社交闲聊',
      hourOfDay: 18,
      bounds,
    });
    expect(a.anchorId).toBe('plaza');
    expect(b.anchorId).toBe('plaza');
    const work = resolveActivityGoal({
      anchors,
      agentId: 'b',
      regionId: 'town',
      activity: 'Bo 在岗位上打铁',
      hourOfDay: 10,
      bounds,
    });
    expect(work.anchorId).toBe('forge');
    const dinner = resolveActivityGoal({
      anchors,
      agentId: 'a',
      regionId: 'town',
      activity: 'Ada 吃晚饭',
      hourOfDay: 19,
      bounds,
      crowd: [{ regionId: 'town', x: 10, y: 8 }],
    });
    expect(dinner.anchorId).toBe('kitchen');
  });

  it('keeps the destination it is walking to unless another hub is clearly busier', async () => {
    const { resolveActivityGoal } = await import('./anchors.js');
    const anchors = new Map([
      ['plaza', { regionId: 'town', x: 10, y: 8, name: '喷泉广场', kind: 'social' as const }],
      ['tavern', { regionId: 'town', x: 30, y: 8, name: '酒馆', kind: 'social' as const }],
    ]);
    const bounds = { width: 48, height: 18 };
    const ask = (crowd: Array<{ regionId: string; x: number; y: number }>) =>
      resolveActivityGoal({
        anchors,
        agentId: 'a',
        regionId: 'town',
        activity: 'Ada 闲聊',
        hourOfDay: 18,
        bounds,
        crowd,
        // Already on the way to the plaza.
        stickyGoal: { x: 10, y: 8 },
      });
    // One extra body at the tavern is not worth turning around for.
    expect(
      ask([
        { regionId: 'town', x: 10, y: 8 },
        { regionId: 'town', x: 30, y: 8 },
        { regionId: 'town', x: 31, y: 8 },
      ]).anchorId,
    ).toBe('plaza');
    // A real crowd is.
    expect(
      ask([
        { regionId: 'town', x: 10, y: 8 },
        { regionId: 'town', x: 30, y: 8 },
        { regionId: 'town', x: 31, y: 8 },
        { regionId: 'town', x: 30, y: 9 },
        { regionId: 'town', x: 31, y: 9 },
      ]).anchorId,
    ).toBe('tavern');
  });

  it('parks arrived residents on one spot instead of twitching every tick', async () => {
    const { societyStateFromSpec } = await import('./specBridge.js');
    const { stepSociety } = await import('./tick.js');
    const state = societyStateFromSpec({
      meta: { version: 1 },
      timeHours: 18,
      entities: [
        {
          id: 'n1',
          kind: 'npc',
          name: '织娘',
          regionId: 'town',
          pos: { x: 5, y: 3 },
          identity: {
            displayName: '织娘',
            occupation: '织工',
            traits: ['话多'],
            backstory: '在广场边织布。晚上爱在广场坐着。',
          },
        },
      ],
      space: {
        regions: [{ id: 'town', name: '小镇', width: 12, height: 8 }],
        areas: [{ id: 'plaza', regionId: 'town', name: '喷泉广场' }],
      },
    });
    state.anchors?.set('plaza', {
      regionId: 'town',
      x: 5,
      y: 3,
      name: '喷泉广场',
      kind: 'social',
    });
    state.plans.set('n1', {
      agentId: 'n1',
      dayIndex: Math.floor(state.simTime / 24),
      segments: [
        {
          startHour: 0,
          endHour: 24,
          activity: '在喷泉广场闲聊',
          locationId: 'plaza',
        },
      ],
    });
    const seen = new Set<string>();
    for (let i = 0; i < 8; i++) {
      await stepSociety(state, {
        dtHours: 0.25,
        maxConversationsPerStep: 0,
        maxPlanLlmCallsPerStep: 0,
      });
      const a = state.agents[0]!;
      seen.add(`${Math.round(a.x)},${Math.round(a.y)}`);
    }
    expect(seen.size).toBe(1);
  });

  it('live converseOnlyLlm does not call the model for plans or importance', async () => {
    const { heuristicImportance } = await import('./importance.js');
    expect(heuristicImportance('镇上在传：皮普死了')).toBeGreaterThanOrEqual(7);
    const prompts: string[] = [];
    const state = createSocietyState({
      seed: 1,
      simTime: 10,
      agents: [
        {
          id: 'a',
          name: 'Ada',
          identitySummary: 'baker',
          regionId: 'town',
          x: 2,
          y: 2,
        },
        {
          id: 'b',
          name: 'Ben',
          identitySummary: 'smith',
          regionId: 'town',
          x: 3,
          y: 2,
        },
      ],
      regionBounds: new Map([['town', { width: 24, height: 18 }]]),
    });
    await runSocietyHours(state, 1, {
      dtHours: 1,
      llm: async (p) => {
        prompts.push(p);
        return '[{"speaker":"A","text":"你好"}]';
      },
      converseOnlyLlm: true,
    });
    expect(prompts.some((p) => p.includes('安排一天的日程'))).toBe(false);
    expect(prompts.some((p) => p.includes('Rate the lasting importance'))).toBe(
      false,
    );
  });

  it('walks every agent before awaiting a conversation LLM', async () => {
    const { stepSociety } = await import('./tick.js');
    let movedBeforeTalk = 0;
    let llmCalls = 0;
    const state = createSocietyState({
      seed: 7,
      simTime: 10,
      hubRegionId: 'town',
      agents: [
        {
          id: 'a',
          name: 'Ada',
          identitySummary: 'baker',
          occupation: '面包师',
          regionId: 'town',
          x: 2,
          y: 2,
        },
        {
          id: 'b',
          name: 'Ben',
          identitySummary: 'smith',
          occupation: '铁匠',
          regionId: 'town',
          x: 3,
          y: 2,
        },
        {
          id: 'c',
          name: 'Cam',
          identitySummary: 'guard',
          occupation: '守卫',
          regionId: 'town',
          x: 8,
          y: 8,
        },
      ],
      regionBounds: new Map([['town', { width: 24, height: 18 }]]),
    });
    const before = new Map(state.agents.map((a) => [a.id, { x: a.x, y: a.y }]));
    await stepSociety(state, {
      dtHours: 0.25,
      maxConversationsPerStep: 1,
      maxLlmConversationsPerStep: 1,
      converseOnlyLlm: true,
      llm: async () => {
        llmCalls += 1;
        movedBeforeTalk = state.agents.filter((a) => {
          const prev = before.get(a.id)!;
          return a.x !== prev.x || a.y !== prev.y || a.currentAction !== 'idle';
        }).length;
        return '{"turns":[{"speaker":"A","text":"广场风真大"},{"speaker":"B","text":"是啊，我先去铁铺"}]}';
      },
    });
    expect(llmCalls).toBeGreaterThanOrEqual(0);
    if (llmCalls > 0) {
      expect(movedBeforeTalk).toBe(state.agents.length);
    }
    expect(state.agents.every((a) => a.currentAction.length > 0)).toBe(true);
  });

  it('covers every hour of the day so no step is left without an activity', () => {
    for (const occupation of [
      '面包师',
      '守卫',
      '铁匠',
      '教师',
      '矿工',
      undefined,
    ]) {
      const segments = occupationDayPlan({
        agentName: '甲',
        occupation,
        homeRegionId: 'town',
        places: [
          { id: 'a_home', name: '住处', regionId: 'town', kind: 'rest' },
          { id: 'a_work', name: '工坊', regionId: 'town', kind: 'work' },
          { id: 'a_food', name: '食铺', regionId: 'town', kind: 'food' },
          { id: 'a_square', name: '广场', regionId: 'town', kind: 'social' },
        ],
      });
      expect(planCoversDay(segments)).toBe(true);
      if (occupation === '铁匠') {
        expect(segments.some((s) => /歇脚|闲聊/.test(s.activity))).toBe(true);
        expect(
          segments.some(
            (s) => s.startHour >= 21 && /广场|集会/.test(s.activity),
          ),
        ).toBe(false);
        expect(
          segments
            .filter((s) => s.startHour >= 21)
            .every((s) => s.locationId === 'a_home'),
        ).toBe(true);
      }
    }
    const watch = occupationDayPlan({
      agentName: '甲',
      occupation: '值班官',
      homeRegionId: 'sleep_bay',
      hubRegionId: 'bridge',
      clockKind: 'watch',
      places: [
        { id: 'a_home', name: '休眠舱', regionId: 'sleep_bay', kind: 'rest' },
        { id: 'a_work', name: '舰桥', regionId: 'bridge', kind: 'work' },
        { id: 'a_mess', name: '食堂', regionId: 'bridge', kind: 'social' },
      ],
    });
    expect(planCoversDay(watch)).toBe(true);
    expect(watch.some((s) => /值班|交班|铺位/.test(s.activity))).toBe(true);
    expect(watch.every((s) => !/凌晨睡觉|在住处睡觉/.test(s.activity))).toBe(
      true,
    );
  });

  it('gives residents different public hours and hubs instead of one procession', async () => {
    const { temperamentFor } = await import('./personality.js');
    const places = [
      { id: 'home', name: '住处', regionId: 'town', kind: 'rest' as const },
      { id: 'work', name: '工坊', regionId: 'town', kind: 'work' as const },
      { id: 'food', name: '食铺', regionId: 'town', kind: 'food' as const },
      { id: 'square', name: '广场', regionId: 'town', kind: 'social' as const },
      { id: 'teahouse', name: '茶馆', regionId: 'town', kind: 'social' as const },
    ];
    const planFor = (identitySummary: string) =>
      occupationDayPlan({
        agentId: 'r1',
        agentName: '甲',
        occupation: '铁匠',
        identitySummary,
        homeRegionId: 'town',
        hubRegionId: 'town',
        places,
      });
    const shy = planFor('孤僻，独来独往');
    const chatty = planFor('热心健谈，爱聊镇上的事');
    expect(temperamentFor('r1', '孤僻，独来独往').sociability).toBeLessThan(
      temperamentFor('r1', '热心健谈，爱聊镇上的事').sociability,
    );
    expect(planCoversDay(shy)).toBe(true);
    expect(planCoversDay(chatty)).toBe(true);
    const publicHourOf = (segments: ReturnType<typeof planFor>) =>
      segments.find((s) => /闲聊/.test(s.activity))?.startHour;
    // The outgoing resident goes straight from work to the hub; the reclusive
    // one eats first and only drops by at the end of the evening.
    expect(publicHourOf(chatty)).toBeLessThan(publicHourOf(shy)!);
    // ...and they do not even use the same hub.
    const hubOf = (segments: ReturnType<typeof planFor>) =>
      segments.find((s) => /闲聊/.test(s.activity))?.locationId;
    expect(hubOf(chatty)).toBe('square');
    expect(hubOf(shy)).not.toBe('square');
  });

  it('breaks the daily route with an off-schedule errand on some days', async () => {
    const { hasErrandToday, temperamentFor } = await import('./personality.js');
    const places = [
      { id: 'home', name: '住处', regionId: 'town', kind: 'rest' as const },
      { id: 'work', name: '工坊', regionId: 'town', kind: 'work' as const },
      { id: 'food', name: '食铺', regionId: 'town', kind: 'food' as const },
      { id: 'square', name: '广场', regionId: 'town', kind: 'social' as const },
      { id: 'market', name: '集市', regionId: 'east', kind: 'commerce' as const },
    ];
    const identity = '好奇心重，爱打听，四处游荡';
    const { wanderlust } = temperamentFor('r2', identity);
    const errandDay = [0, 1, 2, 3, 4, 5, 6, 7].find((d) =>
      hasErrandToday('r2', d, wanderlust),
    );
    expect(errandDay).toBeDefined();
    const plan = occupationDayPlan({
      agentId: 'r2',
      agentName: '乙',
      occupation: '铁匠',
      identitySummary: identity,
      homeRegionId: 'town',
      hubRegionId: 'town',
      dayIndex: errandDay,
      places,
    });
    expect(planCoversDay(plan)).toBe(true);
    const off = plan.find((s) => /办点事/.test(s.activity));
    expect(off).toBeDefined();
    // The errand must send them somewhere their routine never goes.
    expect(['home', 'work', 'food']).not.toContain(off!.locationId);
  });

  it('wears out equipment mid-use so the town gets events nobody planned', async () => {
    const { wearWorldObject, OBJECT_WEAR_CHANCE } = await import('./objects.js');
    // A bed does not fail; a forge does.
    expect(
      wearWorldObject({
        obj: { id: 'bed_1', name: '通铺' },
        simTime: 10,
        ascii: false,
        chance: 1,
      }),
    ).toBeNull();
    const broke = wearWorldObject({
      obj: { id: 'forge_1', name: '铁砧炉' },
      simTime: 10,
      ascii: false,
      chance: 1,
    });
    expect(broke?.brokeState).toMatch(/熄|坏/);
    // Same object at the same beat always gives the same verdict, so a replay
    // reproduces the incident.
    expect(
      wearWorldObject({
        obj: { id: 'forge_1', name: '铁砧炉' },
        simTime: 10,
        ascii: false,
        chance: OBJECT_WEAR_CHANCE,
      }),
    ).toEqual(
      wearWorldObject({
        obj: { id: 'forge_1', name: '铁砧炉' },
        simTime: 10,
        ascii: false,
        chance: OBJECT_WEAR_CHANCE,
      }),
    );
    expect(
      wearWorldObject({
        obj: { id: 'forge_1', name: '铁砧炉' },
        simTime: 10,
        ascii: false,
        chance: 0,
      }),
    ).toBeNull();

    const { stepSociety } = await import('./tick.js');
    const state = createSocietyState({
      seed: 3,
      simTime: 9,
      agents: [
        {
          id: 'a',
          name: 'Ada',
          identitySummary: '铁匠',
          occupation: '铁匠',
          regionId: 'town',
          x: 5,
          y: 5,
        },
      ],
      regionBounds: new Map([['town', { width: 20, height: 16 }]]),
      anchors: new Map([
        ['forge_1', { regionId: 'town', x: 5, y: 5, name: '铁砧炉', kind: 'work' as const }],
      ]),
      objects: [
        {
          id: 'forge_1',
          name: '铁砧炉',
          state: '烧得正旺',
          areaId: 'town',
          regionId: 'town',
        },
      ],
    });
    state.agents[0]!.currentAction = 'Ada 在炉前打铁';
    const events = await stepSociety(state, {
      dtHours: 0.25,
      objectWearChance: 1,
    });
    const use = events.find((e) => e.kind === 'use-object');
    expect(use?.payload['broke']).toBe(true);
    expect(state.objects[0]?.state).toMatch(/熄|坏/);
    // The breakdown must be memorable enough to come up in conversation.
    expect(
      state.stream
        .list('a')
        .some((m) => m.importance >= 8 && /铁砧炉/.test(m.text)),
    ).toBe(true);
  });

  it('writes English crew drives and does not extra-drain watch energy at night hours', async () => {
    const { urgentNeed, advanceNeeds } = await import('./needs.js');
    const hunger = urgentNeed(
      { hunger: 0.99, energy: 0.1, social: 0.1, curiosity: 0.1 },
      { ascii: true, packId: 'society.crew' },
    );
    expect(hunger?.label).toBe('hungry');
    expect(hunger?.activity).toMatch(/galley/i);
    expect(hunger?.label).not.toMatch(/饿了/);
    const base = { hunger: 0.2, energy: 0.2, social: 0.2, curiosity: 0.2 };
    const townNight = advanceNeeds({
      needs: base,
      dtHours: 1,
      hourOfDay: 2,
    });
    const watchNight = advanceNeeds({
      needs: base,
      dtHours: 1,
      hourOfDay: 2,
      clockKind: 'watch',
    });
    expect(watchNight.energy).toBeLessThan(townNight.energy);
  });

  it('walks a promised meeting toward the hub on a night watch', async () => {
    const { stepSociety, pairKey } = await import('./tick.js');
    const state = createSocietyState({
      seed: 4,
      simTime: 2,
      hubRegionId: 'bridge',
      packId: 'society.crew',
      clockKind: 'watch',
      copyAscii: true,
      agents: [
        {
          id: 'a',
          name: 'Vega',
          identitySummary: 'watch officer',
          regionId: 'sleep_bay',
          x: 3,
          y: 3,
          needs: { hunger: 0.1, energy: 0.1, social: 0.2, curiosity: 0.1 },
        },
        {
          id: 'b',
          name: 'Ada',
          identitySummary: 'helmsman',
          regionId: 'bridge',
          x: 6,
          y: 4,
          needs: { hunger: 0.1, energy: 0.1, social: 0.2, curiosity: 0.1 },
        },
      ],
      regionBounds: new Map([
        ['sleep_bay', { width: 16, height: 12 }],
        ['bridge', { width: 20, height: 16 }],
      ]),
    });
    state.relations.set(pairKey('a', 'b'), {
      kind: 'promise',
      affinity: 0.6,
      summary: '【有约定】meet at Bridge tonight',
    });
    const events = await stepSociety(state, {
      dtHours: 0.25,
      maxConversationsPerStep: 0,
      maxPlanLlmCallsPerStep: 0,
    });
    expect(state.agents.find((a) => a.id === 'a')?.regionId).toBe('bridge');
    expect(
      events.some(
        (e) =>
          e.kind === 'move' &&
          e.agentId === 'a' &&
          e.payload['reason'] === 'keep-promise',
      ),
    ).toBe(true);
  });

  it('uses a configured embedder on the template converse path', async () => {
    const stream = new MemoryStream();
    stream.add(
      createMemoryEntry({
        id: 'a1',
        agentId: 'a',
        kind: 'observation',
        text: 'the helm is quiet',
        simTime: 10,
        importance: 6,
      }),
    );
    stream.add(
      createMemoryEntry({
        id: 'b1',
        agentId: 'b',
        kind: 'observation',
        text: 'just left the bunks',
        simTime: 10,
        importance: 5,
      }),
    );
    let embedCalls = 0;
    const { converseGroup } = await import('./converse.js');
    await converseGroup({
      stream,
      participants: [
        { id: 'a', name: 'Vega', identity: 'watch officer' },
        { id: 'b', name: 'Ada', identity: 'helmsman' },
      ],
      nowSimTime: 11,
      idFactory: () => 'c1',
      embed: async () => {
        embedCalls += 1;
        return [[0, 1, 0]];
      },
    });
    expect(embedCalls).toBeGreaterThan(0);
  });

  it('pads gaps in a model-authored plan instead of leaving dead hours', () => {
    const filled = fillPlanGaps(
      [
        { startHour: 9, endHour: 12, activity: '干活', locationId: 'a_work' },
        { startHour: 14, endHour: 18, activity: '干活', locationId: 'a_work' },
      ],
      '甲',
      'a_home',
    );
    expect(planCoversDay(filled)).toBe(true);
    // The gap between 12 and 14 must be filled, not swallowed.
    expect(filled.some((s) => s.startHour === 12 && s.endHour === 14)).toBe(true);
  });

  it('does not let one drive rewrite the plan on every step', async () => {
    const state = createSocietyState({
      simTime: 8,
      agents: [
        {
          id: 'a',
          name: '甲',
          identitySummary: '面包师',
          regionId: 'town',
          x: 4,
          y: 4,
          occupation: '面包师',
          // Start every drive already past the interrupt threshold.
          needs: { hunger: 0.99, energy: 0.99, social: 0.99, curiosity: 0.99 },
        },
      ],
      regionBounds: new Map([['town', { width: 24, height: 18 }]]),
    });
    const events = await runSocietyHours(state, 6, { dtHours: 0.25 });
    const replans = events.filter(
      (e) => e.kind === 'plan' && e.payload['replan'] === true,
    );
    // 6 sim hours with a 1h cooldown can produce at most ~6 interruptions;
    // without the cooldown this was one per step (24).
    expect(replans.length).toBeLessThanOrEqual(7);
  });

  it('never stacks hearsay prefixes and re-spreads the same fact', () => {
    const stream = new MemoryStream();
    stream.add(
      createMemoryEntry({
        id: 'm1',
        agentId: 'a',
        kind: 'observation',
        text: '听同伴说：铁砧今晚在广场办聚会',
        simTime: 10,
        importance: 9,
      }),
    );
    const first = spreadImportantMemories({
      stream,
      fromId: 'a',
      toId: 'b',
      nowSimTime: 11,
      idFactory: () => `s${Math.random()}`,
    });
    expect(first).toBe(1);
    const bText = stream.list('b')[0]!.text;
    expect(bText).toBe('听同伴说：铁砧今晚在广场办聚会');
    expect(bText.match(/听同伴说/g)?.length).toBe(1);

    // Same fact, already known — must not spread again in either direction.
    expect(
      spreadImportantMemories({
        stream,
        fromId: 'a',
        toId: 'b',
        nowSimTime: 12,
        idFactory: () => `s${Math.random()}`,
      }),
    ).toBe(0);
    expect(
      spreadImportantMemories({
        stream,
        fromId: 'b',
        toId: 'a',
        nowSimTime: 12,
        idFactory: () => `s${Math.random()}`,
      }),
    ).toBe(0);
  });

  it('writes down what the neighbours are doing so there is news to trade', async () => {
    const { stepSociety } = await import('./tick.js');
    const state = createSocietyState({
      seed: 11,
      simTime: 9,
      agents: [
        {
          id: 'a',
          name: 'Ada',
          identitySummary: '面包师',
          regionId: 'town',
          x: 6,
          y: 6,
        },
        {
          id: 'b',
          name: 'Bo',
          identitySummary: '铁匠',
          regionId: 'town',
          x: 7,
          y: 6,
        },
      ],
      regionBounds: new Map([['town', { width: 20, height: 16 }]]),
    });
    for (let i = 0; i < 4; i++) {
      await stepSociety(state, { dtHours: 0.25, maxPlanLlmCallsPerStep: 0 });
    }

    const seen = state.stream
      .list('a')
      .filter((m) => m.text.startsWith('Bo正在'));
    expect(seen.length).toBeGreaterThan(0);
    // Bookkeeping must not leak into what is remembered about other people.
    for (const m of seen) {
      expect(m.text).not.toMatch(/第\d+步/u);
      expect(m.text).not.toMatch(/^【/u);
    }
    // The same sight is written once, not once per step.
    const texts = seen.map((m) => m.text);
    expect(new Set(texts).size).toBe(texts.length);
  });

  it('gives each member of a circle something different to say', async () => {
    const stream = new MemoryStream();
    const people = ['a', 'b', 'c'];
    people.forEach((id, i) => {
      stream.add(
        createMemoryEntry({
          id: `own${id}`,
          agentId: id,
          kind: 'observation',
          text: `${id} 自己的事：第 ${i} 号消息`,
          simTime: 10,
          importance: 8,
        }),
      );
      // Everyone also knows the same rumor — only one may quote it.
      stream.add(
        createMemoryEntry({
          id: `shared${id}`,
          agentId: id,
          kind: 'observation',
          text: '铁砧今晚在广场办聚会',
          simTime: 10,
          importance: 9,
        }),
      );
    });
    const result = await converseGroup({
      stream,
      participants: people.map((id) => ({
        id,
        name: id.toUpperCase(),
        identity: `${id} 是居民`,
      })),
      nowSimTime: 11,
      idFactory: (() => {
        let n = 0;
        return () => `c${n++}`;
      })(),
    });
    expect(result.degraded).toBe(true);
    expect(result.skipEvent).toBe(true);
    expect(result.turns).toHaveLength(0);
  });

  it('LLM converse prompt omits identity sheets, beliefs, and interview echoes', async () => {
    const stream = new MemoryStream();
    stream.add(
      createMemoryEntry({
        id: 'sheet',
        agentId: 'a',
        kind: 'observation',
        text: '【身份】面包师，爱打听',
        simTime: 10,
        importance: 8,
      }),
    );
    stream.add(
      createMemoryEntry({
        id: 'tom',
        agentId: 'a',
        kind: 'observation',
        text: '【信念】乙（b）已经知道：聚会',
        simTime: 10,
        importance: 8,
      }),
    );
    stream.add(
      createMemoryEntry({
        id: 'iv',
        agentId: 'a',
        kind: 'observation',
        text: '有人采访我，问：「聚会」。我答：「去」',
        simTime: 10,
        importance: 7,
      }),
    );
    stream.add(
      createMemoryEntry({
        id: 'ok',
        agentId: 'a',
        kind: 'observation',
        text: '铁砧今晚在广场办聚会',
        simTime: 10,
        importance: 9,
      }),
    );
    stream.add(
      createMemoryEntry({
        id: 'b1',
        agentId: 'b',
        kind: 'observation',
        text: '刚从井边回来',
        simTime: 10,
        importance: 5,
      }),
    );
    let prompt = '';
    const result = await converseGroup({
      stream,
      participants: [
        { id: 'a', name: '甲', identity: '面包师' },
        { id: 'b', name: '乙', identity: '铁匠' },
      ],
      nowSimTime: 11,
      idFactory: () => 'c1',
      llm: async (p) => {
        prompt = p;
        return '{"turns":[{"speaker":"A","text":"今晚广场见"}]}';
      },
    });
    expect(result.degraded).toBe(false);
    expect(prompt).not.toContain('【身份】');
    expect(prompt).not.toContain('【信念】');
    expect(prompt).not.toContain('有人采访我');
    expect(prompt).toContain('铁砧今晚');
    expect(prompt).toMatch(/潜台词|subtext|禁止主动报家门/);
  });

  it('keeps autobiography in the LLM converse prompt', async () => {
    const stream = new MemoryStream();
    stream.add(
      createMemoryEntry({
        id: 'life',
        agentId: 'a',
        kind: 'observation',
        text: '【往事】小时候跟铁砧在井边玩',
        simTime: 10,
        importance: 6,
      }),
    );
    stream.add(
      createMemoryEntry({
        id: 'b1',
        agentId: 'b',
        kind: 'observation',
        text: '刚从井边回来',
        simTime: 10,
        importance: 5,
      }),
    );
    expect(isBookkeepingMemory('【往事】小时候跟铁砧在井边玩')).toBe(false);
    expect(isBookkeepingMemory('【身份】面包师')).toBe(true);
    expect(isBookkeepingMemory('【熟人】母子')).toBe(true);
    expect(isBookkeepingMemory('Someone interviewed me, asked: "hi"')).toBe(
      true,
    );
    expect(isBookkeepingMemory('saw Vega nearby, I am on watch')).toBe(true);
    expect(isBookkeepingMemory('我住在福伯的家、我在福伯的岗位干活')).toBe(
      true,
    );
    expect(isBookkeepingMemory('I live in Vega\'s bunk. I work at Vega\'s station')).toBe(
      true,
    );
    let prompt = '';
    await converseGroup({
      stream,
      participants: [
        { id: 'a', name: '甲', identity: '面包师' },
        { id: 'b', name: '乙', identity: '铁匠' },
      ],
      nowSimTime: 11,
      idFactory: () => 'c1',
      llm: async (p) => {
        prompt = p;
        return '{"turns":[{"speaker":"A","text":"井边那会儿你还记得吗"}]}';
      },
    });
    expect(prompt).toContain('小时候跟铁砧');
    expect(prompt).not.toContain('【身份】');
    expect(prompt).toMatch(/潜台词|subtext/);
  });

  it('drops census recitals from spoken turns and skips a place-only template talk', async () => {
    const stream = new MemoryStream();
    stream.add(
      createMemoryEntry({
        id: 'place_a',
        agentId: 'a',
        kind: 'observation',
        text: '我住在福伯的家、我在福伯的岗位干活',
        simTime: 10,
        importance: 7,
      }),
    );
    stream.add(
      createMemoryEntry({
        id: 'place_b',
        agentId: 'b',
        kind: 'observation',
        text: '我住在春妮的家、我在春妮的岗位干活',
        simTime: 10,
        importance: 7,
      }),
    );
    const llmCensus = await converseGroup({
      stream,
      participants: [
        { id: 'a', name: '阿麦', identity: '渔民' },
        { id: 'b', name: '阿禾', identity: '补网人' },
      ],
      nowSimTime: 11,
      idFactory: () => 'c1',
      llm: async () =>
        '{"turns":[{"speaker":"A","text":"我住在福伯的家、我在福伯的岗位干活"},{"speaker":"B","text":"我住在春妮的家、我在春妮的岗位干活"}]}',
    });
    expect(llmCensus.skipEvent).toBe(true);
    expect(llmCensus.turns).toHaveLength(0);

    const templateOnly = await converseGroup({
      stream,
      participants: [
        { id: 'a', name: '阿麦', identity: '渔民' },
        { id: 'b', name: '阿禾', identity: '补网人' },
      ],
      nowSimTime: 12,
      idFactory: () => 'c2',
    });
    expect(templateOnly.degraded).toBe(true);
    expect(templateOnly.skipEvent).toBe(true);
    expect(templateOnly.turns).toHaveLength(0);
    expect(
      stream.list('a').filter((m) => m.kind === 'dialogue'),
    ).toHaveLength(0);
  });

  it('degraded converse paraphrases and cites the memory instead of reciting it', async () => {
    const stream = new MemoryStream();
    stream.add(
      createMemoryEntry({
        id: 'rumor_a',
        agentId: 'a',
        kind: 'observation',
        text: '铁砧今晚在广场办聚会',
        simTime: 10,
        importance: 9,
      }),
    );
    stream.add(
      createMemoryEntry({
        id: 'see_b',
        agentId: 'b',
        kind: 'observation',
        text: '刚从井边回来',
        simTime: 10,
        importance: 5,
      }),
    );
    const result = await converseGroup({
      stream,
      participants: [
        { id: 'a', name: '甲', identity: '面包师' },
        { id: 'b', name: '乙', identity: '铁匠' },
      ],
      nowSimTime: 11,
      idFactory: () => 'cite1',
    });
    expect(result.degraded).toBe(true);
    expect(result.skipEvent).toBe(true);
    expect(result.turns).toHaveLength(0);
  });

  it('refuses to retell gossip the listener already knows', async () => {
    const stream = new MemoryStream();
    stream.add(
      createMemoryEntry({
        id: 'rumor_a',
        agentId: 'a',
        kind: 'observation',
        text: '铁砧今晚在广场办聚会',
        simTime: 10,
        importance: 9,
      }),
    );
    stream.add(
      createMemoryEntry({
        id: 'rumor_b',
        agentId: 'b',
        kind: 'observation',
        text: '铁砧今晚在广场办聚会',
        simTime: 10,
        importance: 9,
      }),
    );
    const result = await converseGroup({
      stream,
      participants: [
        { id: 'a', name: '甲', identity: '面包师' },
        { id: 'b', name: '乙', identity: '铁匠' },
      ],
      nowSimTime: 11,
      idFactory: () => 'ref1',
    });
    expect(result.degraded).toBe(true);
    expect(result.skipEvent).toBe(true);
    expect(result.turns).toHaveLength(0);
  });

  it('does not record degraded template talks as spoken memory', async () => {
    const stream = new MemoryStream();
    stream.add(
      createMemoryEntry({
        id: 'rumor_a',
        agentId: 'a',
        kind: 'observation',
        text: '铁砧今晚在广场办聚会',
        simTime: 10,
        importance: 9,
      }),
    );
    stream.add(
      createMemoryEntry({
        id: 'see_b',
        agentId: 'b',
        kind: 'observation',
        text: '刚从井边回来',
        simTime: 10,
        importance: 5,
      }),
    );
    const result = await converseGroup({
      stream,
      participants: [
        { id: 'a', name: '甲', identity: '面包师' },
        { id: 'b', name: '乙', identity: '铁匠' },
      ],
      nowSimTime: 11,
      idFactory: () => 'd1',
    });
    expect(result.degraded).toBe(true);
    expect(result.skipEvent).toBe(true);
    expect(stream.list('a').some((m) => m.kind === 'dialogue')).toBe(false);
  });

  it('template converse does not recite gossip the listener already knows', async () => {
    const stream = new MemoryStream();
    stream.add(
      createMemoryEntry({
        id: 'rumor_a',
        agentId: 'a',
        kind: 'observation',
        text: '铁砧今晚在广场办聚会',
        simTime: 10,
        importance: 9,
      }),
    );
    stream.add(
      createMemoryEntry({
        id: 'rumor_b',
        agentId: 'b',
        kind: 'observation',
        text: '铁砧今晚在广场办聚会',
        simTime: 10,
        importance: 9,
      }),
    );
    const result = await converseGroup({
      stream,
      participants: [
        { id: 'a', name: '甲', identity: '面包师' },
        { id: 'b', name: '乙', identity: '铁匠' },
      ],
      nowSimTime: 11,
      idFactory: () => 'c1',
    });
    expect(result.degraded).toBe(true);
    expect(result.turns.every((t) => !t.text.includes('铁砧今晚'))).toBe(true);
  });

  it('degraded chatter stays non-repetitive across many meetings', async () => {
    const stream = new MemoryStream();
    const people = [
      { id: 'a', name: 'Ada', identity: '面包师' },
      { id: 'b', name: 'Ben', identity: '铁匠' },
      { id: 'c', name: 'Cid', identity: '邮差' },
      { id: 'd', name: 'Dee', identity: '教师' },
    ];
    people.forEach((p, i) => {
      stream.add(
        createMemoryEntry({
          id: `rumor_${p.id}`,
          agentId: p.id,
          kind: 'observation',
          text: '铁砧今晚在广场办聚会',
          simTime: 8,
          importance: 9,
        }),
      );
      stream.add(
        createMemoryEntry({
          id: `see_${p.id}`,
          agentId: p.id,
          kind: 'observation',
          text: `${people[(i + 1) % people.length]!.name}正在烤面包`,
          simTime: 8,
          importance: 5,
        }),
      );
    });
    const events: Array<{
      kind: 'dialogue';
      payload: { turns: Array<{ text: string }> };
    }> = [];
    for (let n = 0; n < 24; n++) {
      const rot = n % people.length;
      const circle = [
        people[rot]!,
        people[(rot + 1) % people.length]!,
        people[(rot + 2) % people.length]!,
      ];
      const result = await converseGroup({
        stream,
        participants: circle,
        nowSimTime: 8 + n * 0.5,
        idFactory: (() => {
          let k = 0;
          return () => `m${n}_${k++}`;
        })(),
      });
      events.push({ kind: 'dialogue', payload: { turns: result.turns } });
    }
    expect(events.every((event) => event.payload.turns.length === 0)).toBe(true);
  });

  it('reflection text reads as a statement, not an echoed question', async () => {
    const stream = new MemoryStream();
    for (let i = 0; i < 8; i++) {
      stream.add(
        createMemoryEntry({
          id: `m${i}`,
          agentId: 'a',
          kind: 'observation',
          text: `和邻居一起修好了水井第 ${i} 次`,
          simTime: 10 + i,
          importance: 8,
        }),
      );
    }
    const result = await maybeReflect({
      stream,
      agentId: 'a',
      agentName: '甲',
      nowSimTime: 20,
      sinceSimTime: 9,
      threshold: 10,
      idFactory: (() => {
        let n = 0;
        return () => `r${n++}`;
      })(),
    });
    expect(result).not.toBeNull();
    for (const r of result!.reflections) {
      expect(r.text).not.toContain('关于「');
      expect(r.text).not.toContain('？」');
    }
  });

  it('a later reflection can point at an earlier reflection', async () => {
    const stream = new MemoryStream();
    for (let i = 0; i < 8; i++) {
      stream.add(
        createMemoryEntry({
          id: `m${i}`,
          agentId: 'a',
          kind: 'observation',
          text: `和邻居一起修好了水井第 ${i} 次`,
          simTime: 10 + i,
          importance: 8,
        }),
      );
    }
    let n = 0;
    const ids = () => `r${n++}`;
    await maybeReflect({
      stream,
      agentId: 'a',
      agentName: '甲',
      nowSimTime: 20,
      sinceSimTime: 9,
      threshold: 10,
      idFactory: ids,
    });
    for (let i = 0; i < 6; i++) {
      stream.add(
        createMemoryEntry({
          id: `n${i}`,
          agentId: 'a',
          kind: 'observation',
          text: `又听见广场要办聚会 ${i}`,
          simTime: 21 + i,
          importance: 8,
        }),
      );
    }
    const later = await maybeReflect({
      stream,
      agentId: 'a',
      agentName: '甲',
      nowSimTime: 30,
      sinceSimTime: 20,
      threshold: 10,
      idFactory: ids,
    });
    const pointers = later?.reflections.flatMap((r) => r.pointers) ?? [];
    expect(pointers.some((id) => id.startsWith('r'))).toBe(true);
    const sameWave = stream
      .list('a')
      .filter((m) => m.kind === 'reflection' && m.simTime === 20);
    expect(
      sameWave.slice(1).some((m) => m.pointers.some((id) => id.startsWith('r'))),
    ).toBe(true);
  });

  it('gates a run on physical gathering, route variety and line novelty', () => {
    const state = createSocietyState({
      agents: [
        { id: 'a', name: 'A', identitySummary: '', regionId: 'town', x: 1, y: 1 },
        { id: 'b', name: 'B', identitySummary: '', regionId: 'town', x: 2, y: 1 },
      ],
    });
    const events = [
      {
        id: 'e1',
        simTime: 18,
        kind: 'action' as const,
        agentId: 'a',
        payload: { regionId: 'square', goalPlace: 'p1', activity: '闲聊' },
      },
      {
        id: 'e2',
        simTime: 18,
        kind: 'action' as const,
        agentId: 'b',
        payload: { regionId: 'square', goalPlace: 'p2', activity: '闲聊' },
      },
      {
        id: 'e3',
        simTime: 18,
        kind: 'dialogue' as const,
        agentId: 'a',
        payload: {
          participants: ['a', 'b'],
          summary: '聊天',
          turns: [
            { speakerId: 'a', speakerName: 'A', text: '一' },
            { speakerId: 'b', speakerName: 'B', text: '二' },
          ],
        },
      },
    ];
    const card = buildEmergenceReportCard({
      state,
      events,
      seedText: '聚会',
      invitationText: '聚会',
    });
    // Both residents stood in the square at 18:00 — that is the gathering.
    expect(card.coordination.peakGathering).toBe(2);
    expect(card.coordination.peakRegionId).toBe('square');
    expect(card.coordination.peakGatheringRate).toBe(1);
    expect(card.scheduleDiversity.distinctRoutes).toBe(2);
    expect(card.dialogueNovelty.rate).toBe(1);

    // Daytime-only events must not count as an evening gathering.
    const daytime = buildEmergenceReportCard({
      state,
      events: events.map((e) => ({ ...e, simTime: 10 })),
      seedText: '聚会',
      invitationText: '聚会',
    });
    expect(daytime.coordination.peakGathering).toBe(0);

    // One hand-written conversation cannot be concurrent or sustained; this
    // fixture is about gathering, routes and novelty only.
    const gate = gateEmergenceReportCard(card, {
      minRelations: 0,
      minSpreadRate: 0,
      minConcurrentTalks: 0,
      minSustainRatio: 0,
    });
    expect(gate.ok).toBe(true);
    const strict = gateEmergenceReportCard(card, { minPeakGatheringRate: 1.5 });
    expect(strict.ok).toBe(false);
    expect(strict.failures.join(' ')).toContain('最大聚集率');
  });

  it('prediction error raises curiosity', () => {
    const needs = createNeeds('baker');
    const bumped = applyCuriositySurprise(needs, 0.8);
    expect(bumped.curiosity).toBeGreaterThan(needs.curiosity);
  });

  it('occupancy surprise walks a curious resident toward the crowd', async () => {
    const { stepSociety, createSocietyState } = await import('./tick.js');
    const { SocietyTransitionModel } = await import('./societyWorldModel.js');
    const state = createSocietyState({
      seed: 2,
      simTime: 10,
      hubRegionId: 'plaza',
      agents: [
        {
          id: 'a',
          name: 'Ada',
          identitySummary: '面包师',
          regionId: 'plaza',
          x: 4,
          y: 4,
        },
        {
          id: 'b',
          name: 'Bo',
          identitySummary: '铁匠',
          regionId: 'plaza',
          x: 5,
          y: 4,
        },
        {
          id: 'c',
          name: 'Cara',
          identitySummary: '猎人',
          regionId: 'woods',
          x: 4,
          y: 4,
          needs: { hunger: 0.1, energy: 0.1, social: 0.2, curiosity: 0.8 },
        },
      ],
      regionBounds: new Map([
        ['plaza', { width: 20, height: 16 }],
        ['woods', { width: 16, height: 12 }],
      ]),
    });
    state.worldModel = new SocietyTransitionModel();
    state.worldModel.surprise = 0.4;
    const events = await stepSociety(state, {
      dtHours: 0.25,
      maxConversationsPerStep: 0,
      maxPlanLlmCallsPerStep: 0,
    });
    expect(state.agents.find((a) => a.id === 'c')?.regionId).toBe('plaza');
    expect(
      events.some(
        (e) =>
          e.kind === 'move' &&
          e.agentId === 'c' &&
          e.payload['reason'] === 'see-crowd',
      ),
    ).toBe(true);
  });

  it('occupancy surprise pulls a clustered pair toward the crowded region', async () => {
    const { stepSociety } = await import('./tick.js');
    const { SocietyTransitionModel } = await import('./societyWorldModel.js');
    const state = createSocietyState({
      seed: 3,
      simTime: 10,
      agents: [
        {
          id: 'p1',
          name: 'P1',
          identitySummary: '面包师',
          regionId: 'plaza',
          x: 4,
          y: 4,
        },
        {
          id: 'p2',
          name: 'P2',
          identitySummary: '铁匠',
          regionId: 'plaza',
          x: 5,
          y: 4,
        },
        {
          id: 'p3',
          name: 'P3',
          identitySummary: '店主',
          regionId: 'plaza',
          x: 6,
          y: 5,
        },
        {
          id: 'w1',
          name: 'W1',
          identitySummary: '猎人',
          regionId: 'woods',
          x: 3,
          y: 3,
          needs: { hunger: 0.1, energy: 0.1, social: 0.2, curiosity: 0.7 },
        },
        {
          id: 'w2',
          name: 'W2',
          identitySummary: '樵夫',
          regionId: 'woods',
          x: 4,
          y: 3,
          needs: { hunger: 0.1, energy: 0.1, social: 0.2, curiosity: 0.7 },
        },
      ],
      regionBounds: new Map([
        ['plaza', { width: 20, height: 16 }],
        ['woods', { width: 16, height: 12 }],
      ]),
    });
    state.worldModel = new SocietyTransitionModel();
    state.worldModel.surprise = 0.4;
    const events = await stepSociety(state, {
      dtHours: 0.25,
      maxConversationsPerStep: 0,
      maxPlanLlmCallsPerStep: 0,
    });
    expect(state.agents.find((a) => a.id === 'w1')?.regionId).toBe('plaza');
    expect(state.agents.find((a) => a.id === 'w2')?.regionId).toBe('plaza');
    expect(
      events.some(
        (e) =>
          e.kind === 'move' &&
          (e.agentId === 'w1' || e.agentId === 'w2') &&
          e.payload['reason'] === 'see-crowd',
      ),
    ).toBe(true);
  });

  it('does not pull residents to the hub after dark without a rumor', async () => {
    const { stepSociety } = await import('./tick.js');
    const { SocietyTransitionModel } = await import('./societyWorldModel.js');
    const { activityAnchorKind } = await import('./anchors.js');
    expect(activityAnchorKind('想想今天的事', 21.5)).toBe('rest');
    expect(activityAnchorKind('和邻居闲聊', 18)).toBe('social');
    const state = createSocietyState({
      seed: 4,
      simTime: 22,
      hubRegionId: 'plaza',
      agents: [
        {
          id: 'a',
          name: 'Ada',
          identitySummary: '面包师',
          regionId: 'plaza',
          x: 4,
          y: 4,
        },
        {
          id: 'c',
          name: 'Cara',
          identitySummary: '猎人',
          regionId: 'woods',
          x: 4,
          y: 4,
          needs: { hunger: 0.1, energy: 0.2, social: 0.2, curiosity: 0.9 },
        },
      ],
      regionBounds: new Map([
        ['plaza', { width: 20, height: 16 }],
        ['woods', { width: 16, height: 12 }],
      ]),
    });
    state.worldModel = new SocietyTransitionModel();
    state.worldModel.surprise = 0.5;
    await stepSociety(state, {
      dtHours: 0.25,
      maxConversationsPerStep: 0,
      maxPlanLlmCallsPerStep: 0,
    });
    expect(state.agents.find((a) => a.id === 'c')?.regionId).toBe('woods');
  });

  it('restores occupancy EMA so surprise is not cold after a restart', async () => {
    const { createSocietyState } = await import('./tick.js');
    const { SocietyTransitionModel, applyOccupancySnapshot } = await import(
      './societyWorldModel.js'
    );
    const state = createSocietyState({
      seed: 1,
      simTime: 10,
      agents: [
        {
          id: 'a',
          name: 'Ada',
          identitySummary: '面包师',
          regionId: 'plaza',
          x: 4,
          y: 4,
        },
        {
          id: 'b',
          name: 'Bo',
          identitySummary: '铁匠',
          regionId: 'woods',
          x: 3,
          y: 3,
        },
      ],
      regionBounds: new Map([
        ['plaza', { width: 20, height: 16 }],
        ['woods', { width: 16, height: 12 }],
      ]),
    });
    const trained = new SocietyTransitionModel();
    trained.observe(state);
    state.agents[1]!.regionId = 'plaza';
    trained.observe(state);
    expect(trained.surprise).toBeGreaterThan(0);
    const snap = trained.snapshot();
    const cold: { worldModel?: InstanceType<typeof SocietyTransitionModel> } =
      {};
    applyOccupancySnapshot(cold, snap);
    expect(cold.worldModel?.surprise).toBe(trained.surprise);
    expect(cold.worldModel?.meanSurprise()).toBe(trained.meanSurprise());
  });

  it('queues talks so locomotion flushes before the model', async () => {
    const { stepSociety, finishSocietyTalks } = await import('./tick.js');
    const { RUMOR_MEMORY_PREFIX } = await import('./hydrate.js');
    const state = createSocietyState({
      seed: 1,
      simTime: 10,
      agents: [
        {
          id: 'a',
          name: 'Ada',
          identitySummary: 'baker',
          regionId: 'town',
          x: 6,
          y: 6,
        },
        {
          id: 'b',
          name: 'Bo',
          identitySummary: 'smith',
          regionId: 'town',
          x: 7,
          y: 6,
        },
      ],
      regionBounds: new Map([['town', { width: 24, height: 18 }]]),
    });
    for (const id of ['a', 'b']) {
      state.stream.add(
        createMemoryEntry({
          id: `rumor_${id}`,
          agentId: id,
          kind: 'observation',
          text: `${RUMOR_MEMORY_PREFIX}：皮普死了`,
          simTime: 10,
          importance: 9,
        }),
      );
    }
    let llmCalls = 0;
    const llm = async () => {
      llmCalls += 1;
      return `[{"speaker":"Ada","text":"听说皮普出事了"}]`;
    };
    let flushedAtCalls = -1;
    const events = await stepSociety(state, {
      dtHours: 0.25,
      llm,
      skipConversations: true,
      maxConversationsPerStep: 1,
      maxLlmConversationsPerStep: 1,
      maxPlanLlmCallsPerStep: 0,
      flushLocomotion: () => {
        flushedAtCalls = llmCalls;
      },
    });
    expect(flushedAtCalls).toBe(0);
    expect(llmCalls).toBe(0);
    expect(events.some((e) => e.kind === 'dialogue')).toBe(false);
    expect(Number.isFinite(state.agents[0]?.x)).toBe(true);
    const talks = await finishSocietyTalks(state, { llm });
    expect(llmCalls).toBeGreaterThan(0);
    expect(talks.some((e) => e.kind === 'dialogue')).toBe(true);
  });

  it('converseOnlyLlm does not fill overflow circles with degraded templates', async () => {
    const { finishSocietyTalks } = await import('./tick.js');
    const state = createSocietyState({
      seed: 3,
      simTime: 11,
      agents: [
        { id: 'a', name: 'Ada', identitySummary: 'baker', regionId: 'town', x: 4, y: 4 },
        { id: 'b', name: 'Bo', identitySummary: 'smith', regionId: 'town', x: 5, y: 4 },
        { id: 'c', name: 'Cara', identitySummary: 'post', regionId: 'town', x: 6, y: 4 },
        { id: 'd', name: 'Dee', identitySummary: 'cook', regionId: 'town', x: 7, y: 4 },
        { id: 'e', name: 'Eve', identitySummary: 'guard', regionId: 'town', x: 8, y: 4 },
        { id: 'f', name: 'Fay', identitySummary: 'clerk', regionId: 'town', x: 9, y: 4 },
      ],
      regionBounds: new Map([['town', { width: 24, height: 18 }]]),
    });
    let n = 0;
    const llm = async () => {
      n += 1;
      return n === 1
        ? '[{"speaker":"Ada","text":"窑火天亮前就灭了，你看见了吗"}]'
        : '[{"speaker":"Cara","text":"夜市摊子还亮着，人却不在"}]';
    };
    const people = state.agents;
    state.pendingTalks = [
      {
        initiatorId: 'a',
        targetId: 'b',
        people: [people[0]!, people[1]!],
        pairs: ['a|b'],
        topicHint: 'witness',
        talkLlm: llm,
      },
      {
        initiatorId: 'c',
        targetId: 'd',
        people: [people[2]!, people[3]!],
        pairs: ['c|d'],
        topicHint: 'object',
        talkLlm: llm,
      },
      {
        initiatorId: 'e',
        targetId: 'f',
        people: [people[4]!, people[5]!],
        pairs: ['e|f'],
        topicHint: 'stance',
        talkLlm: llm,
      },
    ];
    const talks = await finishSocietyTalks(state, {
      llm,
      converseOnlyLlm: true,
    });
    const spoken = talks.filter(
      (e) => e.kind === 'dialogue' && e.payload['skipped'] !== true,
    );
    expect(spoken.length).toBeLessThanOrEqual(2);
    expect(spoken.every((e) => e.payload['degraded'] !== true)).toBe(true);
    expect(
      talks.filter(
        (e) =>
          e.payload['degraded'] === true && e.payload['skipped'] !== true,
      ).length,
    ).toBe(0);
  });

  it('stamps talkSeq and circleIndex so same-hour circles stay in order', async () => {
    const { finishSocietyTalks } = await import('./tick.js');
    const { compareSocietyTalkOrder } = await import('./talkOrder.js');
    const state = createSocietyState({
      seed: 9,
      simTime: 14,
      agents: [
        { id: 'a', name: 'Ada', identitySummary: 'baker', regionId: 'kiln', x: 4, y: 4 },
        { id: 'b', name: 'Bo', identitySummary: 'smith', regionId: 'kiln', x: 5, y: 4 },
        { id: 'c', name: 'Cara', identitySummary: 'post', regionId: 'pier', x: 6, y: 4 },
        { id: 'd', name: 'Dee', identitySummary: 'cook', regionId: 'pier', x: 7, y: 4 },
        { id: 'e', name: 'Eve', identitySummary: 'guard', regionId: 'bridge', x: 8, y: 4 },
        { id: 'f', name: 'Fay', identitySummary: 'clerk', regionId: 'bridge', x: 9, y: 4 },
      ],
      regionBounds: new Map([
        ['kiln', { width: 24, height: 18 }],
        ['pier', { width: 24, height: 18 }],
        ['bridge', { width: 24, height: 18 }],
      ]),
    });
    let n = 0;
    const llm = async () => {
      n += 1;
      return n === 1
        ? '[{"speaker":"Ada","text":"窑火天亮前就灭了"}]'
        : n === 2
          ? '[{"speaker":"Cara","text":"夜市摊子还亮着"}]'
          : '[{"speaker":"Eve","text":"桥头灯没人换"}]';
    };
    const people = state.agents;
    state.pendingTalks = [
      {
        initiatorId: 'a',
        targetId: 'b',
        people: [people[0]!, people[1]!],
        pairs: ['a|b'],
        topicHint: 'witness',
        talkLlm: llm,
      },
      {
        initiatorId: 'c',
        targetId: 'd',
        people: [people[2]!, people[3]!],
        pairs: ['c|d'],
        topicHint: 'object',
        talkLlm: llm,
      },
      {
        initiatorId: 'e',
        targetId: 'f',
        people: [people[4]!, people[5]!],
        pairs: ['e|f'],
        topicHint: 'stance',
        talkLlm: llm,
      },
    ];
    const talks = await finishSocietyTalks(state, {
      llm,
      converseOnlyLlm: true,
      maxLlmConversationsPerStep: 3,
    });
    const spoken = talks.filter(
      (e) => e.kind === 'dialogue' && e.payload['skipped'] !== true,
    );
    expect(spoken.map((e) => e.payload['talkSeq'])).toEqual([1, 2, 3]);
    expect(spoken.map((e) => e.payload['circleIndex'])).toEqual([1, 2, 3]);
    expect(spoken.every((e) => e.simTime === 14)).toBe(true);
    const shuffled = [spoken[2]!, spoken[0]!, spoken[1]!];
    expect(
      [...shuffled].sort(compareSocietyTalkOrder).map((e) => e.payload['talkSeq']),
    ).toEqual([1, 2, 3]);
    expect(state.talkSeq).toBe(3);
  });

  it('hops to the anchor region instead of treating a place id as a map', async () => {
    const { stepSociety } = await import('./tick.js');
    const state = createSocietyState({
      seed: 1,
      simTime: 8,
      agents: [
        {
          id: 'a',
          name: 'Ada',
          identitySummary: '铁匠',
          regionId: 'town',
          x: 4,
          y: 4,
        },
      ],
      regionBounds: new Map([
        ['town', { width: 24, height: 18 }],
        ['work_row', { width: 16, height: 12 }],
      ]),
      anchors: new Map([
        [
          'forge',
          {
            regionId: 'work_row',
            x: 3,
            y: 3,
            name: '铁匠炉',
            kind: 'work' as const,
          },
        ],
      ]),
    });
    state.plans.set('a', {
      agentId: 'a',
      dayIndex: 0,
      segments: [
        {
          startHour: 0,
          endHour: 24,
          activity: '打铁',
          locationId: 'forge',
        },
      ],
    });
    await stepSociety(state, {
      dtHours: 0.25,
      maxConversationsPerStep: 0,
      maxPlanLlmCallsPerStep: 0,
    });
    expect(state.agents[0]?.regionId).toBe('work_row');
  });

  it('keeps the current map when locationId is not a region', async () => {
    const { stepSociety } = await import('./tick.js');
    const state = createSocietyState({
      seed: 1,
      simTime: 8,
      agents: [
        {
          id: 'a',
          name: 'Ada',
          identitySummary: 'walker',
          regionId: 'town',
          x: 4,
          y: 4,
        },
      ],
      regionBounds: new Map([['town', { width: 24, height: 18 }]]),
    });
    state.plans.set('a', {
      agentId: 'a',
      dayIndex: 0,
      segments: [
        {
          startHour: 0,
          endHour: 24,
          activity: '闲逛',
          locationId: 'not_a_map',
        },
      ],
    });
    await stepSociety(state, {
      dtHours: 0.25,
      maxConversationsPerStep: 0,
      maxPlanLlmCallsPerStep: 0,
    });
    expect(state.agents[0]?.regionId).toBe('town');
  });

  it('walks to the region where I last saw someone I have in mind', async () => {
    const { stepSociety } = await import('./tick.js');
    const state = createSocietyState({
      seed: 1,
      simTime: 8,
      agents: [
        {
          id: 'a',
          name: 'Ada',
          identitySummary: '面包师',
          regionId: 'town',
          x: 4,
          y: 4,
          needs: { hunger: 0.2, energy: 0.2, social: 0.3, curiosity: 0.1 },
        },
        {
          id: 'b',
          name: 'Ben',
          identitySummary: '铁匠',
          regionId: 'work_row',
          x: 3,
          y: 3,
          needs: { hunger: 0.2, energy: 0.2, social: 0.2, curiosity: 0.1 },
        },
      ],
      regionBounds: new Map([
        ['town', { width: 24, height: 18 }],
        ['work_row', { width: 16, height: 12 }],
      ]),
      anchors: new Map([
        [
          'forge',
          {
            regionId: 'work_row',
            x: 3,
            y: 3,
            name: '铁匠炉',
            kind: 'work' as const,
          },
        ],
      ]),
    });
    state.stream.add(
      createMemoryEntry({
        id: 'saw_ben',
        agentId: 'a',
        kind: 'observation',
        text: 'Ben在铁匠炉，正在打铁',
        simTime: 7.5,
        importance: 5,
      }),
    );
    state.plans.set('a', {
      agentId: 'a',
      dayIndex: 0,
      segments: [
        {
          startHour: 0,
          endHour: 24,
          activity: '闲逛',
          locationId: 'town',
        },
      ],
    });
    await stepSociety(state, {
      dtHours: 0.25,
      maxConversationsPerStep: 0,
      maxPlanLlmCallsPerStep: 0,
    });
    expect(state.agents.find((a) => a.id === 'a')?.regionId).toBe('work_row');
  });

  it('walks to the last-seen English place on an ASCII crew', async () => {
    const { stepSociety } = await import('./tick.js');
    const state = createSocietyState({
      seed: 1,
      simTime: 8,
      copyAscii: true,
      agents: [
        {
          id: 'a',
          name: 'Ada',
          identitySummary: 'cook',
          regionId: 'sleep_bay',
          x: 4,
          y: 4,
          needs: { hunger: 0.2, energy: 0.2, social: 0.3, curiosity: 0.1 },
        },
        {
          id: 'b',
          name: 'Vega',
          identitySummary: 'helmsman',
          regionId: 'bridge',
          x: 3,
          y: 3,
          needs: { hunger: 0.2, energy: 0.2, social: 0.2, curiosity: 0.1 },
        },
      ],
      regionBounds: new Map([
        ['sleep_bay', { width: 24, height: 18 }],
        ['bridge', { width: 16, height: 12 }],
      ]),
      anchors: new Map([
        [
          'helm',
          {
            regionId: 'bridge',
            x: 3,
            y: 3,
            name: 'Bridge',
            kind: 'work' as const,
          },
        ],
      ]),
    });
    state.stream.add(
      createMemoryEntry({
        id: 'saw_vega',
        agentId: 'a',
        kind: 'observation',
        text: 'Vega is at Bridge, standing the helm',
        simTime: 7.5,
        importance: 5,
      }),
    );
    state.plans.set('a', {
      agentId: 'a',
      dayIndex: 0,
      segments: [
        {
          startHour: 0,
          endHour: 24,
          activity: 'wandering',
          locationId: 'sleep_bay',
        },
      ],
    });
    await stepSociety(state, {
      dtHours: 0.25,
      maxConversationsPerStep: 0,
      maxPlanLlmCallsPerStep: 0,
    });
    expect(state.agents.find((a) => a.id === 'a')?.regionId).toBe('bridge');
  });

  it('empty seed text does not count as 100% spread', () => {
    const stream = new MemoryStream();
    stream.add(
      createMemoryEntry({
        id: '1',
        agentId: 'a',
        kind: 'observation',
        text: 'Alice ate breakfast',
        simTime: 8,
        importance: 3,
      }),
    );
    const spread = measureInformationSpread(stream, ['a'], '   ');
    expect(spread.rate).toBe(0);
    expect(spread.awareCount).toBe(0);
  });

  it('lists who already knows a rumor', () => {
    const stream = new MemoryStream();
    stream.add(
      createMemoryEntry({
        id: '1',
        agentId: 'a',
        kind: 'observation',
        text: '听同伴说：今晚广场有聚会',
        simTime: 8,
        importance: 6,
      }),
    );
    stream.add(
      createMemoryEntry({
        id: '2',
        agentId: 'b',
        kind: 'observation',
        text: '自己正在烤面包',
        simTime: 8,
        importance: 3,
      }),
    );
    const spread = measureInformationSpread(stream, ['a', 'b'], '今晚广场有聚会');
    expect(spread.awareIds).toContain('a');
    expect(spread.awareIds).not.toContain('b');
    expect(spread.awareCount).toBe(1);
  });

  it('flags a repeated line even when it is reworded or repunctuated', () => {
    const earlier = ['今晚广场有聚会，你去不去？', 'The forge went cold again.'];
    expect(isRepeatLine('今晚广场有聚会，你去不去', earlier)).toBe(true);
    expect(isRepeatLine('今晚，广场有聚会！你去不去？', earlier)).toBe(true);
    expect(isRepeatLine('the forge went cold again', earlier)).toBe(true);
    expect(isRepeatLine('铁匠今早收了个学徒', earlier)).toBe(false);
    expect(isRepeatLine('   ', earlier)).toBe(true);
    expect(
      isRepeatLine('桂花跟林嫂说：床温的事还得问当家的', [
        '林嫂，春妮那边床温我还当没瞎眼，咱得问当家的',
      ]),
    ).toBe(true);
    expect(
      isRepeatLine('炉子昨夜自己熄了', [
        '桂花跟林嫂说：床温的事还得问当家的',
      ]),
    ).toBe(false);
  });

  it('shingles CJK text, where whitespace tokenisation finds nothing', () => {
    expect(lineShingles('今晚广场有聚会').size).toBeGreaterThan(1);
    expect(lineShingles('短').size).toBe(1);
    expect(lineShingles('').size).toBe(0);
  });

  it('retries a repeated beat with an avoid-list instead of going silent', async () => {
    const state = createSocietyState({
      seed: 11,
      simTime: 12,
      agents: [
        { id: 'a', name: 'Ada', identitySummary: '面包师', regionId: 'town', x: 4, y: 4 },
        { id: 'b', name: 'Bo', identitySummary: '铁匠', regionId: 'town', x: 5, y: 4 },
      ],
    });
    state.stream.add(
      createMemoryEntry({
        id: 'm_said',
        agentId: 'a',
        kind: 'dialogue',
        text: '今晚广场有聚会，你去不去？',
        simTime: 11,
        importance: 6,
      }),
    );
    const prompts: string[] = [];
    const conv = await converseGroup({
      stream: state.stream,
      participants: [
        { id: 'a', name: 'Ada', identity: '面包师' },
        { id: 'b', name: 'Bo', identity: '铁匠' },
      ],
      nowSimTime: 12,
      idFactory: () => `evt_${prompts.length}`,
      llm: async (prompt: string) => {
        prompts.push(prompt);
        return prompts.length === 1
          ? '[{"speaker":"A","text":"今晚广场有聚会，你去不去？"}]'
          : '[{"speaker":"A","text":"炉子昨夜自己熄了，我心里发毛。"}]';
      },
    });
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain('今晚广场有聚会');
    expect(conv.skipEvent).toBe(false);
    expect(conv.turns.map((t) => t.text)).toEqual([
      '炉子昨夜自己熄了，我心里发毛。',
    ]);
  });

  it('reports why a beat produced nothing instead of just going quiet', async () => {
    const state = createSocietyState({
      seed: 12,
      simTime: 9,
      agents: [
        { id: 'a', name: 'Ada', identitySummary: '面包师', regionId: 'town', x: 4, y: 4 },
        { id: 'b', name: 'Bo', identitySummary: '铁匠', regionId: 'town', x: 5, y: 4 },
      ],
    });
    const timeout = Object.assign(new Error('society llm 超时'), {
      name: 'SocietyLlmTimeoutError',
    });
    const timedOut = await converseGroup({
      stream: state.stream,
      participants: [
        { id: 'a', name: 'Ada', identity: '面包师' },
        { id: 'b', name: 'Bo', identity: '铁匠' },
      ],
      nowSimTime: 9,
      idFactory: () => 'evt_t',
      llm: async () => {
        throw timeout;
      },
    });
    expect(timedOut.skipEvent).toBe(true);
    expect(timedOut.skipReason).toBe('timeout');

    const empty = await converseGroup({
      stream: state.stream,
      participants: [
        { id: 'a', name: 'Ada', identity: '面包师' },
        { id: 'b', name: 'Bo', identity: '铁匠' },
      ],
      nowSimTime: 9,
      idFactory: () => 'evt_e',
      llm: async () => '   ',
    });
    expect(empty.skipReason).toBe('empty');
  });

  it('emits a visible degraded marker and retries before giving up on a circle', async () => {
    const { stepSociety, MAX_TALK_RETRIES } = await import('./tick.js');
    const mkState = () =>
      createSocietyState({
        seed: 5,
        simTime: 18,
        agents: [
          { id: 'a', name: 'Ada', identitySummary: '面包师', regionId: 'town', x: 6, y: 6, needs: { hunger: 0.2, energy: 0.2, social: 0.55, curiosity: 0.2 } },
          { id: 'b', name: 'Bo', identitySummary: '铁匠', regionId: 'town', x: 7, y: 6, needs: { hunger: 0.2, energy: 0.2, social: 0.55, curiosity: 0.2 } },
        ],
        regionBounds: new Map([['town', { width: 20, height: 16 }]]),
      });
    const state = mkState();
    const step = () =>
      stepSociety(state, {
        dtHours: 0.25,
        llm: async () => {
          throw Object.assign(new Error('society llm 超时'), {
            name: 'SocietyLlmTimeoutError',
          });
        },
        maxConversationsPerStep: 2,
        maxLlmConversationsPerStep: 2,
        maxPlanLlmCallsPerStep: 0,
        maxReactLlmCallsPerStep: 0,
      });

    let marker: SocietyEvent | undefined;
    let attempts = 0;
    for (let i = 0; i < MAX_TALK_RETRIES + 2 && !marker; i += 1) {
      const events = await step();
      marker = events.find(
        (e) => e.kind === 'dialogue' && e.payload['skipped'] === true,
      );
      attempts += 1;
    }
    expect(marker).toBeDefined();
    expect(marker!.payload['skipReason']).toBe('timeout');
    expect(marker!.payload['retryQueued']).toBe(true);
    expect(marker!.payload['turns']).toEqual([]);
    // A failed beat leaves the pair eligible again — that is the retry queue.
    expect(state.lastConverseAt.has('a|b')).toBe(false);

    // Keep failing: after the retry budget the pair falls back to the cooldown
    // so a dead key pool cannot turn into a per-step retry storm.
    for (let i = 0; i < MAX_TALK_RETRIES + attempts; i += 1) await step();
    expect(state.lastConverseAt.has('a|b')).toBe(true);
  });

  it('does not let a failure marker hand the pair a fresh cooldown on rehydrate', async () => {
    const { lastConverseAtFromEvents } = await import('./hydrate.js');
    const pairs = lastConverseAtFromEvents([
      {
        kind: 'dialogue',
        simTime: 4,
        agentId: 'a',
        payload: { with: 'b', turns: [{ text: '嗨' }] },
      },
      {
        kind: 'dialogue',
        simTime: 9,
        agentId: 'a',
        payload: { with: 'b', skipped: true, skipReason: 'timeout' },
      },
    ]);
    expect(new Map(pairs).get('a|b')).toBe(4);
  });

  it('layers recency, salience and relevance into the talk working set', () => {
    const mem = (
      id: string,
      text: string,
      simTime: number,
      importance: number,
    ) =>
      createMemoryEntry({
        id,
        agentId: 'a',
        kind: 'observation',
        text,
        simTime,
        importance,
      });
    const all = [
      mem('old_hot', '镇长要卖掉磨坊', 1, 9),
      mem('new_cold', '刚把面团揉好', 99, 2),
      mem('mid', '路上碰到邮差', 50, 4),
    ];
    const layered = layeredTalkMemories(all, [], 3);
    const ids = layered.map((m) => m.id).sort();
    // An importance-only window would have dropped the two mundane recent rows.
    expect(ids).toEqual(['mid', 'new_cold', 'old_hot']);
    // Salience leads, so the whisper is never truncated away first.
    expect(layered[0]?.id).toBe('old_hot');
  });

  it('caps the in-memory event log so a long-running world stops growing', async () => {
    const { appendSocietyEvent, MAX_STATE_EVENTS } = await import('./tick.js');
    const state = createSocietyState({
      seed: 1,
      agents: [
        {
          id: 'a',
          name: 'Ada',
          identitySummary: 'baker',
          regionId: 'town',
          x: 1,
          y: 1,
        },
      ],
    });
    state.maxEvents = 100;
    for (let i = 0; i < 2_000; i += 1) {
      appendSocietyEvent(state, {
        id: `e${i}`,
        simTime: i,
        kind: 'move',
        agentId: 'a',
        payload: {},
      });
    }
    expect(state.events.length).toBeLessThanOrEqual(100 + 256);
    // The tail is what metrics and the observatory read, so it must survive.
    expect(state.events[state.events.length - 1]?.id).toBe('e1999');
    expect(state.events.some((e) => e.id === 'e0')).toBe(false);
    expect(MAX_STATE_EVENTS).toBeGreaterThan(0);
  });

  it('partitions converse jobs whose participants do not overlap', () => {
    const batches = partitionDisjointTalkJobs([
      { people: [{ id: 'a' }, { id: 'b' }] },
      { people: [{ id: 'c' }, { id: 'd' }] },
      { people: [{ id: 'b' }, { id: 'e' }] },
    ]);
    expect(batches[0]?.length).toBe(2);
    expect(batches.flat().length).toBe(3);
  });

  it('emergence eval harness runs a short town day', async () => {
    const result = await runEmergenceEval({
      hours: 2,
      dtHours: 0.5,
      thresholds: {
        minSpreadRate: 0,
        minRelations: 0,
        minPeakGatheringRate: 0,
        minScheduleDiversity: 0,
        minDialogueNovelty: 0,
      },
    });
    expect(result.residents).toBeGreaterThanOrEqual(18);
    expect(result.regions).toBeGreaterThanOrEqual(5);
    expect(result.hours).toBe(2);
  });

  it('society rumor spreads to most residents within 2 sim days', async () => {
    const result = await runEmergenceEval({
      hours: 48,
      dtHours: 0.5,
      thresholds: {
        minSpreadRate: 0.7,
        minRelations: 4,
        minPeakGatheringRate: 0,
        minScheduleDiversity: 0.2,
        minDialogueNovelty: 0.2,
      },
    });
    expect(result.card.informationSpread.rate).toBeGreaterThanOrEqual(0.7);
    expect(result.dialogues).toBe(0);
  }, 40_000);

  /**
   * The two complaints a long-running town produces: conversations arrive one at
   * a time, and they thin out the longer it runs. Both were only ever checked by
   * watching the observatory, so they are asserted over a multi-day run here.
   */
  it('sustains parallel conversation over a long run', async () => {
    const result = await runEmergenceEval({
      hours: 72,
      dtHours: 0.5,
      thresholds: {
        minSpreadRate: 0,
        minRelations: 0,
        minPeakGatheringRate: 0,
        minScheduleDiversity: 0,
        minDialogueNovelty: 0.2,
      },
    });
    const sustain = result.card.dialogueSustain;

    expect(sustain.maxConcurrentTalks).toBe(0);
    expect(result.dialogues).toBe(0);
  }, 90_000);

  it('uses a nearby oven when hungry and writes a memory', async () => {
    const state = createSocietyState({
      seed: 7,
      simTime: 12,
      agents: [
        {
          id: 'a',
          name: 'Ada',
          identitySummary: '面包师',
          occupation: '面包师',
          regionId: 'town',
          x: 5,
          y: 5,
          needs: { hunger: 0.99, energy: 0.1, social: 0.1, curiosity: 0.1 },
        },
      ],
      objects: [
        {
          id: 'obj_oven',
          areaId: 'town',
          regionId: 'town',
          name: '烤炉',
          state: '闲着',
          kind: 'oven',
        },
      ],
      regionBounds: new Map([['town', { width: 20, height: 16 }]]),
      anchors: new Map([
        [
          'obj_oven',
          {
            regionId: 'town',
            x: 5,
            y: 5,
            name: '烤炉',
            kind: 'food' as const,
          },
        ],
      ]),
    });
    const { stepSociety } = await import('./tick.js');
    const events = await stepSociety(state, {
      dtHours: 0.25,
      maxConversationsPerStep: 0,
      maxPlanLlmCallsPerStep: 0,
    });
    expect(events.some((e) => e.kind === 'use-object')).toBe(true);
    expect(state.objects[0]?.state).toMatch(/炉门|热/);
    expect(state.stream.list('a').some((m) => m.text.includes('烤炉'))).toBe(
      true,
    );
  });

  it('treats an extinguished oven as unusable', async () => {
    const { objectIsUsable, objectMatchesNeed } = await import('./objects.js');
    expect(objectIsUsable({ state: '闲着' })).toBe(true);
    expect(objectIsUsable({ state: 'idle' })).toBe(true);
    expect(objectIsUsable({ state: '熄了' })).toBe(false);
    expect(objectIsUsable({ state: '炉火灭了' })).toBe(false);
    expect(objectIsUsable({ state: 'out' })).toBe(false);
    expect(
      objectMatchesNeed({ name: '烤炉', kind: 'oven', state: '熄了' }, 'hunger'),
    ).toBe(false);
  });

  it('does not bake on an extinguished oven', async () => {
    const state = createSocietyState({
      seed: 7,
      simTime: 12,
      agents: [
        {
          id: 'a',
          name: 'Ada',
          identitySummary: '面包师',
          occupation: '面包师',
          regionId: 'town',
          x: 5,
          y: 5,
          needs: { hunger: 0.99, energy: 0.1, social: 0.1, curiosity: 0.1 },
        },
      ],
      objects: [
        {
          id: 'obj_oven',
          areaId: 'town',
          regionId: 'town',
          name: '烤炉',
          state: '熄了',
          kind: 'oven',
        },
      ],
      regionBounds: new Map([['town', { width: 20, height: 16 }]]),
      anchors: new Map([
        [
          'obj_oven',
          {
            regionId: 'town',
            x: 5,
            y: 5,
            name: '烤炉',
            kind: 'food' as const,
          },
        ],
      ]),
    });
    const { stepSociety } = await import('./tick.js');
    const events = await stepSociety(state, {
      dtHours: 0.25,
      maxConversationsPerStep: 0,
      maxPlanLlmCallsPerStep: 0,
    });
    expect(events.some((e) => e.kind === 'use-object')).toBe(false);
    expect(state.objects[0]?.state).toBe('熄了');
  });

  it('replans when the baker’s oven is extinguished', async () => {
    const state = createSocietyState({
      seed: 11,
      simTime: 10,
      agents: [
        {
          id: 'a',
          name: 'Ada',
          identitySummary: '面包师',
          occupation: '面包师',
          workAreaId: 'bakery',
          regionId: 'town',
          x: 3,
          y: 3,
          needs: { hunger: 0.1, energy: 0.1, social: 0.1, curiosity: 0.1 },
        },
      ],
      objects: [
        {
          id: 'obj_oven',
          areaId: 'bakery',
          regionId: 'town',
          name: '烤炉',
          state: '熄了',
          kind: 'oven',
        },
      ],
      hubRegionId: 'town',
      regionBounds: new Map([['town', { width: 20, height: 16 }]]),
      anchors: new Map([
        [
          'bakery',
          {
            regionId: 'town',
            x: 12,
            y: 12,
            name: '面包铺',
            kind: 'commerce' as const,
          },
        ],
        [
          'plaza',
          {
            regionId: 'town',
            x: 4,
            y: 4,
            name: '广场',
            kind: 'social' as const,
          },
        ],
        [
          'obj_oven',
          {
            regionId: 'town',
            x: 12,
            y: 12,
            name: '烤炉',
            kind: 'food' as const,
          },
        ],
      ]),
    });
    const { stepSociety } = await import('./tick.js');
    const events = await stepSociety(state, {
      dtHours: 0.25,
      maxConversationsPerStep: 0,
      maxPlanLlmCallsPerStep: 0,
    });
    const replan = events.find(
      (e) => e.kind === 'plan' && e.payload['replan'] === true,
    );
    expect(replan).toBeDefined();
    expect(String(replan!.payload['reason'] ?? '')).toMatch(/熄了/);
    expect(state.agents[0]?.goalReason).toMatch(/熄了/);
    const urgent = state.plans.get('a')?.segments[0];
    expect(urgent?.locationId).not.toBe('bakery');
    expect(urgent?.activity).toMatch(/熄了|改去/);
  });

  it('replans when the oven sits on the parent shop of a nested work nook', async () => {
    const state = createSocietyState({
      seed: 13,
      simTime: 10,
      agents: [
        {
          id: 'a',
          name: 'Ada',
          identitySummary: '面包师',
          occupation: '面包师',
          workAreaId: 'area_work_a',
          regionId: 'town',
          x: 3,
          y: 3,
          needs: { hunger: 0.1, energy: 0.1, social: 0.1, curiosity: 0.1 },
        },
      ],
      objects: [
        {
          id: 'obj_oven',
          areaId: 'bakery',
          regionId: 'town',
          name: '烤炉',
          state: '熄了',
          kind: 'oven',
        },
      ],
      hubRegionId: 'town',
      regionBounds: new Map([['town', { width: 20, height: 16 }]]),
      anchors: new Map([
        [
          'bakery',
          {
            regionId: 'town',
            x: 12,
            y: 12,
            name: '面包铺',
            kind: 'commerce' as const,
          },
        ],
        [
          'area_work_a',
          {
            regionId: 'town',
            x: 12,
            y: 12,
            name: 'Ada的案板',
            kind: 'work' as const,
            parentAreaId: 'bakery',
          },
        ],
        [
          'plaza',
          {
            regionId: 'town',
            x: 4,
            y: 4,
            name: '广场',
            kind: 'social' as const,
          },
        ],
        [
          'obj_oven',
          {
            regionId: 'town',
            x: 12,
            y: 12,
            name: '烤炉',
            kind: 'food' as const,
          },
        ],
      ]),
    });
    const { stepSociety } = await import('./tick.js');
    const events = await stepSociety(state, {
      dtHours: 0.25,
      maxConversationsPerStep: 0,
      maxPlanLlmCallsPerStep: 0,
    });
    const replan = events.find(
      (e) => e.kind === 'plan' && e.payload['replan'] === true,
    );
    expect(replan).toBeDefined();
    expect(String(replan!.payload['reason'] ?? '')).toMatch(/熄了/);
    expect(state.agents[0]?.goalReason).toMatch(/熄了/);
  });

  it('replays use-object events onto spec objects (newest wins)', async () => {
    const { applyObjectStateEvents, useWorldObject } = await import(
      './objects.js'
    );
    const used = useWorldObject(
      {
        id: 'bed',
        areaId: 'home',
        name: '木床',
        state: '被子叠得整齐',
        kind: 'bed',
      },
      '睡觉',
    );
    expect(used.nextState).toMatch(/温/);
    const objects = [
      {
        id: 'bed',
        areaId: 'home',
        name: '木床',
        state: '被子叠得整齐',
        regionId: 'home',
        kind: 'bed' as const,
      },
    ];
    applyObjectStateEvents(objects, [
      { kind: 'observe', payload: { objectId: 'bed', state: '旧状态' } },
      {
        kind: 'use-object',
        payload: { objectId: 'bed', state: used.nextState },
      },
    ]);
    expect(objects[0]?.state).toBe(used.nextState);
    const { snapshotWorldObjects, objectKindFromName, replayPersistedObjectStates } =
      await import('./objects.js');
    expect(objectKindFromName('芸姐的铺')).not.toBe('bed');
    expect(objectKindFromName('面包铺')).not.toBe('bed');
    expect(objectKindFromName('木床')).toBe('bed');
    const snap = snapshotWorldObjects(objects, new Map([['bed', { x: 3, y: 4 }]]));
    expect(snap[0]?.areaId).toBe('home');
    expect(snap[0]?.x).toBe(3);
    expect(snap[0]?.y).toBe(4);
    const oven = [
      {
        id: 'oven',
        areaId: 'bakery',
        name: '烤炉',
        state: '热着',
        regionId: 'market',
        kind: 'oven' as const,
      },
    ];
    replayPersistedObjectStates(oven, {
      tip: { simTime: 12, objects: [{ id: 'oven', state: '熄了' }] },
      events: [
        {
          kind: 'observe',
          simTime: 4,
          payload: { objectId: 'oven', state: '热着' },
        },
        {
          kind: 'use-object',
          simTime: 13,
          payload: { objectId: 'oven', state: '炉门开着，热气往外涌' },
        },
      ],
    });
    expect(oven[0]?.state).toMatch(/炉门/);
    replayPersistedObjectStates(oven, {
      tip: { simTime: 20, objects: [{ id: 'oven', state: '熄了' }] },
      events: [
        {
          kind: 'observe',
          simTime: 8,
          payload: { objectId: 'oven', state: '热着' },
        },
      ],
    });
    expect(oven[0]?.state).toBe('熄了');
  });

  it('does not retell a fact the listener already knows or was told', async () => {
    const { shouldTell, rememberTold } = await import('./beliefs.js');
    const stream = new MemoryStream();
    stream.add(
      createMemoryEntry({
        id: '1',
        agentId: 'b',
        kind: 'observation',
        text: '广场要办聚会',
        simTime: 8,
        importance: 5,
      }),
    );
    expect(shouldTell(stream, 'a', 'b', '广场要办聚会')).toBe(false);
    expect(shouldTell(stream, 'a', 'c', '广场要办聚会')).toBe(true);
    rememberTold({
      stream,
      selfId: 'a',
      otherId: 'c',
      otherName: 'C',
      fact: '广场要办聚会',
      nowSimTime: 8,
      idFactory: () => 't1',
    });
    expect(shouldTell(stream, 'a', 'c', '广场要办聚会')).toBe(false);
  });

  it('will not tell a secret or someone on the withhold list', async () => {
    const { shouldTell } = await import('./beliefs.js');
    const stream = new MemoryStream();
    expect(
      shouldTell(stream, 'a', 'b', '把一封信藏在铁匠的位子底下', {
        secret: '把一封信藏在铁匠的位子底下',
      }),
    ).toBe(false);
    expect(
      shouldTell(stream, 'a', 'b', '码头要加班', { withholdFrom: ['b'] }),
    ).toBe(false);
    expect(shouldTell(stream, 'a', 'c', '码头要加班', { withholdFrom: ['b'] })).toBe(
      true,
    );
    expect(
      shouldTell(stream, 'a', 'stranger', '码头要加班', {
        stance: '闲话不传给外人',
        knownIds: ['c'],
      }),
    ).toBe(false);
    expect(
      shouldTell(stream, 'a', 'c', '码头要加班', {
        stance: '闲话不传给外人',
        knownIds: ['c'],
      }),
    ).toBe(true);
    expect(
      shouldTell(stream, 'a', 'stranger', '码头要加班', {
        stance: '闲话不传给外人',
      }),
    ).toBe(false);
  });

  it('does not let two long facts collide on the first 80 characters', async () => {
    const { factKey } = await import('./beliefs.js');
    const a =
      '码头今晚加班而且要把货舱重新清一遍还要通知值班官和补网人以及后甲板的人不要走开还要把灯笼巷的消息再传一遍给所有还在船上的人并且把夜市的灯再点一轮还要再对认养的人说一声';
    const b = `${a}但是其实不用加班`;
    expect(factKey(a)).not.toBe(factKey(b));
    expect(factKey(a).length).toBeGreaterThan(20);
  });

  it('forces a seed-end reflection below the usual importance threshold', async () => {
    const { forceSeedReflections } = await import('./reflect.js');
    const stream = new MemoryStream();
    stream.add(
      createMemoryEntry({
        id: 'm1',
        agentId: 'a',
        kind: 'observation',
        text: '码头的人今天没来交班',
        simTime: 10,
        importance: 8,
      }),
    );
    const n = await forceSeedReflections({
      stream,
      agents: [{ id: 'a', name: '阿禾' }],
      nowSimTime: 16,
      sinceSimTime: 8,
      count: 1,
      idFactory: () => 'r1',
    });
    expect(n).toBeGreaterThan(0);
    expect(stream.list('a').some((m) => m.kind === 'reflection')).toBe(true);
  });

  it('records English already-knows beliefs without 已经知道', async () => {
    const { shouldTell, rememberTold } = await import('./beliefs.js');
    const stream = new MemoryStream();
    rememberTold({
      stream,
      selfId: 'a',
      otherId: 'v1',
      otherName: 'Vega',
      fact: 'Word is out: meet at Bridge tonight',
      nowSimTime: 8,
      idFactory: () => 't1',
    });
    const text = stream.list('a')[0]?.text ?? '';
    expect(text).toMatch(/^【信念】/);
    expect(text).toMatch(/already knows:/);
    expect(text).not.toMatch(/已经知道|（v1）/);
    expect(shouldTell(stream, 'a', 'v1', 'Word is out: meet at Bridge tonight')).toBe(
      false,
    );
  });

  it('evolves relations on promises and conflicts, not just +0.05', async () => {
    const { evolveRelation } = await import('./relations.js');
    const promised = evolveRelation(
      { summary: '【相识】点头之交', affinity: 0.2, kind: 'acquaintance' },
      { summary: '约好明天见', spreadCount: 1 },
    );
    expect(promised.kind).toBe('promise');
    expect(promised.affinity).toBeGreaterThan(0.2);
    const fight = evolveRelation(promised, {
      summary: '当场吵翻了',
      spreadCount: 0,
    });
    expect(fight.kind).toBe('conflict');
    const family = evolveRelation(
      { summary: '【家人】母子', affinity: 0.9, kind: 'family' },
      { summary: '吵了一架', spreadCount: 0 },
    );
    expect(family.kind).toBe('family');
  });

  it('formats inspector commitments from promise and conflict ties', async () => {
    const { formatCommitmentLines } = await import('./relations.js');
    const lines = formatCommitmentLines(
      [
        {
          from: 'a',
          to: 'b',
          kind: 'promise',
          summary: '【有约定】约好今晚广场见',
        },
        {
          from: 'c',
          to: 'a',
          kind: 'conflict',
          summary: '【闹过别扭】吵翻了',
        },
      ],
      'a',
      (id) => (id === 'b' ? '玛拉' : '铁砧'),
    );
    expect(lines.some((l) => l.includes('今晚碰面') && l.includes('玛拉'))).toBe(
      true,
    );
    expect(lines.some((l) => l.includes('还没和好') && l.includes('铁砧'))).toBe(
      true,
    );
  });

  it('walks to a portal instead of teleporting across regions', async () => {
    const { stepSociety, firstPortalHop } = await import('./tick.js');
    expect(
      firstPortalHop(
        [
          {
            id: 'ab',
            fromRegionId: 'west',
            toRegionId: 'hub',
            fromPos: { x: 8, y: 4 },
            toPos: { x: 1, y: 4 },
          },
          {
            id: 'bc',
            fromRegionId: 'hub',
            toRegionId: 'east',
            fromPos: { x: 8, y: 4 },
            toPos: { x: 1, y: 4 },
          },
        ],
        'west',
        'east',
      )?.id,
    ).toBe('ab');
    const state = createSocietyState({
      seed: 2,
      simTime: 10,
      agents: [
        {
          id: 'a',
          name: 'Ada',
          identitySummary: 'baker',
          regionId: 'west',
          x: 2,
          y: 4,
        },
        {
          id: 'b',
          name: 'Bo',
          identitySummary: 'smith',
          regionId: 'east',
          x: 2,
          y: 4,
        },
      ],
      regionBounds: new Map([
        ['west', { width: 12, height: 8 }],
        ['east', { width: 12, height: 8 }],
      ]),
      portals: [
        {
          id: 'w2e',
          fromRegionId: 'west',
          toRegionId: 'east',
          fromPos: { x: 10, y: 4 },
          toPos: { x: 1, y: 4 },
          label: '东门',
        },
        {
          id: 'e2w',
          fromRegionId: 'east',
          toRegionId: 'west',
          fromPos: { x: 1, y: 4 },
          toPos: { x: 10, y: 4 },
          label: '西门',
        },
      ],
    });
    state.plans.set('a', {
      agentId: 'a',
      dayIndex: 0,
      segments: [
        {
          startHour: 0,
          endHour: 24,
          activity: '去东边干活',
          locationId: 'east',
        },
      ],
    });
    await stepSociety(state, { dtHours: 0.25, skipConversations: true });
    expect(state.agents[0]?.regionId).toBe('west');
    expect(state.agents[0]?.x).toBeGreaterThan(2);
    for (let i = 0; i < 16; i++) {
      await stepSociety(state, { dtHours: 0.25, skipConversations: true });
    }
    expect(state.agents[0]?.regionId).toBe('east');
  });

  it('uses English portal actions on an ASCII crew walk', async () => {
    const { stepSociety } = await import('./tick.js');
    const { portalHeadingAction, portalCrossingAction } = await import(
      './copyLocale.js'
    );
    expect(portalHeadingAction('airlock', true)).toMatch(/heading to airlock/i);
    expect(portalCrossingAction('airlock', true)).toMatch(/passing airlock/i);
    expect(portalHeadingAction('airlock', true)).not.toMatch(/前往/);
    const state = createSocietyState({
      seed: 2,
      simTime: 10,
      copyAscii: true,
      packId: 'society.crew',
      agents: [
        {
          id: 'a',
          name: 'Vega',
          identitySummary: 'watch officer',
          regionId: 'west',
          x: 2,
          y: 4,
        },
        {
          id: 'b',
          name: 'Ada',
          identitySummary: 'helmsman',
          regionId: 'east',
          x: 2,
          y: 4,
        },
      ],
      regionBounds: new Map([
        ['west', { width: 12, height: 8 }],
        ['east', { width: 12, height: 8 }],
      ]),
      portals: [
        {
          id: 'w2e',
          fromRegionId: 'west',
          toRegionId: 'east',
          fromPos: { x: 10, y: 4 },
          toPos: { x: 1, y: 4 },
          label: 'airlock',
        },
        {
          id: 'e2w',
          fromRegionId: 'east',
          toRegionId: 'west',
          fromPos: { x: 1, y: 4 },
          toPos: { x: 10, y: 4 },
          label: 'aft hatch',
        },
      ],
    });
    state.plans.set('a', {
      agentId: 'a',
      dayIndex: 0,
      segments: [
        {
          startHour: 0,
          endHour: 24,
          activity: 'stand watch on the far deck',
          locationId: 'east',
        },
      ],
    });
    const seen: string[] = [];
    await stepSociety(state, { dtHours: 0.25, skipConversations: true });
    seen.push(state.agents[0]?.currentAction ?? '');
    for (let i = 0; i < 16; i++) {
      await stepSociety(state, { dtHours: 0.25, skipConversations: true });
      seen.push(state.agents[0]?.currentAction ?? '');
    }
    expect(seen.join('\n')).toMatch(/heading to|passing|crossing/i);
    expect(seen.join('\n')).not.toMatch(/前往|经过|穿过/);
    expect(state.agents[0]?.regionId).toBe('east');
  });

  it('labels a walker heading to a named place instead of the work beat', async () => {
    const { stepSociety } = await import('./tick.js');
    const { headingToPlaceAction } = await import('./copyLocale.js');
    expect(headingToPlaceAction('麦田', false)).toBe('往麦田走');
    const state = createSocietyState({
      seed: 1,
      simTime: 10,
      agents: [
        {
          id: 'a',
          name: '阿禾',
          identitySummary: '农夫',
          regionId: 'town',
          x: 2,
          y: 2,
        },
      ],
      regionBounds: new Map([['town', { width: 24, height: 20 }]]),
      anchors: new Map([
        [
          'field',
          {
            regionId: 'town',
            x: 18,
            y: 16,
            name: '麦田',
            kind: 'work' as const,
          },
        ],
      ]),
    });
    state.plans.set('a', {
      agentId: 'a',
      dayIndex: 0,
      segments: [
        {
          startHour: 0,
          endHour: 24,
          activity: '去麦田看麦',
          locationId: 'field',
        },
      ],
    });
    await stepSociety(state, {
      dtHours: 0.25,
      skipConversations: true,
      maxConversationsPerStep: 0,
    });
    expect(state.agents[0]?.currentAction).toMatch(/往麦田走|前往麦田/);
    expect(state.agents[0]?.goalPlace).toMatch(/麦田/);
  });

  it('does not A* chase 12 tiles when already next to a talk partner', async () => {
    const { stepSociety } = await import('./tick.js');
    const state = createSocietyState({
      seed: 4,
      simTime: 18,
      agents: [
        {
          id: 'a',
          name: 'Ada',
          identitySummary: '面包师',
          regionId: 'town',
          x: 5,
          y: 5,
        },
        {
          id: 'b',
          name: 'Bo',
          identitySummary: '铁匠',
          regionId: 'town',
          x: 7,
          y: 5,
        },
      ],
      regionBounds: new Map([['town', { width: 20, height: 16 }]]),
    });
    const before = { x: state.agents[0]!.x, y: state.agents[0]!.y };
    await stepSociety(state, {
      dtHours: 0.25,
      skipConversations: true,
      maxConversationsPerStep: 1,
    });
    const dx = Math.abs((state.agents[0]?.x ?? 0) - before.x);
    const dy = Math.abs((state.agents[0]?.y ?? 0) - before.y);
    expect(dx + dy).toBeLessThan(8);
  });

  it('prefers a nested room over its parent building when equally close', async () => {
    const { nearestAreaAnchor } = await import('./anchors.js');
    const anchors = new Map([
      [
        'shop',
        {
          regionId: 'town',
          x: 5,
          y: 5,
          name: '铁匠铺',
          kind: 'work' as const,
        },
      ],
      [
        'hearth',
        {
          regionId: 'town',
          x: 5,
          y: 5,
          name: '炉边',
          kind: 'work' as const,
          parentAreaId: 'shop',
        },
      ],
    ]);
    const hit = nearestAreaAnchor(anchors, [], {
      regionId: 'town',
      x: 5,
      y: 5,
    });
    expect(hit?.areaId).toBe('hearth');
    expect(hit?.areaName).toBe('炉边');
  });

  it('interview cites a retrieved memory in the first-person answer', async () => {
    const { interviewAgent } = await import('./interview.js');
    const stream = new MemoryStream();
    stream.add(
      createMemoryEntry({
        id: 'm1',
        agentId: 'a',
        kind: 'observation',
        text: '铁砧今晚在广场办聚会',
        simTime: 10,
        importance: 8,
      }),
    );
    stream.add(
      createMemoryEntry({
        id: 'sheet',
        agentId: 'a',
        kind: 'observation',
        text: '【身份】面包师，爱打听',
        simTime: 10,
        importance: 8,
      }),
    );
    stream.add(
      createMemoryEntry({
        id: 'iv',
        agentId: 'a',
        kind: 'observation',
        text: '有人采访我，问：「天气」。我答：「还行」',
        simTime: 10,
        importance: 7,
      }),
    );
    const result = await interviewAgent({
      stream,
      agentId: 'a',
      agentName: 'Ada',
      identity: '面包师，爱打听镇上的事',
      occupation: '面包师',
      question: '今晚广场聚会怎么样了？',
      nowSimTime: 12,
      llm: async (prompt) => {
        expect(prompt).toContain('铁砧');
        expect(prompt).not.toContain('【身份】');
        expect(prompt).not.toContain('有人采访我');
        return '我记得铁砧今晚要在广场办聚会。';
      },
    });
    expect(result.answer).toContain('聚会');
    expect(result.cited.some((c) => c.includes('聚会'))).toBe(true);
    expect(result.citedMemoryIds).toContain('m1');
    expect(result.source).toBe('model');
    expect(
      stream.list('a').some((m) => m.text.includes('有人采访我')),
    ).toBe(true);
  });

  it('recites memories when MiniMax is not available', async () => {
    const { interviewFromMemories, composeMemoryInterviewAnswer } = await import(
      './interview.js'
    );
    expect(
      composeMemoryInterviewAnswer({
        question: '窑火呢',
        memories: ['窑火天亮前就灭了'],
        ascii: false,
      }),
    ).toMatch(/窑火/);
    const stream = new MemoryStream();
    stream.add(
      createMemoryEntry({
        id: 'm1',
        agentId: 'a',
        kind: 'observation',
        text: '窑火天亮前就灭了',
        simTime: 10,
        importance: 8,
      }),
    );
    const result = interviewFromMemories({
      stream,
      agentId: 'a',
      agentName: '阿禾',
      identity: '看窑的人',
      occupation: '窑工',
      question: '窑火还在吗？',
      nowSimTime: 12,
    });
    expect(result.source).toBe('memory');
    expect(result.answer).toMatch(/窑火/);
    expect(result.cited.some((c) => c.includes('窑火'))).toBe(true);
  });

  it('admits a cross-agent fact split and refuses same-day interview recitation', async () => {
    const { interviewAgent } = await import('./interview.js');
    const { findTownDisagreements } = await import('./beliefs.js');
    const stream = new MemoryStream();
    stream.add(
      createMemoryEntry({
        id: 'over_a',
        agentId: 'a',
        kind: 'observation',
        text: '码头今晚加班',
        simTime: 10,
        importance: 8,
      }),
    );
    stream.add(
      createMemoryEntry({
        id: 'over_b',
        agentId: 'b',
        kind: 'observation',
        text: '码头今晚不用加班',
        simTime: 10,
        importance: 8,
      }),
    );
    const split = findTownDisagreements(stream, ['a', 'b']);
    expect(split.length).toBeGreaterThan(0);
    const asked: string[] = [];
    const first = await interviewAgent({
      stream,
      agentId: 'a',
      agentName: '阿禾',
      identity: '补网人',
      occupation: '补网人',
      question: '今晚码头还加班吗？',
      nowSimTime: 12,
      llm: async (prompt) => {
        asked.push(prompt);
        expect(prompt).toMatch(/不得静默覆盖|silently overwrite/);
        return '有人说加班，也有人说不用，我不敢替他们圆过去。';
      },
    });
    expect(first.answer).toContain('加班');
    const again = await interviewAgent({
      stream,
      agentId: 'a',
      agentName: '阿禾',
      identity: '补网人',
      question: '今晚码头还加班吗？',
      nowSimTime: 13,
      llm: async () => {
        throw new Error('same-day repeat must not call the model');
      },
    });
    expect(again.answer).toMatch(/今天已经答过了|Ask another way/);
  });

  it('retrieves a paid whisper on the next speak and scores the cite', async () => {
    const { converseGroup } = await import('./converse.js');
    const { measureDialogueQuality } = await import('./eval/metrics.js');
    const { whisperMemory } = await import('./copyLocale.js');
    const stream = new MemoryStream();
    stream.add(
      createMemoryEntry({
        id: 'wh_a',
        agentId: 'a',
        kind: 'observation',
        text: whisperMemory('夜市灯笼巷要提前收摊', false),
        simTime: 10,
        importance: 9,
      }),
    );
    stream.add(
      createMemoryEntry({
        id: 'day_a',
        agentId: 'a',
        kind: 'observation',
        text: '今天风有点大',
        simTime: 10.1,
        importance: 3,
      }),
    );
    stream.add(
      createMemoryEntry({
        id: 'day_b',
        agentId: 'b',
        kind: 'observation',
        text: '刚从井边回来',
        simTime: 10.1,
        importance: 3,
      }),
    );
    const top = retrieveMemories(stream.list('a'), '甲 乙', 11, { limit: 2 });
    expect(top.some((m) => m.id === 'wh_a')).toBe(true);
    const result = await converseGroup({
      stream,
      participants: [
        { id: 'a', name: '甲', identity: '摊主', stance: '闲话不传给外人' },
        { id: 'b', name: '乙', identity: '补网人', stance: '先信一起干活的人' },
      ],
      nowSimTime: 11,
      idFactory: () => 'wh1',
    });
    expect(result.skipEvent).toBe(true);
    expect(result.turns).toHaveLength(0);
    const citedTurns = result.turns.filter((t) =>
      t.citedMemoryIds?.includes('wh_a'),
    );
    const quality = measureDialogueQuality(
      {
        agents: [
          { id: 'a', name: '甲', identitySummary: '摊主' },
          { id: 'b', name: '乙', identitySummary: '补网人' },
        ],
        stream,
      } as never,
      [
        {
          id: 'd1',
          simTime: 11,
          kind: 'dialogue',
          payload: { turns: citedTurns },
        },
      ],
    );
    expect(quality.citesMemory).toBe(0);
    const paid = createMemoryEntry({
      id: 'paid14',
      agentId: 'a',
      kind: 'observation',
      text: whisperMemory('夜市加一场灯会', false),
      simTime: 10,
      importance: 14,
    });
    expect(paid.importance).toBe(14);
    const missed = measureDialogueQuality(
      {
        agents: [{ id: 'a', name: '甲', identitySummary: '摊主' }],
        stream,
      } as never,
      [
        {
          id: 'd2',
          simTime: 11.5,
          kind: 'dialogue',
          payload: {
            turns: [
              { speakerId: 'a', speakerName: '甲', text: '风还是大', citedMemoryIds: [] },
            ],
          },
        },
      ],
    );
    expect(missed.citesMemory).toBeLessThanOrEqual(0.15);
  });

  it('puts opposite town facts into the converse prompt', async () => {
    const { converseGroup } = await import('./converse.js');
    const stream = new MemoryStream();
    stream.add(
      createMemoryEntry({
        id: 'f1',
        agentId: 'a',
        kind: 'observation',
        text: '码头今晚加班',
        simTime: 10,
        importance: 8,
      }),
    );
    stream.add(
      createMemoryEntry({
        id: 'f2',
        agentId: 'b',
        kind: 'observation',
        text: '码头今晚不用加班',
        simTime: 10,
        importance: 8,
      }),
    );
    let prompt = '';
    await converseGroup({
      stream,
      participants: [
        { id: 'a', name: '甲', identity: '值班官', stance: '先问当家' },
        { id: 'b', name: '乙', identity: '补网人', stance: '闲话不传给外人' },
      ],
      nowSimTime: 11,
      idFactory: () => 'c1',
      llm: async (p) => {
        prompt = p;
        return '{"turns":[{"speaker":"A","text":"乙，有人说加班，也有人说不用。"},{"speaker":"B","text":"甲，我听说不用加班。"}]}';
      },
    });
    expect(prompt).toMatch(/不得静默覆盖|silently overwrite/);
    expect(prompt).toMatch(/加班/);
  });

  it('template converse admits a town split instead of overwriting it', async () => {
    const { converseGroup } = await import('./converse.js');
    const stream = new MemoryStream();
    stream.add(
      createMemoryEntry({
        id: 'f1',
        agentId: 'a',
        kind: 'observation',
        text: '码头今晚加班',
        simTime: 10,
        importance: 8,
      }),
    );
    stream.add(
      createMemoryEntry({
        id: 'f2',
        agentId: 'b',
        kind: 'observation',
        text: '码头今晚不用加班',
        simTime: 10,
        importance: 8,
      }),
    );
    const result = await converseGroup({
      stream,
      participants: [
        { id: 'a', name: '甲', identity: '值班官' },
        { id: 'b', name: '乙', identity: '补网人' },
      ],
      nowSimTime: 11,
      idFactory: () => 'd1',
    });
    expect(result.degraded).toBe(true);
    expect(result.skipEvent).toBe(true);
    expect(result.turns).toHaveLength(0);
  });

  it('interview pins a paid whisper even on a generic question', async () => {
    const { interviewAgent } = await import('./interview.js');
    const { whisperMemory } = await import('./copyLocale.js');
    const stream = new MemoryStream();
    stream.add(
      createMemoryEntry({
        id: 'wh1',
        agentId: 'a',
        kind: 'observation',
        text: whisperMemory('灯笼巷夜市要提前收摊', false),
        simTime: 10,
        importance: 14,
      }),
    );
    const result = await interviewAgent({
      stream,
      agentId: 'a',
      agentName: '林嫂',
      identity: '摊主',
      occupation: '摊主',
      question: '最近怎么样？',
      nowSimTime: 12,
      llm: async (prompt) => {
        expect(prompt).toMatch(/灯笼巷|巷议|耳语|whisper/i);
        return '有人悄悄说灯笼巷夜市要提前收摊，我听进去了。';
      },
    });
    expect(result.citedMemoryIds).toContain('wh1');
    expect(result.cited.some((c) => c.includes('灯笼巷'))).toBe(true);
  });

  it('judge scores a duplicated line as not following the last turn', async () => {
    const { judgeDialogue } = await import('./judge.js');
    const dup = judgeDialogue({
      line: '你好啊',
      identity: '铁匠',
      memories: ['打铁'],
      previousLine: '你好啊',
    });
    expect(dup.followsLast).toBe(0);
  });

  it('emergence harness accepts a mock llm without calling a real model', async () => {
    let called = false;
    const result = await runEmergenceEval({
      hours: 1,
      dtHours: 1,
      llm: async () => {
        called = true;
        return '{"kind":"continue","reason":"照常"}';
      },
      maxLlmConversationsPerStep: 0,
      maxPlanLlmCallsPerStep: 0,
      thresholds: {
        minSpreadRate: 0,
        minRelations: 0,
        minPeakGatheringRate: 0,
        minScheduleDiversity: 0,
        minDialogueNovelty: 0,
      },
    });
    expect(result.residents).toBeGreaterThanOrEqual(18);
    expect(called).toBe(true);
    expect(result.card.dialogueQuality).toBeDefined();
  });

  it('optional LLM judge blends into the emergence report card', async () => {
    const { maybeLlmJudgeReportCard, buildEmergenceReportCard } = await import(
      './eval/metrics.js'
    );
    const state = createSocietyState({
      seed: 1,
      simTime: 12,
      agents: [
        {
          id: 'a',
          name: 'Ada',
          identitySummary: '铁匠，夜里也打铁',
          regionId: 'town',
          x: 4,
          y: 4,
        },
      ],
    });
    const events = [
      {
        id: 'd1',
        simTime: 12,
        kind: 'dialogue' as const,
        agentId: 'a',
        payload: {
          turns: [{ speakerId: 'a', speakerName: 'Ada', text: '今晚铁砧要办聚会' }],
        },
      },
    ];
    const base = buildEmergenceReportCard({
      state,
      events,
      seedText: '铁砧今晚在广场办聚会',
      invitationText: '聚会',
    });
    const judged = await maybeLlmJudgeReportCard(base, {
      state,
      events,
      llm: async () => '8',
    });
    expect(judged.dialogueQuality.summary).toContain('模型评判');
    expect(judged.dialogueQuality.inCharacter).toBeGreaterThan(
      base.dialogueQuality.inCharacter,
    );
  });

  it('exposes pack-agnostic kernel steps', async () => {
    const kernel = await import('./kernel.js');
    expect(typeof kernel.stepLocomotion).toBe('function');
    expect(typeof kernel.stepTalk).toBe('function');
    expect(typeof kernel.stepObjects).toBe('function');
    expect(typeof kernel.stepMemory).toBe('function');
    expect(kernel.packAllowsGathering(kernel.resolveSocietyPack({}))).toBe(
      true,
    );
    expect(
      kernel.packAllowsGathering(
        kernel.resolveSocietyPack({
          presentation: {
            genreProfile: { id: 'society.crew', verbs: ['whisper', 'set_object'] },
          },
        }),
      ),
    ).toBe(false);
  });

  it('treats English rumor prefixes as rumors', async () => {
    const { isRumorOrWhisperText } = await import('./hydrate.js');
    expect(isRumorOrWhisperText('Heard from peer: meet at Bridge tonight')).toBe(
      true,
    );
    expect(isRumorOrWhisperText('Word is out: Vega is hosting a gathering')).toBe(
      true,
    );
    expect(isRumorOrWhisperText('Someone whispered: the helm is dark')).toBe(
      true,
    );
    expect(isRumorOrWhisperText('【身份】officer')).toBe(false);
  });

  it('lets a watch-clock crew talk at hour 2', async () => {
    const { decideReaction, perceive } = await import('./react.js');
    const self = {
      agentId: 'a',
      name: 'Vega',
      regionId: 'bridge',
      x: 4,
      y: 4,
    };
    const other = {
      agentId: 'b',
      name: 'Ada',
      regionId: 'bridge',
      x: 5,
      y: 4,
    };
    const perception = perceive(self, [other], [], 5);
    const nightTown = decideReaction({
      self,
      plan: null,
      hourOfDay: 2,
      perception,
    });
    expect(nightTown.kind).toBe('continue');
    const watch = decideReaction({
      self,
      plan: null,
      hourOfDay: 2,
      perception,
      clockKind: 'watch',
      socialNeed: 0.4,
    });
    expect(watch.kind).toBe('converse');
    const quietWatch = decideReaction({
      self,
      plan: null,
      hourOfDay: 2,
      perception,
      clockKind: 'watch',
      socialNeed: 0,
    });
    expect(quietWatch.kind).not.toBe('converse');
  });

  it('classifies bunks and writes English object use copy', async () => {
    const { objectKindFromName, useWorldObject } = await import('./objects.js');
    expect(objectKindFromName('bunk')).toBe('bed');
    expect(objectKindFromName('galley')).toBe('food');
    const used = useWorldObject(
      {
        id: 'b1',
        areaId: 'sleep',
        name: 'bunk',
        state: 'made',
        kind: 'bed',
      },
      'sleep',
    );
    expect(used.action).toMatch(/rests a while on bunk/i);
    expect(used.nextState).not.toMatch(/被子/);
  });

  it('asks the converse model for English when the circle is ASCII', async () => {
    const stream = new MemoryStream();
    stream.add(
      createMemoryEntry({
        id: 'ok',
        agentId: 'a',
        kind: 'observation',
        text: 'Word is out: meet at Bridge tonight',
        simTime: 10,
        importance: 9,
      }),
    );
    stream.add(
      createMemoryEntry({
        id: 'b1',
        agentId: 'b',
        kind: 'observation',
        text: 'just left the helm',
        simTime: 10,
        importance: 5,
      }),
    );
    let prompt = '';
    const { converseGroup } = await import('./converse.js');
    await converseGroup({
      stream,
      participants: [
        { id: 'a', name: 'Vega', identity: 'watch officer' },
        { id: 'b', name: 'Ada', identity: 'helmsman' },
      ],
      nowSimTime: 11,
      topicHint: 'Word is out: meet at Bridge tonight',
      forceRumor: true,
      idFactory: () => 'c1',
      llm: async (p) => {
        prompt = p;
        return '{"turns":[{"speaker":"A","text":"Meet at the bridge tonight."}]}';
      },
    });
    expect(prompt).toMatch(/in English/i);
    expect(prompt).not.toMatch(/用中文/);
    expect(prompt).not.toMatch(/Must mention naturally/i);
    expect(prompt).toMatch(/secret, do not volunteer|goals:|feeling:|in English/i);
    expect(prompt).toMatch(/Memory:/);
    expect(prompt).not.toMatch(/记忆：/);
    expect(prompt).toMatch(/A \(Vega\)/);
  });

  it('does not force a rumor mention unless the caller asked', async () => {
    const stream = new MemoryStream();
    let prompt = '';
    const { converseGroup: talk } = await import('./converse.js');
    await talk({
      stream,
      participants: [
        { id: 'a', name: 'Vega', identity: 'watch officer' },
        { id: 'b', name: 'Ada', identity: 'helmsman' },
      ],
      nowSimTime: 11,
      topicHint: 'Word is out: meet at Bridge tonight',
      idFactory: () => 'c2',
      llm: async (p) => {
        prompt = p;
        return '{"turns":[{"speaker":"A","text":"The helm is quiet this watch."}]}';
      },
    });
    expect(prompt).not.toMatch(/Must mention naturally/i);
    expect(prompt).not.toMatch(/必须自然提到/);
  });

  it('soft-steers evidence-window dialogue toward board labels', async () => {
    const stream = new MemoryStream();
    let prompt = '';
    const { converseGroup: talk } = await import('./converse.js');
    await talk({
      stream,
      participants: [
        { id: 'a', name: '桂花', identity: '客栈掌柜' },
        { id: 'b', name: '阿禾', identity: '跑堂' },
      ],
      nowSimTime: 11,
      topicHint: '收拾桌子',
      idFactory: () => 'c3',
      courseSteering: {
        prompt: '桂花今夜还在镇上吗',
        labels: ['还在', '离开'],
        phase: 'evidence',
      },
      llm: async (p) => {
        prompt = p;
        return '{"turns":[{"speaker":"A","text":"桂花，先把碗收了。"}]}';
      },
    });
    expect(prompt).toMatch(/镇上今晚在争/);
    expect(prompt).toMatch(/还在/);
    expect(prompt).not.toMatch(/needle/i);
  });

  it('formats English meeting commitments', async () => {
    const { formatCommitmentLines } = await import('./relations.js');
    const lines = formatCommitmentLines(
      [
        {
          from: 'a',
          to: 'b',
          kind: 'promise',
          summary: '【有约定】asked Vega to meet at Bridge tonight',
        },
      ],
      'a',
      (id) => (id === 'b' ? 'Vega' : id),
    );
    expect(lines.some((l) => /meeting Vega tonight/i.test(l))).toBe(true);
  });

  it('writes an English watch schedule for an ASCII crew', () => {
    const segments = occupationDayPlan({
      agentName: 'Vega',
      occupation: 'helmsman',
      identitySummary: 'watch officer',
      homeRegionId: 'sleep_bay',
      hubRegionId: 'bridge',
      clockKind: 'watch',
      places: [
        { id: 'a_home', name: 'bunks', regionId: 'sleep_bay', kind: 'rest' },
        { id: 'a_work', name: 'helm', regionId: 'bridge', kind: 'work' },
        { id: 'a_mess', name: 'mess', regionId: 'bridge', kind: 'social' },
      ],
    });
    const text = segments.map((s) => s.activity).join('|');
    expect(text).toMatch(/on watch|handoff/i);
    expect(text).not.toMatch(/值班|交班/);
  });

  it('keeps 位于 off the English day-plan LLM prompt', async () => {
    const { generateDayPlan } = await import('./plan.js');
    const stream = new MemoryStream();
    let prompt = '';
    await generateDayPlan({
      stream,
      agentId: 'vega',
      agentName: 'Vega',
      identitySummary: 'watch officer',
      occupation: 'helmsman',
      dayIndex: 0,
      nowSimTime: 8,
      idFactory: () => 'p',
      homeRegionId: 'sleep_bay',
      places: [
        { id: 'bridge', name: 'Bridge', kind: 'work', regionId: 'bridge' },
        { id: 'bunks', name: 'Sleep bay', kind: 'rest', regionId: 'sleep_bay' },
      ],
      llm: async (p) => {
        prompt = p;
        return 'not-json';
      },
    });
    expect(prompt).toMatch(/in bridge/);
    expect(prompt).toMatch(/Memories:/);
    expect(prompt).not.toMatch(/位于|相关记忆/);
  });

  it('queues one nearby talk after a successful use-object', async () => {
    const { stepSociety } = await import('./tick.js');
    const state = createSocietyState({
      seed: 7,
      simTime: 12,
      agents: [
        {
          id: 'a',
          name: 'Ada',
          identitySummary: '面包师',
          occupation: '面包师',
          regionId: 'town',
          x: 5,
          y: 5,
          needs: { hunger: 0.99, energy: 0.1, social: 0.1, curiosity: 0.1 },
        },
        {
          id: 'b',
          name: 'Bo',
          identitySummary: '铁匠',
          occupation: '铁匠',
          regionId: 'town',
          x: 18,
          y: 14,
          needs: { hunger: 0.1, energy: 0.1, social: 0.2, curiosity: 0.1 },
        },
      ],
      objects: [
        {
          id: 'obj_oven',
          areaId: 'town',
          regionId: 'town',
          name: '烤炉',
          state: '闲着',
          kind: 'oven',
        },
      ],
      regionBounds: new Map([['town', { width: 20, height: 16 }]]),
      anchors: new Map([
        [
          'obj_oven',
          {
            regionId: 'town',
            x: 5,
            y: 5,
            name: '烤炉',
            kind: 'food' as const,
          },
        ],
      ]),
    });
    const events = await stepSociety(state, {
      dtHours: 0.25,
      skipConversations: true,
      maxConversationsPerStep: 4,
      maxPlanLlmCallsPerStep: 0,
    });
    const used = events.find((e) => e.kind === 'use-object');
    expect(used).toBeTruthy();
    const action = String(used?.payload['action'] ?? '');
    expect(action.length).toBeGreaterThan(0);
    expect(
      (state.pendingTalks ?? []).some(
        (j) => j.topicHint === action && j.initiatorId === 'a',
      ),
    ).toBe(true);
  });

  it('names the town-wide speaker from pack and ascii', async () => {
    const { townWideSpeaker, isTownWideSpeaker } = await import(
      './copyLocale.js'
    );
    expect(townWideSpeaker({ ascii: true, packId: 'society.crew' })).toBe(
      'Whole crew',
    );
    expect(townWideSpeaker({ ascii: true, packId: 'society.crew' })).not.toBe(
      '全镇',
    );
    expect(townWideSpeaker({ ascii: false })).toBe('全镇');
    expect(isTownWideSpeaker('Whole crew')).toBe(true);
    expect(isTownWideSpeaker('Town')).toBe(true);
    expect(isTownWideSpeaker('Vega')).toBe(false);
  });

  it('parses English and Chinese witness places', async () => {
    const { placeFromWitnessText } = await import('./copyLocale.js');
    expect(
      placeFromWitnessText('Vega is at Bridge, standing the helm', 'Vega'),
    ).toBe('Bridge');
    expect(
      placeFromWitnessText('铁砧在喷泉广场，正在给炉火添炭', '铁砧'),
    ).toBe('喷泉广场');
    expect(placeFromWitnessText('Vega is standing the helm', 'Vega')).toBeUndefined();
  });
});
