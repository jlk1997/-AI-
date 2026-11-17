/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import {
  APPRAISAL_BATCH,
  COLLECTIVE_THRESHOLD,
  applyAppraisal,
  applyTalkOutcomes,
  boardView,
  consumeSpotlight,
  feedbackCollective,
  deriveCrowd,
  directorBeat,
  emptyMind,
  openSpotlight,
  forecastCrowd,
  type SocietyMind,
  nextAppraisalBatch,
  noteUtterance,
  parseAppraisal,
  parseTalkOutcomes,
  publishPolicy,
  stepCrowd,
  topicIsStale,
  trimBelief,
} from './societyMind.js';

const people = [
  { id: 'a', name: '阿桂', occupation: '摊主', regionId: 'market', stance: '反对涨价' },
  { id: 'b', name: '老周', occupation: '摊主', regionId: 'market', stance: '支持' },
  { id: 'c', name: '小梅', occupation: '教师', regionId: 'school' },
];

describe('society mind', () => {
  it('derives cohorts and moves them toward a local leader', () => {
    const crowd = deriveCrowd(people, 1500);
    expect(crowd.length).toBeGreaterThan(0);
    expect(crowd.reduce((s, c) => s + c.size, 0)).toBeGreaterThan(100);
    let mind: SocietyMind = { ...emptyMind(), crowd };
    const before = mind.crowd.find((c) => c.regionId === 'market')!.hist[0]!;
    mind = stepCrowd(
      mind,
      [{ agentId: 'a', regionId: 'market', stance: -2 }],
      1,
    );
    const after = mind.crowd.find((c) => c.regionId === 'market')!.hist[0]!;
    expect(after).toBeGreaterThanOrEqual(before);
    expect(mind.history.length).toBe(1);
  });

  it('appraises a policy in batches and keeps reasons', () => {
    let mind = publishPolicy(emptyMind(), {
      id: 'p1',
      title: '夜市下周起征收摊位费',
      body: '每个摊位每周收费。',
      tags: ['摊主'],
      at: 2,
    });
    const batch = nextAppraisalBatch(mind, people, 'p1');
    expect(batch.length).toBeLessThanOrEqual(APPRAISAL_BATCH);
    expect(batch.every((p) => p.occupation === '摊主')).toBe(true);
    const parsed = parseAppraisal(
      '{"rows":[{"id":"a","stance":-2,"emotion":"生气","reason":"摊位费太高","action":"请愿"}]}',
    );
    expect(parsed?.[0]?.stance).toBe(-2);
    mind = applyAppraisal(mind, 'p1', parsed!, 3);
    const board = boardView(mind);
    expect(board.leaders[0]?.reason).toContain('摊位费');
    expect(board.policies[0]?.title).toContain('夜市');
  });

  it('turns repeated lines away and commitments into a gathering', () => {
    let mind = emptyMind();
    const first = noteUtterance(mind, 'a', '摊位费太高了');
    expect(first.novel).toBe(true);
    const again = noteUtterance(first.mind, 'a', '摊位费太高了');
    expect(again.novel).toBe(false);
    expect(topicIsStale(['摊位费太高了'], '摊位费太高了')).toBe(true);
    const outcomes = parseTalkOutcomes(
      '{"turns":[],"outcomes":{"commitments":[{"speaker":"阿桂","action":"请愿"}],"newFacts":["下周收费"]}}',
    );
    expect(outcomes?.commitments?.[0]?.action).toBe('请愿');
    mind = applyTalkOutcomes(mind, {
      outcomes: {
        commitments: Array.from({ length: COLLECTIVE_THRESHOLD }, (_, i) => ({
          speaker: people[i % 2]!.name,
          action: '请愿',
        })),
      },
      people,
      topicId: 'p1',
      at: 4,
    });
    expect(mind.collective?.action).toBe('请愿');
    expect(trimBelief('x'.repeat(500)).length).toBe(200);
  });

  it('forecasts a band without calling a model', () => {
    const mind: SocietyMind = { ...emptyMind(), crowd: deriveCrowd(people, 800) };
    const { bands } = forecastCrowd(mind, 6, 20, 3);
    expect(bands).toHaveLength(6);
    expect(bands[0]!.supportHi).toBeGreaterThanOrEqual(bands[0]!.supportLo);
  });

  it('opens a story arc when the town is tense', () => {
    const mind = directorBeat(emptyMind(), {
      at: 5,
      lowAffinityPairs: 2,
      stanceClash: true,
      openCommitments: 1,
    });
    expect(mind.arcs[0]?.phase).toBe('setup');
  });

  it('hardens the stances of people who gathered', () => {
    const mind = applyAppraisal(
      publishPolicy(emptyMind(), { id: 'fee', title: '收费', body: '每周', at: 1 }),
      'fee',
      [{ id: 'a', stance: -1, emotion: '怒', reason: '贵', action: '请愿' }],
      2,
    );
    const gathered = feedbackCollective(
      { ...mind, collective: { action: '请愿', regionId: 'market', count: 4 } },
      ['a'],
      5,
    );
    expect(gathered.opinions[0]?.stance).toBe(-2);
    expect(gathered.spotlight?.text).toContain('请愿');
  });

  it('says a story beat once, then treats it as already heard', () => {
    const opened = openSpotlight(emptyMind(), '分歧摆到了明面上', 3);
    expect(opened.spotlight?.text).toContain('分歧');
    const again = openSpotlight(opened, '分歧摆到了明面上', 4);
    expect(again).toBe(opened);
    const heard = consumeSpotlight(opened, '分歧摆到了明面上');
    expect(heard.spotlight).toBeUndefined();
    expect(topicIsStale(heard.recentTopics, '分歧摆到了明面上')).toBe(true);
  });

  it('ignores a broken outcomes blob', () => {
    expect(parseTalkOutcomes('not json')).toBeNull();
    expect(parseAppraisal('nope')).toBeNull();
  });

  it('walks the recording script on the crowd layer without a model', () => {
    const residents = Array.from({ length: 12 }, (_, i) => ({
      id: `n${i}`,
      name: `居民${i}`,
      occupation: i < 6 ? '摊主' : '教师',
      regionId: i < 6 ? 'market' : 'school',
      stance: i % 2 === 0 ? '反对涨价' : '支持',
    }));
    let mind: SocietyMind = {
      ...emptyMind(),
      crowd: deriveCrowd(residents, 1500),
    };
    expect(mind.crowd.reduce((s, c) => s + c.size, 0)).toBeGreaterThan(1000);
    mind = publishPolicy(mind, {
      id: 'fee',
      title: '夜市下周起征收摊位费',
      body: '每个摊位每周收费。',
      tags: ['摊主'],
      at: 1,
    });
    const batch = nextAppraisalBatch(mind, residents, 'fee');
    expect(batch.length).toBeGreaterThan(0);
    expect(batch.length).toBeLessThanOrEqual(APPRAISAL_BATCH);
    const rows = parseAppraisal(
      JSON.stringify({
        rows: batch.map((p, i) => ({
          id: p.id,
          stance: i % 2 === 0 ? -2 : 1,
          emotion: '急',
          reason: i % 2 === 0 ? '摊位费太高' : '规则清楚些也好',
          action: i % 2 === 0 ? '请愿' : '观望',
        })),
      }),
    );
    mind = applyAppraisal(mind, 'fee', rows!, 2);
    mind = stepCrowd(
      mind,
      batch.map((p) => ({
        agentId: p.id,
        regionId: p.regionId || 'market',
        stance: -1,
      })),
      2,
    );
    const first = forecastCrowd(mind, 8, 50, 1);
    mind = publishPolicy(mind, {
      id: 'clarify',
      title: '官方澄清：低收入摊主减免',
      body: '低收入摊主减免。',
      tags: ['摊主'],
      at: 3,
    });
    mind = applyAppraisal(mind, 'clarify', [
      { id: 'n0', stance: 0, emotion: '缓', reason: '减免之后可以留下', action: '继续摆摊' },
    ], 4);
    mind = stepCrowd(
      mind,
      [{ agentId: 'n0', regionId: 'market', stance: 0 }],
      4,
    );
    const second = forecastCrowd(mind, 8, 50, 1);
    expect(first.bands).toHaveLength(8);
    expect(second.bands).toHaveLength(8);
    const width = (bands: typeof first.bands) =>
      bands.reduce((s, b) => s + (b.supportHi - b.supportLo), 0);
    expect(width(second.bands)).toBeLessThanOrEqual(width(first.bands) + 0.05);
    expect(boardView(mind).policies.map((p) => p.title)).toEqual([
      '夜市下周起征收摊位费',
      '官方澄清：低收入摊主减免',
    ]);
  });
});
