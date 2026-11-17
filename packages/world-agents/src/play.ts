/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Play on top of the opinion layer. Each function is a pure town change:
 * a vote, a rumor, a price, a closure, a mayor choice, an audience ballot,
 * or people moving between districts.
 */

import type { PolicyEffects, SocietyMind } from './societyMind.js';
import { boardView } from './societyMind.js';

export function tallyElection(mind: SocietyMind, topicId?: string) {
  const rows = topicId
    ? mind.opinions.filter((row) => row.topicId === topicId)
    : mind.opinions;
  const n = rows.length || 1;
  const support = rows.filter((row) => row.stance >= 1).length / n;
  const oppose = rows.filter((row) => row.stance <= -1).length / n;
  const board = boardView(mind);
  const last = board.history.at(-1);
  const leader = [...rows].sort((a, b) => Math.abs(b.stance) - Math.abs(a.stance))[0];
  return {
    support,
    oppose,
    neutral: rows.length ? 1 - support - oppose : 0,
    crowdSupport: last?.crowdSupport ?? 0,
    crowdOppose: last?.crowdOppose ?? 0,
    leader: leader?.agentId,
    passed: tallyPassed(support, oppose, last?.crowdSupport ?? 0, last?.crowdOppose ?? 0),
  };
}

function tallyPassed(
  support: number,
  oppose: number,
  crowdSupport: number,
  crowdOppose: number,
): boolean {
  return support + crowdSupport >= oppose + crowdOppose;
}

/** The side that won becomes a policy the town has to live with. */
export function electionDecree(
  tally: { readonly support: number; readonly oppose: number; readonly crowdSupport: number; readonly crowdOppose: number },
  topic: string,
): {
  readonly passed: boolean;
  readonly title: string;
  readonly body: string;
  readonly effects: PolicyEffects;
} {
  const passed = tallyPassed(
    tally.support,
    tally.oppose,
    tally.crowdSupport,
    tally.crowdOppose,
  );
  const name = topic.trim().slice(0, 24) || '这项动议';
  return {
    passed,
    title: passed ? `${name}通过` : `${name}未通过`,
    body: passed ? `${name}获多数，按此办理。` : `${name}被多数否决，先不施行。`,
    effects: {
      urgentActivity: passed ? `执行${name}` : `议论${name}被否决`,
      needMul: passed ? 1.1 : 1.25,
    },
  };
}

/** A price prints a need shock: dearer food makes hunger rise faster. */
export function priceShock(input: {
  readonly base: number;
  readonly stance: number;
  readonly size: number;
}): {
  readonly price: number;
  readonly title: string;
  readonly body: string;
  readonly effects: PolicyEffects;
} {
  const price = quotePrice(input);
  const ratio = input.base > 0 ? price / input.base : 1;
  const title = ratio > 1.05 ? '物价上涨' : ratio < 0.95 ? '物价回落' : '物价持平';
  return {
    price,
    title,
    body: `基准 ${input.base}，现价 ${price}。`,
    effects: {
      needMul: Math.max(0.6, Math.min(1.8, ratio)),
      urgentActivity: ratio > 1 ? '抱怨价钱' : '去看看新价钱',
    },
  };
}

