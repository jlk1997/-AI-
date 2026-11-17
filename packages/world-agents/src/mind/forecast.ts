/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Many runs, not one story. Deep traces supply tendencies. Fast runs
 * fill out the distribution of violence and casualties.
 */

import {
  applyHarm,
  emptyConflict,
  rungName,
  stepConflict,
  violent,
  type AuthorityResponse,
  type ConflictCell,
} from './conflict.js';
import { seedDeepWorld, type DeepWorld } from './deepWorld.js';
import { rollFate } from './fate.js';
import { chooseResponse, defaultInstitutions } from './institutions.js';
import { rollIncident, rollOutcome } from './outcomes.js';
import { nearestCase } from './calibration.js';
import { percentile, hashSeed, mulberry32 } from './rng.js';
import { stepDeepMind, type DeepEvent } from './stepDeep.js';

export type ExecutionMode =
  | 'negotiate'
  | 'disperse'
  | 'sudden'
  | 'exercise_live'
  | 'exercise_notice';

export type ForecastScenario = {
  readonly id: string;
  readonly title: string;
  readonly decision: string;
  readonly execution: ExecutionMode;
  readonly population: number;
  readonly windowHours: number;
  readonly grievance: number;
  readonly legitimacy: number;
  readonly noticeHours: number;
  readonly liveFire: boolean;
  readonly nearResidents: boolean;
  readonly medical: boolean;
  readonly regionId: string;
  readonly alternatives?: readonly { readonly id: string; readonly title: string; readonly execution: ExecutionMode }[];
};

export type Propensity = {
  readonly escalate: number;
  readonly yield: number;
  readonly defy: number;
};

export type RunOutcome = {
  readonly violent: boolean;
  readonly maxRung: number;
  readonly participants: number;
  readonly light: number;
  readonly serious: number;
  readonly dead: number;
  readonly arrested: number;
  readonly firstViolentHour: number | null;
  readonly chain: readonly string[];
  readonly timeline: readonly number[];
  readonly endGrievance: number;
  readonly endFear: number;
};

export type Band = { readonly p10: number; readonly p50: number; readonly p90: number };

export type ForecastReport = {
  readonly scenarioId: string;
  readonly title: string;
  readonly decision: string;
  readonly violentProbability: number;
  readonly violentLow: number;
  readonly violentHigh: number;
  readonly maxLevel: Readonly<Record<string, number>>;
  readonly participants: Band;
  readonly casualties: { readonly light: Band; readonly serious: Band; readonly dead: Band };
  /** Casualties among the runs that reached throwing or worse. */
  readonly ifViolent: {
    readonly n: number;
    readonly deathShare: number;
    readonly light: Band;
    readonly serious: Band;
    readonly dead: Band;
  } | null;
  readonly firstViolentHour: Band | null;
  readonly chains: readonly { readonly text: string; readonly count: number }[];
  readonly opinion: {
    readonly oppose: number;
    readonly afraid: number;
    readonly wouldShow: number;
    readonly wouldForce: number;
  };
  readonly alternatives: readonly {
    readonly id: string;
    readonly title: string;
    readonly violentProbability: number;
    readonly deathsP50: number;
  }[];
  readonly sensitivity: readonly { readonly variable: string; readonly deltaViolent: number }[];
  readonly calibration: {
    readonly status: 'calibrated' | 'extrapolated';
    readonly note: string;
  };
  readonly assumptions: readonly string[];
  readonly sampleSize: number;
  readonly deepRuns: number;
  readonly hotRegions: readonly { readonly regionId: string; readonly risk: number }[];
  readonly levelTimeline: readonly { readonly t: number; readonly rungP50: number }[];
  readonly traces: readonly { readonly seed: number; readonly chain: readonly string[] }[];
  readonly propensity: Propensity;
  readonly llmCalls: number;
  readonly softened: number;
};

