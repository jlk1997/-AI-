/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * A town asks itself what people think, prints a short paper, and hears
 * what the next town over is doing. None of this is a scripted plot.
 */

import type { ConflictCell } from './conflict.js';
import type { DeepWorld, TownIssue, TownPoll } from './deepWorld.js';
import { clamp01 } from './rng.js';

export type { TownIssue, TownPoll };

const OUTSIDE = [
  { text: '邻镇菜价又涨了一截', grievance: 0.03, fear: 0.01 },
  { text: '邻镇有人堵了路口，消息传过来了', grievance: 0.04, fear: 0.04 },
  { text: '邻镇这周安静', grievance: -0.02, fear: -0.02 },
  { text: '邻镇厂里在招短工', grievance: -0.02, fear: 0 },
  { text: '邻镇演训的声音夜里听得见', grievance: 0.02, fear: 0.05 },
] as const;

function share(n: number, hit: number): number {
  if (n <= 0) return 0;
  return hit / n;
}

/** Move each present resident part of the way toward the street, without erasing who they are. */
export function leanTowardStreet(world: DeepWorld, amount = 0.35): DeepWorld {
  const cell = world.conflict[0];
  if (!cell) return world;
  const pull = Math.max(0, Math.min(1, amount));
  const mix = (person: number, street: number) => clamp01(person + (street - person) * pull);
  const psyches = { ...world.psyches };
  for (const agent of world.agents) {
    if (!agent.core || agent.away) continue;
    const psyche = psyches[agent.id];
    if (!psyche) continue;
    psyches[agent.id] = {
      ...psyche,
      grievance: mix(psyche.grievance, cell.grievance),
      legitimacy: mix(psyche.legitimacy, cell.legitimacy),
      emotions: {
        ...psyche.emotions,
        fear: mix(psyche.emotions.fear, cell.fear),
        anger: mix(psyche.emotions.anger, cell.anger),
      },
    };
  }
  return {
    ...world,
    psyches,
    institutions: world.institutions.map((inst) =>
      inst.kind === 'crowd' ? { ...inst, people: Math.max(0, Math.round(cell.mobilized)) } : inst,
    ),
  };
}

export function takePoll(world: DeepWorld): TownPoll {
  const people = world.agents.filter((agent) => agent.core && !agent.away);
  let oppose = 0;
  let afraid = 0;
  let wouldShow = 0;
  let wouldForce = 0;
  for (const agent of people) {
    const psyche = world.psyches[agent.id];
    if (!psyche) continue;
    if (psyche.grievance > 0.55) oppose += 1;
    if (psyche.emotions.fear > 0.55) afraid += 1;
    if (psyche.grievance > 0.45 && psyche.emotions.fear < 0.7) wouldShow += 1;
    if (psyche.emotions.anger > 0.6 && psyche.grievance > 0.6 && psyche.emotions.fear < 0.55) wouldForce += 1;
  }
  const n = people.length;
  return {
    simHour: world.simHour,
    n,
    oppose: share(n, oppose),
    afraid: share(n, afraid),
    wouldShow: share(n, wouldShow),
    wouldForce: share(n, wouldForce),
  };
}

export function pollSentence(poll: TownPoll): string {
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  return `问了${poll.n}个在场的人：反对约 ${pct(poll.oppose)}，害怕约 ${pct(poll.afraid)}，说会出门约 ${pct(poll.wouldShow)}，说会动手约 ${pct(poll.wouldForce)}。`;
}

export function nameCrowd(
  cell: ConflictCell,
  economy: number,
): { readonly name: string; readonly goal: string; readonly line: string } {
  if (economy < 0.4 && cell.grievance < 0.55) {
    return { name: '凑份子的合作社', goal: '一起进货，少被中间人吃一口', line: '街上凑起了一个合作社。' };
  }
  if (cell.rung >= 5 && cell.fear < 0.5) {
    return { name: '自己守夜的人', goal: '别让外人夜里闯进来', line: '有人开始自己守夜。' };
  }
  if (cell.grievance > 0.6) {
    return { name: '要个说法的维权群', goal: '把话说完，再决定散不散', line: '街上结成了要个说法的一群人。' };
  }
  return { name: '自己聚起来的一群人', goal: '先听清楚发生了什么', line: '街上自己结成了一群人。' };
}

export function closeDay(
  world: DeepWorld,
  rng: () => number,
): { readonly world: DeepWorld; readonly notes: readonly string[] } {
  const notes: string[] = [];
  const outside = OUTSIDE[Math.floor(rng() * OUTSIDE.length)]!;
  const cell = world.conflict[0];
  const nudged = cell
    ? {
        ...cell,
        grievance: clamp01(cell.grievance + outside.grievance),
        fear: clamp01(cell.fear + outside.fear),
        anger: clamp01(cell.anger + Math.max(0, outside.grievance) * 0.5),
      }
    : cell;
  const speakers = world.institutions
    .filter((inst) => inst.kind === 'crowd' && inst.people > 0)
    .slice(0, 2);
  const orgLines = speakers.map((inst) => `${inst.name}公开说：${inst.publicLine || inst.goal}`);
  const spilled = nudged && outside.text.includes('堵')
    ? { ...nudged, visible: clamp01(nudged.visible + 0.08) }
    : nudged;
  const leaned = leanTowardStreet(
    {
      ...world,
      conflict: spilled ? [spilled, ...world.conflict.slice(1)] : world.conflict,
    },
    0.35,
  );
  const poll = takePoll(leaned);
  const writings = [
    ...world.writings,
    ...speakers.map((inst) => ({
      simHour: world.simHour,
      authorId: inst.id,
      authorName: inst.name,
      kind: 'notice' as const,
      text: `${inst.name}贴出告示：${inst.publicLine || inst.goal}`,
    })),
  ].slice(-40);
  const quoted = writings.slice(-2).map((row) => row.text);
  const conflictLine = spilled
    ? `${spilled.regionId}这天大约 ${spilled.mobilized} 人被动员，累计死亡 ${spilled.deaths}。`
    : '街上还安静。';
  const title = poll.wouldForce > 0.3 ? '有人说会动手' : poll.oppose > 0.5 ? '反对的人过半' : '镇上的一天';
  const lines = [pollSentence(poll), `镇上听说：${outside.text}。`, ...orgLines, conflictLine, ...quoted].slice(0, 6);
  const culture = [...(world.culture ?? [])];
  if ((spilled?.deaths ?? 0) > 0 && !culture.some((line) => line.includes('还记得有人死了'))) {
    culture.push('镇里还记得有人死了');
    notes.push('镇里还记得有人死了');
  }
  const issue: TownIssue = { simHour: world.simHour, title, lines };
  notes.push(`镇报：${title}`);
  notes.push(outside.text);
  const reader = world.agents.find((agent) => agent.core && !agent.away);
  const memories = { ...world.memories };
  if (reader) {
    const prior = memories[reader.id] ?? [];
    memories[reader.id] = [
      ...prior,
      {
        id: `paper_${reader.id}_${Math.floor(world.simHour)}`,
        text: `看到镇报，听说${outside.text}`,
        hour: world.simHour,
        weight: 0.6,
        trauma: false,
        distorted: false,
      },
    ].slice(-12);
  }
  return {
    world: {
      ...leaned,
      writings,
      culture: culture.slice(-12),
      polls: [...(world.polls ?? []), poll].slice(-14),
      paper: [...(world.paper ?? []), issue].slice(-8),
      outside: [...(world.outside ?? []), outside.text].slice(-8),
      memories,
    },
    notes,
  };
}
