/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import { activeAgentIds, preferredTaskLane } from './cognitionTier.js';
import { probeTownLoad } from './eval/loadProbe.js';
import { shouldKeyframe, trimFrameForBudget } from './frameProtocol.js';
import { reviewTalkLine } from './moderation.js';
import { scoreOpinionDynamics } from './opinionDynamics.js';
import {
  applyAudienceBallot,
  electionDecree,
  mayorChoices,
  movePeopleBetweenTowns,
  priceShock,
  quotePrice,
  tallyElection,
} from './play.js';
import { calibrateCrowd, cohortsFromDemography } from './demography.js';
import {
  applyAppraisal,
  deriveCrowd,
  emptyMind,
  forecastScenarios,
  publishPolicy,
} from './societyMind.js';
import type { SocietyEvent } from './tick.js';

describe('stage 1 opinion product', () => {
  it('keyframes the first frame and then every twelfth', () => {
    expect(shouldKeyframe(1)).toBe(true);
    expect(shouldKeyframe(2)).toBe(false);
    expect(shouldKeyframe(12)).toBe(true);
  });

  it('trims a fat frame under the byte budget', () => {
    const frame = trimFrameForBudget(
      {
        agents: Array.from({ length: 30 }, (_, i) => ({
          id: `a${i}`,
          needs: { hunger: 1, energy: 1, social: 1, curiosity: 1 },
          note: 'x'.repeat(80),
        })),
        relations: Array.from({ length: 40 }, (_, i) => ({ id: i, summary: 'y'.repeat(40) })),
      },
      1500,
    );
    const trimmed = frame as { trimmed?: boolean; agents: unknown[] };
    expect(JSON.stringify(trimmed).length).toBeLessThan(8000);
    expect(trimmed.trimmed).toBe(true);
    expect(trimmed.agents.length).toBeLessThanOrEqual(8);
  });

  it('keeps small towns fully awake and caps a large town', () => {
    expect(
      activeAgentIds({
        agentCount: 10,
        agentIds: ['a'],
        regionOf: () => 'town',
      }),
    ).toBeUndefined();
    const ids = Array.from({ length: 80 }, (_, i) => `a${i}`);
    const active = activeAgentIds({
      agentCount: 80,
      agentIds: ids,
      regionOf: (id) => (id.endsWith('0') ? 'market' : 'school'),
      leaderIds: ['a1', 'a2'],
      collectiveRegionId: 'market',
    });
    expect(active).toBeDefined();
    expect(active!.length).toBeLessThanOrEqual(48);
    expect(active).toContain('a1');
    expect(preferredTaskLane('appraisal')).toBe('floor');
    expect(preferredTaskLane('talk', 'lit')).toBe('lit');
  });

  it('scores outcomes, blocks a disallowed line, and compares two shocks', () => {
    const events: SocietyEvent[] = [
      {
        id: 'd1',
        simTime: 1,
        kind: 'dialogue',
        payload: { turns: [{ text: '摊位费太高' }], outcomes: { newFacts: ['收费'] } },
      },
      {
        id: 'd2',
        simTime: 2,
        kind: 'dialogue',
        payload: { turns: [{ text: '摊位费太高' }] },
      },
    ];
    const score = scoreOpinionDynamics({
      events,
      stances: [-2, 0, 2],
      awareRateByHour: [{ hour: 3, rate: 0.6 }],
    });
    expect(score.outcomeRate).toBe(0.5);
    expect(score.repeatRate).toBeGreaterThan(0);
    expect(score.diffusionHours).toBe(3);
    expect(score.stanceDiversity).toBeGreaterThan(0);
    expect(reviewTalkLine('今天收摊').ok).toBe(true);
    expect(reviewTalkLine('child porn').ok).toBe(false);

    let mind = publishPolicy(emptyMind(), {
      id: 'fee',
      title: '收费',
      body: '每周收费',
      at: 1,
    });
    mind = {
      ...mind,
      crowd: deriveCrowd(
        [
          { id: 'a', name: '甲', occupation: '摊主', regionId: 'market' },
          { id: 'b', name: '乙', occupation: '教师', regionId: 'school' },
        ],
        400,
      ),
    };
    mind = applyAppraisal(
      mind,
      'fee',
      [{ id: 'a', stance: -2, emotion: '怒', reason: '太贵', action: '请愿' }],
      2,
    );
    const compared = forecastScenarios(
      mind,
      [
        { id: 'tighten', delta: -1 },
        { id: 'ease', delta: 1 },
      ],
      4,
      10,
      2,
    );
    expect(compared.baseline).toHaveLength(4);
    expect(compared.scenarios).toHaveLength(2);
    expect(tallyElection(mind, 'fee').oppose).toBe(1);
    expect(mayorChoices('夜市').length).toBe(3);
    expect(quotePrice({ base: 10, stance: -2, size: 100 })).toBeGreaterThan(10);
    const voted = applyAudienceBallot(mind, 'fee', { support: 8, oppose: 2 });
    expect(voted.opinions[0]!.stance).toBeGreaterThan(mind.opinions[0]!.stance);
  });

  it('finishes a short load probe and extrapolates a day', async () => {
    const probe = await probeTownLoad({
      residents: 12,
      crowd: 200,
      hours: 1,
      dtHours: 1,
    });
    expect(probe.residents).toBe(12);
    expect(probe.crowd).toBeGreaterThan(0);
    expect(probe.frameBytes).toBeGreaterThan(10);
    expect(probe.extrapolated24hMs).toBeGreaterThan(0);
    expect(probe.poseWrites).toBe(12);
  });

  it('builds a crowd from a population mix and pulls it toward a survey', () => {
    const crowd = cohortsFromDemography(
      [
        { regionId: 'market', occupation: '摊主', income: 'low', weight: 3 },
        { regionId: 'school', occupation: '教师', ageBand: 'youth', weight: 1 },
      ],
      1000,
    );
    expect(crowd[0]!.size).toBeGreaterThan(crowd[1]!.size);
    expect(crowd.reduce((sum, cohort) => sum + cohort.size, 0)).toBe(1000);
    const before = crowd[0]!.hist[0]!;
    const mind = calibrateCrowd(
      { ...emptyMind(), crowd },
      { support: 0.1, oppose: 0.7, regionId: 'market', trust: 0.5 },
    );
    const market = mind.crowd.find((cohort) => cohort.regionId === 'market')!;
    const school = mind.crowd.find((cohort) => cohort.regionId === 'school')!;
    expect(market.hist[0]).toBeGreaterThan(before);
    expect(school.hist[0]).toBe(crowd[1]!.hist[0]);
  });

  it('turns a vote and a price into policies, and moves people between towns', () => {
    const tally = {
      support: 0.7,
      oppose: 0.1,
      crowdSupport: 0.4,
      crowdOppose: 0.2,
    };
    const decree = electionDecree(tally, '夜市收费');
    expect(decree.passed).toBe(true);
    expect(decree.title).toContain('通过');
    expect(decree.effects.urgentActivity).toContain('执行');
    const shock = priceShock({ base: 10, stance: -2, size: 2000 });
    expect(shock.price).toBeGreaterThan(10);
    expect(shock.effects.needMul).toBeGreaterThan(1);
    const from = {
      ...emptyMind(),
      crowd: cohortsFromDemography(
        [{ regionId: 'market', occupation: '摊主', weight: 1 }],
        100,
      ),
    };
    const to = {
      ...emptyMind(),
      crowd: cohortsFromDemography(
        [{ regionId: 'plaza', occupation: '居民', weight: 1 }],
        50,
      ),
    };
    const link = movePeopleBetweenTowns({
      from,
      to,
      people: 30,
      fromRegion: 'market',
      toRegion: 'plaza',
    });
    expect(link.moved).toBe(30);
    expect(link.from.crowd[0]!.size).toBe(70);
    expect(link.to.crowd.reduce((sum, cohort) => sum + cohort.size, 0)).toBe(80);
  });
});
