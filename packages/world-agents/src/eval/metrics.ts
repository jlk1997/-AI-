/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Emergence metrics inspired by Generative Agents (Park et al. 2023).
 *
 * These are regression gates, not decoration: every number here corresponds to
 * something a viewer can see in the town. If gossip stops spreading, if everyone
 * walks the same route, or if the evening square stays empty, one of these drops.
 */

import type { MemoryStream } from '../memory.js';
import type { SocietyEvent, SocietyState } from '../tick.js';
import type { LlmTextFn } from '../reflect.js';
import { judgeDialogue, judgeDialogueBatch, llmJudgeDialogue } from '../judge.js';
import { isPaidTraceMemory } from '../copyLocale.js';

export interface EmergenceReportCard {
  readonly informationSpread: {
    readonly seedText: string;
    readonly awareCount: number;
    readonly totalAgents: number;
    readonly rate: number;
    /** Agent ids whose memories mention the seed / a peer retelling. */
    readonly awareIds?: readonly string[];
  };
  readonly relationshipFormation: {
    readonly newRelations: number;
    readonly avgAffinity: number;
  };
  readonly coordination: {
    readonly invitationText: string;
    readonly attendees: number;
    readonly invited: number;
    readonly attendanceRate: number;
    /** Most residents ever co-located in one region during the social window. */
    readonly peakGathering: number;
    /** `peakGathering` as a share of the population. */
    readonly peakGatheringRate: number;
    readonly peakRegionId?: string;
    readonly peakSimTime?: number;
  };
  /** Do residents live different days, or is everyone running one template? */
  readonly scheduleDiversity: {
    readonly distinctRoutes: number;
    readonly agents: number;
    readonly rate: number;
    readonly avgDestinationsPerAgent: number;
  };
  /** Guards against the town repeating one line forever. */
  readonly dialogueNovelty: {
    readonly dialogues: number;
    readonly uniqueLines: number;
    readonly rate: number;
    readonly groupDialogues: number;
  };
  /**
   * The two things a viewer complains about first: conversations happening one
   * at a time, and the town going quiet the longer it runs.
   */
  readonly dialogueSustain: {
    /** Most conversations between disjoint pairs inside one tick window. */
    readonly maxConcurrentTalks: number;
    /** Windows that held more than one conversation. */
    readonly parallelWindows: number;
    /** Width of the compared windows, in sim hours. */
    readonly compareWindowHours: number;
    readonly firstWindowDialogues: number;
    readonly lastWindowDialogues: number;
    /** `lastWindow / firstWindow` — below 1 means the town is winding down. */
    readonly sustainRatio: number;
  };
  /** Heuristic judge: in-character / cites memory / follows last line. */
  readonly dialogueQuality: {
    readonly inCharacter: number;
    readonly citesMemory: number;
    readonly followsLast: number;
    readonly summary: string;
  };
  readonly summary: string;
}

/** Count agents whose memories mention the seed phrase. */
export function measureInformationSpread(
  stream: MemoryStream,
  agentIds: readonly string[],
  seedText: string,
): EmergenceReportCard['informationSpread'] {
  const needle = seedText.toLowerCase().trim().slice(0, 40);
  const total = agentIds.length || 1;
  if (!needle) {
    return {
      seedText,
      awareCount: 0,
      totalAgents: agentIds.length,
      rate: 0,
      awareIds: [],
    };
  }
  const tokens = needle
    .split(/[\s,，。.!？?；;：:\-/]+/)
    .filter((t) => (/[\u4e00-\u9fff]/.test(t) ? t.length >= 2 : t.length > 3))
    .slice(0, 4);
  const awareIds: string[] = [];
  for (const id of agentIds) {
    const hit = stream.list(id).some((m) => {
      const t = m.text.toLowerCase();
      if (t.includes(needle)) return true;
      if (tokens.length && tokens.every((tok) => t.includes(tok))) return true;
      // Rumor diffusion leaves "Heard from peer: ..." / 「听同伴说：」
      const peerHeard =
        t.includes('heard from peer') ||
        t.includes('听同伴说') ||
        t.includes('从同行听说');
      if (peerHeard && tokens.some((tok) => t.includes(tok))) {
        return true;
      }
      return false;
    });
    if (hit) awareIds.push(id);
  }
  const aware = awareIds.length;
  return {
    seedText,
    awareCount: aware,
    totalAgents: agentIds.length,
    rate: aware / total,
    awareIds,
  };
}