export function contestedDecision(): ForecastScenario {
  return {
    id: 'contested',
    title: '一项没商量的收费',
    decision: '明天开始对进镇的货车加收一笔费用，当天执行',
    execution: 'sudden',
    population: 8000,
    windowHours: 72,
    grievance: 0.64,
    legitimacy: 0.4,
    noticeHours: 0,
    liveFire: false,
    nearResidents: true,
    medical: true,
    regionId: 'town',
    alternatives: [
      { id: 'talk', title: '先开听证会再定', execution: 'negotiate' },
      { id: 'push', title: '直接清场', execution: 'disperse' },
    ],
  };
}

export function exerciseNearHomes(): ForecastScenario {
  return {
    id: 'exercise',
    title: '居民区边上的实弹演训',
    decision: '实弹演训区紧挨居住区，当天通知禁入',
    execution: 'exercise_live',
    population: 5000,
    windowHours: 72,
    grievance: 0.4,
    legitimacy: 0.5,
    noticeHours: 0,
    liveFire: true,
    nearResidents: true,
    medical: true,
    regionId: 'edge',
    alternatives: [
      { id: 'week', title: '提前一周通知并设禁入区', execution: 'exercise_notice' },
    ],
  };
}

export function withExecution(scenario: ForecastScenario, execution: ExecutionMode): ForecastScenario {
  const exercise = execution === 'exercise_live' || execution === 'exercise_notice';
  return {
    ...scenario,
    execution,
    liveFire: exercise ? execution === 'exercise_live' || scenario.liveFire : false,
    noticeHours: execution === 'exercise_notice' || execution === 'negotiate' ? 24 * 7 : scenario.noticeHours,
    grievance: execution === 'negotiate' ? Math.min(scenario.grievance, 0.45) : scenario.grievance,
    legitimacy: execution === 'negotiate' ? Math.max(scenario.legitimacy, 0.55) : scenario.legitimacy,
  };
}

function wilson(k: number, n: number): [number, number] {
  if (n <= 0) return [0, 1];
  const z = 1.645;
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n)) / denom;
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

function band(values: readonly number[]): Band {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p10: percentile(sorted, 0.1),
    p50: percentile(sorted, 0.5),
    p90: percentile(sorted, 0.9),
  };
}

export function propensityFromEvents(events: readonly DeepEvent[]): Propensity {
  let escalate = 1;
  let yieldN = 1;
  let defy = 1;
  for (const event of events) {
    const force = event.payload?.['force'];
    const compliance = event.payload?.['compliance'];
    if (force === 'push' || force === 'throw' || force === 'lethal' || force === 'nonlethal') escalate += 1;
    else if (force === 'flee') yieldN += 1;
    else if (compliance === 'refuse' || compliance === 'conceal') defy += 1;
    else if (event.kind === 'action') yieldN += 1;
  }
  const sum = escalate + yieldN + defy;
  return { escalate: escalate / sum, yield: yieldN / sum, defy: defy / sum };
}

export function mixPropensity(rows: readonly Propensity[]): Propensity {
  if (!rows.length) return { escalate: 0.34, yield: 0.5, defy: 0.16 };
  const escalate = rows.reduce((s, r) => s + r.escalate, 0) / rows.length;
  const yieldN = rows.reduce((s, r) => s + r.yield, 0) / rows.length;
  const defy = rows.reduce((s, r) => s + r.defy, 0) / rows.length;
  const sum = escalate + yieldN + defy || 1;
  return { escalate: escalate / sum, yield: yieldN / sum, defy: defy / sum };
}

function biasResponse(
  response: AuthorityResponse,
  propensity: Propensity,
  rng: () => number,
): AuthorityResponse {
  if (rng() < propensity.defy * 0.35) return 'none';
  if (rng() < propensity.yield * 0.45) return 'dialogue';
  if (rng() < propensity.escalate * 0.4 && response === 'dialogue') return 'disperse';
  return response;
}

function forcedResponse(mode: ExecutionMode, hour: number, pressure: number): AuthorityResponse | null {
  if (mode === 'negotiate') return hour < 36 ? 'dialogue' : null;
  if (mode === 'disperse') return 'disperse';
  if (mode === 'sudden') return hour < 4 ? 'disperse' : null;
  if (pressure < 0) return null;
  return null;
}