/** People leave one town's district and arrive in another's. */
export function movePeopleBetweenTowns(input: {
  readonly from: SocietyMind;
  readonly to: SocietyMind;
  readonly people: number;
  readonly fromRegion: string;
  readonly toRegion: string;
}): { readonly from: SocietyMind; readonly to: SocietyMind; readonly moved: number } {
  const ask = Math.max(0, Math.floor(input.people));
  if (!ask || !input.fromRegion || !input.toRegion) {
    return { from: input.from, to: input.to, moved: 0 };
  }
  let left = ask;
  let moved = 0;
  let carried = input.from.crowd[0]?.hist ?? ([8, 18, 48, 18, 8] as CrowdHist);
  const fromCrowd = input.from.crowd.map((cohort) => {
    if (cohort.regionId !== input.fromRegion || left <= 0) return cohort;
    const take = Math.min(cohort.size, left);
    left -= take;
    moved += take;
    carried = cohort.hist;
    return { ...cohort, size: cohort.size - take };
  });
  if (!moved) return { from: input.from, to: input.to, moved: 0 };
  const host = input.to.crowd.find((cohort) => cohort.regionId === input.toRegion);
  const toCrowd = host
    ? input.to.crowd.map((cohort) =>
        cohort.id === host.id ? { ...cohort, size: cohort.size + moved } : cohort,
      )
    : [
        ...input.to.crowd,
        {
          id: `${input.toRegion}|迁入`,
          label: `迁入·${input.toRegion}`,
          regionId: input.toRegion,
          occupation: '迁入',
          size: moved,
          hist: carried,
        },
      ];
  return {
    from: { ...input.from, crowd: fromCrowd },
    to: { ...input.to, crowd: toCrowd },
    moved,
  };
}

type CrowdHist = readonly [number, number, number, number, number];

export function shiftConfidence(
  mind: SocietyMind,
  topicId: string,
  delta: number,
): SocietyMind {
  return {
    ...mind,
    opinions: mind.opinions.map((row) =>
      row.topicId === topicId
        ? { ...row, confidence: Math.max(0, Math.min(1, row.confidence + delta)) }
        : row,
    ),
  };
}

export function quotePrice(input: {
  readonly base: number;
  readonly stance: number;
  readonly size: number;
}): number {
  const pressure = 1 + input.stance * -0.08 + Math.min(0.2, input.size / 10_000);
  return Math.max(0, Math.round(input.base * pressure));
}

export function disasterEffects(regionId: string): PolicyEffects {
  return {
    regionId,
    urgentActivity: `离开${regionId}`,
    needMul: 1.4,
  };
}

export function mayorChoices(issue: string): Array<{
  readonly title: string;
  readonly body: string;
  readonly tags: readonly string[];
}> {
  const topic = issue.trim().slice(0, 40) || '镇务';
  return [
    { title: `维持${topic}`, body: `${topic}先按旧例。`, tags: [] },
    { title: `暂缓${topic}`, body: `${topic}推迟一周再定。`, tags: [] },
    { title: `补贴应对${topic}`, body: `受影响的人先拿一笔补贴。`, tags: [] },
  ];
}

export function applyAudienceBallot(
  mind: SocietyMind,
  topicId: string,
  ballot: { readonly support: number; readonly oppose: number },
): SocietyMind {
  const total = ballot.support + ballot.oppose;
  if (total <= 0) return mind;
  const lean = (ballot.support - ballot.oppose) / total;
  return {
    ...mind,
    opinions: mind.opinions.map((row) =>
      row.topicId !== topicId
        ? row
        : { ...row, stance: Math.max(-2, Math.min(2, row.stance + lean)) },
    ),
  };
}

export function migrateCohort(
  mind: SocietyMind,
  fromRegion: string,
  toRegion: string,
  people: number,
): SocietyMind {
  const move = Math.max(0, Math.floor(people));
  if (!move || fromRegion === toRegion) return mind;
  let moved = 0;
  const crowd = mind.crowd.map((cohort) => {
    if (cohort.regionId !== fromRegion || moved >= move) return cohort;
    const take = Math.min(cohort.size, move - moved);
    moved += take;
    return { ...cohort, size: cohort.size - take };
  });
  if (!moved) return { ...mind, crowd };
  const host = crowd.find((cohort) => cohort.regionId === toRegion);
  if (!host) {
    return {
      ...mind,
      crowd: [
        ...crowd,
        {
          id: `${toRegion}|迁入`,
          label: `迁入·${toRegion}`,
          regionId: toRegion,
          occupation: '迁入',
          size: moved,
          hist: [8, 18, 48, 18, 8] as [number, number, number, number, number],
        },
      ],
    };
  }
  return {
    ...mind,
    crowd: crowd.map((cohort) =>
      cohort.id === host.id ? { ...cohort, size: cohort.size + moved } : cohort,
    ),
  };
}