export function measureRelationships(
  state: SocietyState,
): EmergenceReportCard['relationshipFormation'] {
  let sum = 0;
  for (const r of state.relations.values()) sum += r.affinity;
  const n = state.relations.size;
  return {
    newRelations: n,
    avgAffinity: n ? sum / n : 0,
  };
}

/** Default evening window (local hours) in which the town should assemble. */
const SOCIAL_WINDOW: readonly [number, number] = [17, 21];

export function measureCoordination(
  events: readonly SocietyEvent[],
  invitationNeedle: string,
  options?: {
    readonly population?: number;
    readonly window?: readonly [number, number];
  },
): EmergenceReportCard['coordination'] {
  const inv = invitationNeedle.toLowerCase();
  let invited = 0;
  let attendees = 0;
  for (const e of events) {
    if (e.kind === 'dialogue') {
      const summary = String(e.payload['summary'] ?? '').toLowerCase();
      if (summary.includes(inv)) invited += 1;
    }
    if (e.kind === 'action') {
      const activity = String(e.payload['activity'] ?? '').toLowerCase();
      if (
        activity.includes('party') ||
        activity.includes('聚会') ||
        activity.includes(inv)
      ) {
        attendees += 1;
      }
    }
  }

  // The honest measure of coordination is bodies in the same place at the same
  // time. Activity-text matching only ever proved the planner used a keyword.
  const [from, to] = options?.window ?? SOCIAL_WINDOW;
  const buckets = new Map<string, Map<string, Set<string>>>();
  for (const e of events) {
    if (e.kind !== 'action' && e.kind !== 'move') continue;
    if (!e.agentId) continue;
    const regionId = e.payload['regionId'];
    if (typeof regionId !== 'string') continue;
    const hour = ((e.simTime % 24) + 24) % 24;
    if (hour < from || hour >= to) continue;
    const slot = `${Math.floor(e.simTime * 2) / 2}`;
    let byRegion = buckets.get(slot);
    if (!byRegion) {
      byRegion = new Map();
      buckets.set(slot, byRegion);
    }
    let set = byRegion.get(regionId);
    if (!set) {
      set = new Set();
      byRegion.set(regionId, set);
    }
    set.add(e.agentId);
  }
  let peakGathering = 0;
  let peakRegionId: string | undefined;
  let peakSimTime: number | undefined;
  for (const [slot, byRegion] of buckets) {
    for (const [regionId, set] of byRegion) {
      if (set.size > peakGathering) {
        peakGathering = set.size;
        peakRegionId = regionId;
        peakSimTime = Number(slot);
      }
    }
  }
  const population = options?.population ?? 0;

  return {
    invitationText: invitationNeedle,
    attendees,
    invited: Math.max(invited, 1),
    attendanceRate: attendees / Math.max(invited, 1),
    peakGathering,
    peakGatheringRate: population > 0 ? peakGathering / population : 0,
    peakRegionId,
    peakSimTime,
  };
}

/**
 * A town where every resident visits the same three tiles is a screensaver.
 * Route = the set of named destinations an agent actually walked to.
 */
export function measureScheduleDiversity(
  events: readonly SocietyEvent[],
  agentIds: readonly string[],
): EmergenceReportCard['scheduleDiversity'] {
  const routes = new Map<string, Set<string>>();
  for (const id of agentIds) routes.set(id, new Set());
  for (const e of events) {
    if (e.kind !== 'action' || !e.agentId) continue;
    const place = e.payload['goalPlace'];
    if (typeof place !== 'string' || !place) continue;
    routes.get(e.agentId)?.add(place);
  }
  const signatures = new Set<string>();
  let destinationTotal = 0;
  for (const set of routes.values()) {
    destinationTotal += set.size;
    if (set.size) signatures.add([...set].sort().join('>'));
  }
  const agents = agentIds.length || 1;
  return {
    distinctRoutes: signatures.size,
    agents: agentIds.length,
    rate: signatures.size / agents,
    avgDestinationsPerAgent: destinationTotal / agents,
  };
}