export function fastSimulate(
  scenario: ForecastScenario,
  propensity: Propensity,
  seed: number,
  scale = 1,
): RunOutcome {
  const exercise = scenario.execution === 'exercise_live' || scenario.execution === 'exercise_notice';
  let cell: ConflictCell = {
    ...emptyConflict(scenario.regionId, scenario.population),
    grievance: scenario.grievance,
    legitimacy: scenario.legitimacy,
    anger: Math.min(1, scenario.grievance * 0.85),
    efficacy: scenario.execution === 'sudden' ? 0.62 : 0.4,
    visible: scenario.execution === 'sudden' ? 0.06 : 0.02,
    fear: 0.18,
  };
  const police = defaultInstitutions(scenario.regionId).find((i) => i.kind === 'police')!;
  const rng = mulberry32(hashSeed(`${scenario.id}:${seed}`));
  let light = 0;
  let serious = 0;
  let dead = 0;
  let arrested = 0;
  let maxRung = 0;
  let firstViolentHour: number | null = null;
  let lastClashHour = -99;
  let clashEpisode = 0;
  const chain: string[] = [];
  const timeline: number[] = [];
  const notice = scenario.execution === 'exercise_notice' ? Math.max(scenario.noticeHours, 24 * 7) : scenario.noticeHours;
  for (let hour = 1; hour <= scenario.windowHours; hour++) {
    const fate = rollFate({
      simHour: hour,
      economy: 0.45,
      tension: cell.grievance,
      cell,
      rng,
    });
    if (exercise) {
      const pHour = scenario.liveFire && scenario.nearResidents ? (notice >= 24 ? 0.004 : 0.02) : 0.002;
      if (rng() < pHour) {
        const incident = rollIncident(
          notice <= 0 ? 'intrusion' : 'exercise',
          {
            noticeHours: notice,
            near: scenario.nearResidents,
            liveFire: scenario.liveFire,
            simHour: hour,
            place: scenario.regionId,
          },
          rng,
        );
        light += incident.light;
        serious += incident.serious;
        dead += incident.dead;
        arrested += incident.arrested;
        chain.push(incident.report);
      }
      timeline.push(cell.rung);
      continue;
    }
    const pressure = cell.grievance * 0.5 + cell.anger * 0.3 + (1 - cell.legitimacy) * 0.2;
    let response = forcedResponse(scenario.execution, hour, pressure) ?? chooseResponse(police, pressure);
    response = biasResponse(response, propensity, rng);
    const prevRung = cell.rung;
    cell = stepConflict(cell, { response, rumor: fate?.rumor ?? 0, trigger: fate?.kind === 'festival' ? 'payday' : 'none' });
    const clashDue = cell.rung >= 5 && (cell.rung > prevRung || hour - lastClashHour >= 10);
    if (clashDue) {
      lastClashHour = hour;
      clashEpisode += 1;
      const fatigue = Math.max(0.2, 1 - (clashEpisode - 1) * 0.22);
      const kind = cell.rung >= 7 ? 'firearm' : response === 'lethal' ? 'firearm' : response === 'disperse' ? 'irritant' : response === 'arrest' ? 'blunt' : 'thrown';
      const contact = Math.max(20, Math.min(220, Math.round(Math.sqrt(Math.max(cell.mobilized, 1)) * 6 * fatigue)));
      const roll = rollOutcome(
        {
          kind,
          peopleInContact: contact,
          place: scenario.regionId,
          cause: `${rungName(cell.rung)}，当局回应是 ${response}`,
          simHour: hour,
          casualtyScale: scale * (kind === 'firearm' ? 1 : 0.55),
          ctx: {
            density: cell.visible > 0.4 ? 'crowd' : 'sparse',
            minutes: 40,
            medicalAccess: scenario.medical,
            noticeHours: notice,
            weather: 'clear',
          },
        },
        rng,
      );
      cell = applyHarm(cell, { dead: roll.dead, injured: roll.light + roll.serious });
      if (roll.dead > 0) cell = stepConflict(cell, { trigger: 'death', response });
      light += roll.light;
      serious += roll.serious;
      dead += roll.dead;
      arrested += roll.arrested;
      if (firstViolentHour == null) firstViolentHour = hour;
      if (chain.length < 6) chain.push(`${hour}时 ${rungName(cell.rung)}：${roll.report}`);
    } else if (chain.length < 4 && (fate || hour === 1)) {
      chain.push(`${hour}时仍是${rungName(cell.rung)}${fate ? `，${fate.text}` : ''}`);
    }
    if (!exercise && rng() < 0.22) {
      cell = { ...cell, visible: cell.visible * 0.45, anger: Math.max(0, cell.anger - 0.06) };
    }
    maxRung = Math.max(maxRung, cell.rung);
    timeline.push(cell.rung);
  }
  maxRung = Math.max(maxRung, cell.rung);
  return {
    violent: violent(cell) || maxRung >= 5,
    maxRung,
    participants: cell.mobilized,
    light,
    serious,
    dead,
    arrested,
    firstViolentHour,
    chain,
    timeline,
    endGrievance: cell.grievance,
    endFear: cell.fear,
  };
}

