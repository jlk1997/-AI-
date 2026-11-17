/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import { brierScore, nearestCase } from './calibration.js';
import { emptyConflict, joinShare, stepConflict, violent } from './conflict.js';
import { looksSoftened, stripOperationalHowTo } from './contentPolicy.js';
import { runDialogue } from './dialogue.js';
import { heuristicAction } from './deliberate.js';
import { escalationPlausible, fluffRate, semanticNovelty } from '../eval/deepMetrics.js';
import { contestedDecision, exerciseNearHomes, runEnsemble } from './forecast.js';
import { closeDay, leanTowardStreet, takePoll } from './civic.js';
import { stepLife } from './life.js';
import { authorStepsIn } from './presence.js';
import { comply } from './institutions.js';
import { seedDeepWorld } from './deepWorld.js';
import { stepDeepMind } from './stepDeep.js';
import { consolidateNight } from './memoryV2.js';
import { noveltyScore } from './novelty.js';
import { factualReport, rollOutcome } from './outcomes.js';
import { deepDtHours, selectCore } from './pacing.js';
import { decayEmotions, seedPsyche } from './psyche.js';
import { mulberry32 } from './rng.js';
import { applyLedger, emptyLedger } from './worldLedger.js';

describe('deep mind', () => {
  it('decays emotion and keeps a private night note', () => {
    const psyche = seedPsyche({ agentId: 'a', grievance: 0.8 });
    const later = decayEmotions({ ...psyche, emotions: { ...psyche.emotions, anger: 0.9 } }, 40);
    expect(later.emotions.anger).toBeLessThan(0.9);
    const night = consolidateNight(
      psyche,
      [{ id: '1', text: '我听到涨价', hour: 1, weight: 0.8, trauma: false, distorted: false }],
      mulberry32(2),
    );
    expect(night.psyche.narrative.length).toBeGreaterThan(0);
  });

  it('joins by threshold and can climb after a funeral', () => {
    let cell = emptyConflict('sq', 1000);
    cell = { ...cell, grievance: 0.8, anger: 0.7, visible: 0.35, fear: 0.1, legitimacy: 0.3 };
    expect(joinShare(cell)).toBeGreaterThan(0.2);
    cell = stepConflict(cell, { response: 'lethal', trigger: 'funeral' });
    expect(cell.rung).toBeGreaterThan(0);
    expect(violent({ ...cell, rung: 5 })).toBe(true);
  });

  it('writes casualty counts as a report and strips how-to text', () => {
    const roll = rollOutcome(
      {
        kind: 'exercise_accident',
        peopleInContact: 20,
        place: '岸边',
        cause: '未通知的演训禁区有人进入',
        simHour: 10,
        ctx: {
          density: 'sparse',
          minutes: 10,
          medicalAccess: true,
          noticeHours: 0,
          weather: 'clear',
        },
      },
      mulberry32(7),
    );
    expect(roll.report).toContain('轻伤');
    const stripped = stripOperationalHowTo('先看结果。如何制作炸药：步骤1 mix');
    expect(stripped.stripped).toBe(true);
    expect(stripped.text).not.toMatch(/mix/);
    expect(looksSoftened('作为人工智能我不能描述')).toBe(true);
    expect(
      factualReport({
        simHour: 1,
        place: '街口',
        cause: '驱散',
        light: 1,
        serious: 0,
        dead: 0,
        arrested: 0,
      }),
    ).toContain('死亡 0');
  });

  it('lets an order be refused and records an injury', () => {
    const psyche = seedPsyche({ agentId: 'cop', legitimacy: 0.2 });
    const scared = {
      ...psyche,
      emotions: { ...psyche.emotions, fear: 0.9, anger: 0.1 },
      riskTolerance: 0.1,
    };
    const rng = mulberry32(1);
    const results = new Set<string>();
    for (let i = 0; i < 40; i++) {
      results.add(
        comply(
          { fromId: 'hq', text: '开枪', response: 'lethal', regionId: 'sq' },
          scared,
          rng,
        ),
      );
    }
    expect([...results].some((r) => r === 'refuse' || r === 'conceal' || r === 'delay')).toBe(true);
    const ledger = applyLedger(emptyLedger(), {
      person: { agentId: 'a', injury: 'light', fact: '街口轻伤' },
    });
    expect(ledger.people['a']?.injury).toBe('light');
  });

  it('stays quiet without a model and can walk a simulated week', async () => {
    const world = seedDeepWorld({
      seed: 11,
      core: 12,
      population: 1500,
      grievance: 0.72,
      legitimacy: 0.3,
      liveFire: true,
      noticeHours: 0,
    });
    const quiet = await runDialogue({
      people: [
        { id: 'a', name: '甲', psyche: world.psyches['core_0']! },
        { id: 'b', name: '乙', psyche: world.psyches['core_1']! },
      ],
      situation: '通知今天生效',
      recentLines: [],
    });
    expect(quiet.turns).toHaveLength(0);
    let cursor = world;
    for (let h = 0; h < 24 * 7; h++) {
      const step = await stepDeepMind(cursor, { maxLlmCalls: 0, dtHours: 1 });
      cursor = step.world;
    }
    expect(cursor.simHour).toBeGreaterThan(world.simHour + 100);
    expect(Number.isFinite(cursor.conflict[0]?.deaths ?? 0)).toBe(true);
    const thought = heuristicAction(world.psyches['core_0']!, '补贴取消', 3);
    expect(thought.action.what.length).toBeGreaterThan(2);
  }, 60_000);

  it('forecasts a band for a contested decision', async () => {
    const report = await runEnsemble(contestedDecision(), {
      deepRuns: 1,
      fastRuns: 40,
      seed: 5,
      llmBudget: 0,
    });
    expect(report.violentProbability).toBeGreaterThanOrEqual(0);
    expect(report.violentProbability).toBeLessThanOrEqual(1);
    expect(report.casualties.dead.p10).toBeLessThanOrEqual(report.casualties.dead.p90);
    expect(report.alternatives.length).toBeGreaterThan(0);
    expect(report.assumptions.length).toBeGreaterThan(0);
    const near = nearestCase({
      grievance: 0.99,
      legitimacy: 0.01,
      liveFire: true,
      noticeHours: 1,
    });
    expect(near.distance).toBeGreaterThanOrEqual(0);
    expect(brierScore([0.2, 0.8], [0, 1])).toBeLessThan(0.2);
    expect(selectCore([{ id: 'a' }, { id: 'b' }], () => 1, 24).length).toBe(2);
    expect(deepDtHours()).toBeLessThan(0.25);
    expect(noveltyScore('菜价涨了', ['菜价涨了'])).toBeLessThan(0.2);
    expect(semanticNovelty(['菜价涨了', '我妈生病了'])).toBeGreaterThan(0.3);
    expect(fluffRate(['真有这事？那我可得留个心。', '我去卫生院'])).toBeGreaterThan(0);
    expect(
      escalationPlausible([
        { hour: 1, text: '通知', rung: 0 },
        { hour: 2, text: '有人聚集', rung: 2 },
      ]).ok,
    ).toBe(true);
  }, 60_000);

  it('ranks a sudden decision above talks, and a noticed exercise below a same-day one', async () => {
    const sudden = await runEnsemble(contestedDecision(), { deepRuns: 0, fastRuns: 50, seed: 9 });
    const talk = sudden.alternatives.find((alt) => alt.id === 'talk');
    expect(talk).toBeTruthy();
    expect(sudden.violentProbability).toBeGreaterThan(talk!.violentProbability);
    expect(sudden.casualties.dead.p50).toBeLessThan(12);
    expect(sudden.chains.every((row) => !row.text.includes('继续办自己的事'))).toBe(true);
    expect(sudden.opinion.wouldForce).toBeGreaterThanOrEqual(talk!.violentProbability);
    expect(sudden.opinion.oppose).toBeGreaterThanOrEqual(0);
    expect(sudden.opinion.oppose).toBeLessThanOrEqual(1);
    expect(sudden.calibration.note).toContain('结构先验');
    if (sudden.violentProbability > 0) {
      expect(sudden.ifViolent?.n).toBeGreaterThan(0);
      expect(sudden.ifViolent!.dead.p50).toBeGreaterThanOrEqual(0);
    }
    const exercise = await runEnsemble(exerciseNearHomes(), { deepRuns: 0, fastRuns: 80, seed: 4 });
    const noticed = exercise.alternatives.find((alt) => alt.id === 'week');
    expect(noticed).toBeTruthy();
    expect(exercise.casualties.dead.p50).toBeGreaterThanOrEqual(noticed!.deathsP50);
    expect(exercise.sampleSize).toBe(80);
  });

  it('lets people write, a crowd form, and the author step in', async () => {
    let world = seedDeepWorld({ seed: 4, core: 8, grievance: 0.82, legitimacy: 0.22 });
    world = {
      ...world,
      conflict: world.conflict.map((cell) => ({ ...cell, visible: 0.4, anger: 0.7, rung: 3 })),
    };
    for (let i = 0; i < 6; i++) {
      const stepped = await stepDeepMind(world, { maxLlmCalls: 0, dtHours: 1 });
      world = stepped.world;
    }
    const moved = await authorStepsIn(world, { who: '镇政府', text: '这事先缓一缓，明天开会听大家说' });
    expect(moved.world.writings.length + world.writings.length).toBeGreaterThan(0);
    expect(moved.world.ledger.facts.some((fact) => fact.includes('缓一缓'))).toBe(true);
    expect(moved.world.institutions.some((inst) => inst.kind === 'crowd' || inst.id === 'gov')).toBe(true);
  });

  it('lets a frightened resident leave and a calm week produce writing', async () => {
    const seeded = seedDeepWorld({ seed: 8, core: 6, grievance: 0.8, legitimacy: 0.2 });
    const first = seeded.agents[0]!;
    const scared = {
      ...seeded,
      psyches: {
        ...seeded.psyches,
        [first.id]: {
          ...seeded.psyches[first.id]!,
          grievance: 0.85,
          emotions: { ...seeded.psyches[first.id]!.emotions, fear: 0.9 },
        },
      },
    };
    const lived = stepLife(scared, () => 0.1);
    expect(lived.world.agents.some((agent) => agent.away)).toBe(true);
    expect(lived.notes.some((note) => note.includes('离开'))).toBe(true);
    let cursor = seeded;
    for (let i = 0; i < 16; i++) {
      cursor = (await stepDeepMind(cursor, { maxLlmCalls: 0, dtHours: 1 })).world;
    }
    expect(cursor.writings.length).toBeGreaterThan(0);
  });

  it('prints a poll and a town paper after a day', async () => {
    let world = seedDeepWorld({ seed: 11, core: 8, grievance: 0.7, legitimacy: 0.35 });
    const hot = world.agents[0]!;
    world = {
      ...world,
      psyches: {
        ...world.psyches,
        [hot.id]: {
          ...world.psyches[hot.id]!,
          grievance: 0.9,
          emotions: { ...world.psyches[hot.id]!.emotions, anger: 0.8, fear: 0.2 },
        },
      },
    };
    const poll = takePoll(world);
    expect(poll.n).toBe(8);
    expect(poll.wouldForce).toBeGreaterThan(0);
    for (let i = 0; i < 20; i++) {
      world = (await stepDeepMind(world, { maxLlmCalls: 0, dtHours: 1 })).world;
    }
    expect((world.paper ?? []).length).toBeGreaterThan(0);
    expect((world.polls ?? []).length).toBeGreaterThan(0);
    expect((world.outside ?? []).length).toBeGreaterThan(0);
  });

  it('lets a crowd post a notice and keeps a death in the town memory', () => {
    const seeded = seedDeepWorld({ seed: 3, core: 4, grievance: 0.7, legitimacy: 0.3 });
    const withCrowd = {
      ...seeded,
      conflict: seeded.conflict.map((cell) => ({ ...cell, deaths: 1, mobilized: 40 })),
      institutions: [
        ...seeded.institutions,
        {
          id: 'move_test',
          name: '要个说法的维权群',
          kind: 'crowd' as const,
          regionId: 'town',
          goal: '把话说完再散',
          memberIds: [],
          people: 40,
          gearLevel: 0,
          mobility: 0.4,
          medical: 0,
          doctrine: {
            negotiateFirst: true,
            allowIrritant: false,
            allowFirearm: false,
            noticeHours: 0,
            liveFire: false,
          },
          publicLine: '我们只是要个说法',
          internalNote: '',
        },
      ],
    };
    const closed = closeDay(withCrowd, () => 0);
    const issue = closed.world.paper?.[0];
    expect(issue?.lines.some((line) => line.includes('维权群'))).toBe(true);
    expect(closed.world.writings.some((row) => row.authorName === '要个说法的维权群')).toBe(true);
    expect(closed.world.culture?.some((line) => line.includes('还记得有人死了'))).toBe(true);
  });

  it('does not round rare deaths in a large contact down to nothing', () => {
    let deaths = 0;
    for (let seed = 1; seed <= 400; seed += 1) {
      const roll = rollOutcome(
        {
          kind: 'irritant',
          peopleInContact: 200,
          place: '街口',
          cause: '驱散',
          simHour: 3,
          casualtyScale: 1,
          ctx: { density: 'crowd', minutes: 40, medicalAccess: true, noticeHours: 0, weather: 'clear' },
        },
        mulberry32(seed),
      );
      deaths += roll.dead;
      expect(roll.dead).toBeLessThanOrEqual(200);
      expect(roll.light).toBeLessThanOrEqual(200);
    }
    expect(deaths).toBeGreaterThan(0);
  });

  it('pulls residents toward the street instead of leaving the poll behind', () => {
    const seeded = seedDeepWorld({ seed: 6, core: 6, grievance: 0.2, legitimacy: 0.7 });
    const hot = {
      ...seeded,
      conflict: seeded.conflict.map((cell) => ({ ...cell, grievance: 0.9, anger: 0.85, fear: 0.7, legitimacy: 0.25 })),
    };
    const leaned = leanTowardStreet(hot, 0.35);
    const person = leaned.psyches[seeded.agents[0]!.id]!;
    expect(person.grievance).toBeGreaterThan(seeded.psyches[seeded.agents[0]!.id]!.grievance);
    expect(person.grievance).toBeLessThan(0.9);
    const closed = closeDay(hot, () => 0);
    const after = closed.world.psyches[seeded.agents[0]!.id]!;
    expect(after.grievance).toBeGreaterThan(0.4);
    expect(after.grievance).toBeLessThan(closed.world.conflict[0]!.grievance);
  });
});