/** Unique spoken lines over all spoken lines. Repetition is the failure mode. */
export function measureDialogueNovelty(
  events: readonly SocietyEvent[],
): EmergenceReportCard['dialogueNovelty'] {
  const lines = new Set<string>();
  let dialogues = 0;
  let groupDialogues = 0;
  let lineTotal = 0;
  for (const e of events) {
    if (e.kind !== 'dialogue') continue;
    dialogues += 1;
    const participants = e.payload['participants'];
    if (Array.isArray(participants) && participants.length >= 3) {
      groupDialogues += 1;
    }
    const turns = e.payload['turns'];
    if (!Array.isArray(turns)) continue;
    for (const turn of turns) {
      const text = (turn as { text?: unknown }).text;
      if (typeof text !== 'string' || !text.trim()) continue;
      lineTotal += 1;
      lines.add(text.trim().toLowerCase());
    }
  }
  return {
    dialogues,
    uniqueLines: lines.size,
    rate: lineTotal ? lines.size / lineTotal : 0,
    groupDialogues,
  };
}

/**
 * Concurrency and staying power of the town's conversation.
 *
 * A run can score well on novelty while still feeling dead: one pair talks at a
 * time, and the frequency decays as memory and context fill up. Both are gated
 * here so a regression shows up as a number instead of a user complaint.
 */
export function measureDialogueSustain(
  events: readonly SocietyEvent[],
  options: { readonly windowHours?: number } = {},
): EmergenceReportCard['dialogueSustain'] {
  const windowHours = Math.max(0.05, options.windowHours ?? 0.25);
  const spoken = events.filter(
    (e) => e.kind === 'dialogue' && e.payload['skipped'] !== true,
  );
  if (spoken.length === 0) {
    return {
      maxConcurrentTalks: 0,
      parallelWindows: 0,
      compareWindowHours: 0,
      firstWindowDialogues: 0,
      lastWindowDialogues: 0,
      sustainRatio: 0,
    };
  }

  // Conversations in the same tick window count as parallel only when they are
  // between different residents — one pair's two beats are not two talks.
  const windows = new Map<number, Array<Set<string>>>();
  for (const e of spoken) {
    const bucket = Math.floor(e.simTime / windowHours);
    const participants = e.payload['participants'];
    const ids = new Set<string>(
      Array.isArray(participants)
        ? participants.filter((p): p is string => typeof p === 'string')
        : [],
    );
    if (ids.size === 0 && typeof e.agentId === 'string') ids.add(e.agentId);
    const list = windows.get(bucket) ?? [];
    if (!list.some((seen) => [...ids].some((id) => seen.has(id)))) {
      list.push(ids);
    }
    windows.set(bucket, list);
  }
  let maxConcurrentTalks = 0;
  let parallelWindows = 0;
  for (const list of windows.values()) {
    maxConcurrentTalks = Math.max(maxConcurrentTalks, list.length);
    if (list.length > 1) parallelWindows += 1;
  }

  const times = spoken.map((e) => e.simTime);
  const start = Math.min(...times);
  const end = Math.max(...times);
  const span = end - start;
  if (span <= 0) {
    return {
      maxConcurrentTalks,
      parallelWindows,
      compareWindowHours: 0,
      firstWindowDialogues: spoken.length,
      lastWindowDialogues: spoken.length,
      sustainRatio: 1,
    };
  }
  // Whole sim days, not fractions of the run: residents sleep, so a window that
  // happens to land on the night hours would read as decay. Runs too short for
  // two full days fall back to halves, which still straddle a night each.
  const SIM_DAY = 24;
  const compareWindowHours = span >= 2 * SIM_DAY ? SIM_DAY : span / 2;
  const firstWindowDialogues = spoken.filter(
    (e) => e.simTime < start + compareWindowHours,
  ).length;
  const lastWindowDialogues = spoken.filter(
    (e) => e.simTime > end - compareWindowHours,
  ).length;
  const sustainRatio =
    firstWindowDialogues > 0
      ? lastWindowDialogues / firstWindowDialogues
      : lastWindowDialogues > 0
        ? 1
        : 0;
  return {
    maxConcurrentTalks,
    parallelWindows,
    compareWindowHours,
    firstWindowDialogues,
    lastWindowDialogues,
    sustainRatio,
  };
}