function shockForScenario(world: DeepWorld, scenario: ForecastScenario): DeepWorld {
  const cell = world.conflict[0];
  if (!cell) return world;
  const sudden = scenario.execution === 'sudden' || scenario.execution === 'disperse';
  const live = scenario.execution === 'exercise_live';
  return {
    ...world,
    conflict: [
      {
        ...cell,
        grievance: scenario.grievance,
        legitimacy: scenario.legitimacy,
        anger: Math.min(1, scenario.grievance * 0.85),
        visible: sudden ? 0.28 : live ? 0.08 : 0.06,
        rung: sudden ? 2 : 0,
      },
      ...world.conflict.slice(1),
    ],
  };
}

function usefulLine(text: string): boolean {
  return text.length > 8 && !/继续办自己的事/.test(text);
}

function chainKey(chain: readonly string[]): string {
  return chain.filter(usefulLine).slice(0, 3).join(' → ').slice(0, 220);
}

function violentChainKey(chain: readonly string[]): string {
  const hot = chain.filter((line) => /轻伤|重伤|死亡|投掷|骚乱|致死|驱散|冲突/.test(line));
  const picked = (hot.length ? hot : chain.filter(usefulLine)).slice(0, 3);
  return picked.join(' → ').slice(0, 220);
}

function calibrationNote(
  scenario: ForecastScenario,
  forced?: boolean,
): ForecastReport['calibration'] {
  const near = nearestCase({
    grievance: scenario.grievance,
    legitimacy: scenario.legitimacy,
    liveFire: scenario.liveFire,
    noticeHours: scenario.noticeHours,
  });
  const close = Boolean(forced) || !near.extrapolated;
  const distance = near.distance.toFixed(2);
  return {
    status: close ? 'calibrated' : 'extrapolated',
    note: close
      ? `最近的结构先验是「${near.row.title}」，距离 ${distance}。`
      : `最近的结构先验是「${near.row.title}」，距离 ${distance}，不够近，这是外推。`,
  };
}