export function measureDialogueQuality(
  state: SocietyState,
  events: readonly SocietyEvent[],
): EmergenceReportCard['dialogueQuality'] {
  const scored: Array<ReturnType<typeof judgeDialogue>> = [];
  let prev: string | undefined;
  for (const e of events) {
    if (e.kind !== 'dialogue') continue;
    const turns = e.payload['turns'];
    if (!Array.isArray(turns)) continue;
    for (const turn of turns) {
      const rec = turn as {
        speakerId?: string;
        speakerName?: string;
        text?: string;
        citedMemoryIds?: readonly string[];
      };
      if (typeof rec.text !== 'string' || !rec.text.trim()) continue;
      const agent =
        (rec.speakerId
          ? state.agents.find((a) => a.id === rec.speakerId)
          : undefined) ??
        state.agents.find((a) => a.name === rec.speakerName);
      const memories = agent
        ? state.stream.list(agent.id).map((m) => m.text).slice(-8)
        : [];
      const s = judgeDialogue({
        line: rec.text,
        identity: agent?.identitySummary ?? agent?.name ?? '',
        memories,
        previousLine: prev,
      });
      let citesMemory = s.citesMemory;
      const cited = rec.citedMemoryIds ?? [];
      const citedOk =
        Boolean(agent) &&
        cited.some((id) => Boolean(state.stream.get(agent!.id, id)));
      if (citedOk) citesMemory = Math.max(citesMemory, 0.7);
      if (agent) {
        const freshPaid = state.stream
          .list(agent.id)
          .filter(
            (m) =>
              isPaidTraceMemory(m.text) &&
              e.simTime - m.simTime >= 0 &&
              e.simTime - m.simTime <= 4,
          );
        if (
          freshPaid.length &&
          !cited.some((id) => freshPaid.some((m) => m.id === id))
        ) {
          citesMemory = Math.min(citesMemory, 0.15);
        }
      }
      scored.push({ ...s, citesMemory });
      prev = rec.text;
    }
  }
  if (!scored.length) {
    return judgeDialogueBatch({ lines: [] });
  }
  const n = scored.length;
  const out = {
    inCharacter: scored.reduce((s, x) => s + x.inCharacter, 0) / n,
    citesMemory: scored.reduce((s, x) => s + x.citesMemory, 0) / n,
    followsLast: scored.reduce((s, x) => s + x.followsLast, 0) / n,
    summary: '',
  };
  return {
    ...out,
    summary: `像本人 ${(out.inCharacter * 100).toFixed(0)}% · 引用记忆 ${(out.citesMemory * 100).toFixed(0)}% · 接上一句 ${(out.followsLast * 100).toFixed(0)}%`,
  };
}

export function buildEmergenceReportCard(input: {
  readonly state: SocietyState;
  readonly seedText: string;
  readonly invitationText: string;
  /** Defaults to `state.events`; pass a run's events when they were drained. */
  readonly events?: readonly SocietyEvent[];
}): EmergenceReportCard {
  const agentIds = input.state.agents.map((a) => a.id);
  const events = input.events ?? input.state.events;
  const informationSpread = measureInformationSpread(
    input.state.stream,
    agentIds,
    input.seedText,
  );
  const relationshipFormation = measureRelationships(input.state);
  const coordination = measureCoordination(events, input.invitationText, {
    population: agentIds.length,
  });
  const scheduleDiversity = measureScheduleDiversity(events, agentIds);
  const dialogueNovelty = measureDialogueNovelty(events);
  const dialogueSustain = measureDialogueSustain(events);
  const dialogueQuality = measureDialogueQuality(input.state, events);
  const summary = [
    `信息扩散 ${Math.round(informationSpread.rate * 100)}% (${informationSpread.awareCount}/${informationSpread.totalAgents})`,
    `新关系 ${relationshipFormation.newRelations}（均亲和 ${relationshipFormation.avgAffinity.toFixed(2)}）`,
    `最大聚集 ${coordination.peakGathering} 人（${Math.round(coordination.peakGatheringRate * 100)}%${coordination.peakRegionId ? ` @ ${coordination.peakRegionId}` : ''}）`,
    `日程多样性 ${Math.round(scheduleDiversity.rate * 100)}%`,
    `台词非重复 ${Math.round(dialogueNovelty.rate * 100)}%`,
    `并行对话 ${dialogueSustain.maxConcurrentTalks} 组 · 末段维持 ${Math.round(dialogueSustain.sustainRatio * 100)}%`,
    `对白质量 ${dialogueQuality.summary}`,
  ].join(' · ');
  return {
    informationSpread,
    relationshipFormation,
    coordination,
    scheduleDiversity,
    dialogueNovelty,
    dialogueSustain,
    dialogueQuality,
    summary,
  };
}

/** Last spoken line on the report window — one sample for optional MiniMax judge. */
export function lastDialogueSample(
  state: SocietyState,
  events: readonly SocietyEvent[],
): { readonly line: string; readonly identity: string } | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.kind !== 'dialogue') continue;
    const turns = e.payload['turns'];
    if (!Array.isArray(turns) || !turns.length) continue;
    const last = turns[turns.length - 1] as {
      text?: string;
      speakerId?: string;
      speakerName?: string;
    };
    if (typeof last.text !== 'string' || !last.text.trim()) continue;
    const agent = last.speakerId
      ? state.agents.find((a) => a.id === last.speakerId)
      : state.agents.find((a) => a.name === last.speakerName);
    return {
      line: last.text,
      identity: agent?.identitySummary ?? agent?.name ?? '',
    };
  }
  return undefined;
}

/**
 * Blend one LLM-as-judge score into the heuristic card. CI never requires this;
 * seed / fast-forward / eval with a model use it so "像本人" is not only n-gram overlap.
 */
export async function maybeLlmJudgeReportCard(
  card: EmergenceReportCard,
  input: {
    readonly state: SocietyState;
    readonly events: readonly SocietyEvent[];
    readonly llm?: LlmTextFn;
  },
): Promise<EmergenceReportCard> {
  if (!input.llm) return card;
  const sample = lastDialogueSample(input.state, input.events);
  if (!sample) return card;
  const n = await llmJudgeDialogue({
    llm: input.llm,
    line: sample.line,
    identity: sample.identity,
  });
  if (n === undefined) return card;
  const inCharacter = (card.dialogueQuality.inCharacter + n) / 2;
  const dialogueQuality = {
    ...card.dialogueQuality,
    inCharacter,
    summary: `像本人 ${(inCharacter * 100).toFixed(0)}% · 引用记忆 ${(card.dialogueQuality.citesMemory * 100).toFixed(0)}% · 接上一句 ${(card.dialogueQuality.followsLast * 100).toFixed(0)}%（含模型评判）`,
  };
  return {
    ...card,
    dialogueQuality,
    summary: card.summary.includes('对白质量')
      ? card.summary.replace(/对白质量 .+$/u, `对白质量 ${dialogueQuality.summary}`)
      : `${card.summary} · 对白质量 ${dialogueQuality.summary}`,
  };
}

export interface EmergenceThresholds {
  readonly minSpreadRate: number;
  readonly minRelations: number;
  readonly minPeakGatheringRate: number;
  readonly minScheduleDiversity: number;
  readonly minDialogueNovelty: number;
  /** At least this many conversations must ever run at once. */
  readonly minConcurrentTalks: number;
  /** Last-quarter conversation count as a share of the first quarter's. */
  readonly minSustainRatio: number;
}

/** Conservative floors — a healthy 24h town run clears these comfortably. */
export const DEFAULT_EMERGENCE_THRESHOLDS: EmergenceThresholds = {
  minSpreadRate: 0.7,
  minRelations: 8,
  minPeakGatheringRate: 0.25,
  minScheduleDiversity: 0.5,
  minDialogueNovelty: 0.35,
  minConcurrentTalks: 2,
  minSustainRatio: 0.5,
};

export interface EmergenceGateResult {
  readonly ok: boolean;
  readonly failures: string[];
  readonly card: EmergenceReportCard;
}

/** Turn the report card into a pass/fail gate for CI. */
export function gateEmergenceReportCard(
  card: EmergenceReportCard,
  thresholds: Partial<EmergenceThresholds> = {},
): EmergenceGateResult {
  const t = { ...DEFAULT_EMERGENCE_THRESHOLDS, ...thresholds };
  const failures: string[] = [];
  const check = (
    label: string,
    actual: number,
    floor: number,
    asPercent = true,
  ): void => {
    if (actual >= floor) return;
    const fmt = (n: number): string =>
      asPercent ? `${Math.round(n * 100)}%` : String(n);
    failures.push(`${label}: ${fmt(actual)} < ${fmt(floor)}`);
  };
  check('信息扩散率', card.informationSpread.rate, t.minSpreadRate);
  check(
    '关系形成数',
    card.relationshipFormation.newRelations,
    t.minRelations,
    false,
  );
  check('最大聚集率', card.coordination.peakGatheringRate, t.minPeakGatheringRate);
  check('日程多样性', card.scheduleDiversity.rate, t.minScheduleDiversity);
  check('台词非重复度', card.dialogueNovelty.rate, t.minDialogueNovelty);
  check(
    '并行对话组数',
    card.dialogueSustain.maxConcurrentTalks,
    t.minConcurrentTalks,
    false,
  );
  check('末段对话维持率', card.dialogueSustain.sustainRatio, t.minSustainRatio);
  return { ok: failures.length === 0, failures, card };
}