export async function runEnsemble(
  scenario: ForecastScenario,
  opts?: {
    readonly seed?: number;
    readonly deepRuns?: number;
    readonly fastRuns?: number;
    readonly llm?: (prompt: string) => Promise<string>;
    readonly llmBudget?: number;
    readonly casualtyScale?: number;
    readonly calibrated?: boolean;
  },
): Promise<ForecastReport> {
  const seed = opts?.seed ?? 1;
  const deepN = Math.max(0, opts?.deepRuns ?? 1);
  const fastN = Math.max(20, opts?.fastRuns ?? 80);
  const scale = opts?.casualtyScale ?? 1;
  let llmCalls = 0;
  let softened = 0;
  const traces: { seed: number; chain: string[] }[] = [];
  const props: Propensity[] = [];
  let budget = opts?.llmBudget ?? 0;
  for (let i = 0; i < deepN; i++) {
    let world = shockForScenario(
      seedDeepWorld({
        seed: seed + i,
        population: scenario.population,
        regionId: scenario.regionId,
        core: 12,
        grievance: scenario.grievance,
        legitimacy: scenario.legitimacy,
        liveFire: scenario.liveFire,
        noticeHours: scenario.noticeHours,
      }),
      scenario,
    );
    const events: DeepEvent[] = [];
    const hours = Math.min(scenario.windowHours, 12);
    for (let h = 0; h < hours; h++) {
      const useLlm = Boolean(opts?.llm) && budget > 0 && h % 12 === 0;
      const stepped = await stepDeepMind(world, {
        dtHours: 1,
        maxLlmCalls: useLlm ? 1 : 0,
        ...(useLlm && opts?.llm ? { llm: opts.llm } : {}),
      });
      if (useLlm) budget -= stepped.llmCalls;
      llmCalls += stepped.llmCalls;
      softened += stepped.softened;
      world = stepped.world;
      events.push(...stepped.events);
    }
    const chain = events
      .filter((e) => e.kind === 'casualty' || e.kind === 'order' || e.kind === 'chronicle' || e.kind === 'conflict')
      .map((e) => e.text)
      .filter(usefulLine)
      .slice(0, 8);
    traces.push({ seed: seed + i, chain });
    props.push(propensityFromEvents(events));
  }
  const propensity = mixPropensity(props);
  const runs: RunOutcome[] = [];
  for (let i = 0; i < fastN; i++) runs.push(fastSimulate(scenario, propensity, seed + 1000 + i, scale));
  const violentN = runs.filter((r) => r.violent).length;
  const [violentLow, violentHigh] = wilson(violentN, runs.length);
  const levels: Record<string, number> = {};
  for (const run of runs) {
    const name = rungName(run.maxRung);
    levels[name] = (levels[name] ?? 0) + 1;
  }
  const counts = new Map<string, number>();
  for (const run of runs) {
    const key = chainKey(run.chain);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const trace of traces) {
    const key = chainKey(trace.chain);
    if (key) counts.set(key, (counts.get(key) ?? 0) + 2);
  }
  const violentCounts = new Map<string, number>();
  for (const run of runs) {
    if (!run.violent) continue;
    const key = violentChainKey(run.chain);
    if (!key) continue;
    violentCounts.set(key, (violentCounts.get(key) ?? 0) + 1);
  }
  const violentTop = [...violentCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  const chains = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([text, count]) => ({ text, count }));
  if (violentTop && !chains.some((row) => row.text === violentTop[0])) {
    chains.push({ text: `闹起来时：${violentTop[0]}`, count: violentTop[1] });
  }
  const violentRuns = runs.filter((run) => run.violent);
  const ifViolent = violentRuns.length
    ? {
        n: violentRuns.length,
        deathShare: violentRuns.filter((run) => run.dead > 0).length / violentRuns.length,
        light: band(violentRuns.map((run) => run.light)),
        serious: band(violentRuns.map((run) => run.serious)),
        dead: band(violentRuns.map((run) => run.dead)),
      }
    : null;
  const opinion = {
    oppose: runs.filter((run) => run.endGrievance > 0.55).length / runs.length,
    afraid: runs.filter((run) => run.endFear > 0.55).length / runs.length,
    wouldShow: runs.filter((run) => run.maxRung >= 2 || run.participants >= 40).length / runs.length,
    wouldForce: runs.filter((run) => run.violent).length / runs.length,
  };
  const firsts = runs.map((r) => r.firstViolentHour).filter((n): n is number => n != null);
  const timelineLen = runs[0]?.timeline.length ?? 0;
  const levelTimeline: { t: number; rungP50: number }[] = [];
  const step = Math.max(1, Math.floor(timelineLen / 12));
  for (let t = step; t <= timelineLen; t += step) {
    levelTimeline.push({
      t,
      rungP50: band(runs.map((r) => r.timeline[t - 1] ?? 0)).p50,
    });
  }
  const altRuns = [];
  for (const alt of scenario.alternatives ?? []) {
    const altScenario = withExecution(scenario, alt.execution);
    const sample: RunOutcome[] = [];
    for (let i = 0; i < Math.min(80, fastN); i++) {
      sample.push(fastSimulate(altScenario, propensity, seed + 5000 + i, scale));
    }
    altRuns.push({
      id: alt.id,
      title: alt.title,
      violentProbability: sample.filter((r) => r.violent).length / sample.length,
      deathsP50: band(sample.map((r) => r.dead)).p50,
    });
  }
  const baseP = violentN / runs.length;
  const hi = fastSimulateMany(withExecution(scenario, scenario.execution), propensity, seed, scale, 40, scenario.grievance + 0.1);
  const sensitivity = [
    { variable: '怨气 +0.1', deltaViolent: hi - baseP },
    {
      variable: '提前通知',
      deltaViolent:
        fastSimulateMany(withExecution(scenario, 'exercise_notice'), propensity, seed, scale, 40) - baseP,
    },
  ];
  return {
    scenarioId: scenario.id,
    title: scenario.title,
    decision: scenario.decision,
    violentProbability: baseP,
    violentLow,
    violentHigh,
    maxLevel: levels,
    participants: band(runs.map((r) => r.participants)),
    casualties: {
      light: band(runs.map((r) => r.light)),
      serious: band(runs.map((r) => r.serious)),
      dead: band(runs.map((r) => r.dead)),
    },
    ifViolent,
    firstViolentHour: firsts.length ? band(firsts) : null,
    chains,
    opinion,
    alternatives: altRuns,
    sensitivity,
    calibration: calibrationNote(scenario, opts?.calibrated),
    assumptions: [
      `人群 ${scenario.population} 人，核心居民抽样 12 人，换算有抽样误差。`,
      '伤亡来自接触规模和基准概率，不是单一剧本。',
      '命令可以被拖延、加码或拒绝。',
    ],
    sampleSize: runs.length,
    deepRuns: deepN,
    hotRegions: [{ regionId: scenario.regionId, risk: baseP }],
    levelTimeline,
    traces: traces.slice(0, 8),
    propensity,
    llmCalls,
    softened,
  };
}

function fastSimulateMany(
  scenario: ForecastScenario,
  propensity: Propensity,
  seed: number,
  scale: number,
  n: number,
  grievance?: number,
): number {
  const use = grievance == null ? scenario : { ...scenario, grievance };
  let k = 0;
  for (let i = 0; i < n; i++) {
    if (fastSimulate(use, propensity, seed + 9000 + i, scale).violent) k += 1;
  }
  return k / n;
}

export async function replaySimulatedWeek(seed = 3): Promise<{
  readonly hours: number;
  readonly actions: number;
  readonly distinct: number;
  readonly chronicle: number;
  readonly deaths: number;
}> {
  return replayHours(seed, 24 * 7);
}

export async function replayHours(seed: number, hours: number): Promise<{
  readonly hours: number;
  readonly actions: number;
  readonly distinct: number;
  readonly chronicle: number;
  readonly deaths: number;
}> {
  let world = seedDeepWorld({ seed, core: 12, grievance: 0.55 });
  const texts = new Set<string>();
  let actions = 0;
  for (let i = 0; i < hours; i++) {
    const stepped = await stepDeepMind(world, { dtHours: 1, maxLlmCalls: 0 });
    world = stepped.world;
    for (const event of stepped.events) {
      if (event.kind === 'action') {
        actions += 1;
        texts.add(event.text.slice(0, 24));
      }
    }
  }
  return {
    hours,
    actions,
    distinct: texts.size,
    chronicle: world.chronicle.length,
    deaths: world.conflict[0]?.deaths ?? 0,
  };
}
