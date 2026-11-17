/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Opinion, crowd, policy, and story state for a living town.
 * The crowd layer never calls a model. Core residents stay the only LLM voices.
 */

export const COLLECTIVE_THRESHOLD = 4;
export const APPRAISAL_BATCH = 8;
const LINE_MEMORY = 30;
const BELIEF_CHARS = 200;
const TOPIC_CHARS = 400;
const HISTORY_CAP = 80;

export type PolicyChannel = 'notice' | 'broadcast' | 'word';

export type PolicyEffects = {
  readonly objectId?: string;
  readonly objectState?: string;
  readonly regionId?: string;
  readonly urgentActivity?: string;
  /** Multiply affected residents' hunger so a price shock is felt. */
  readonly needMul?: number;
};

export type PolicyRecord = {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly tags: readonly string[];
  readonly channel: PolicyChannel;
  readonly at: number;
  readonly pending: boolean;
  readonly appraisedIds: readonly string[];
  readonly effectsApplied?: boolean;
  readonly effects?: PolicyEffects;
};

export type OpinionRow = {
  readonly agentId: string;
  readonly topicId: string;
  readonly stance: number;
  readonly confidence: number;
  readonly reason: string;
  readonly emotion?: string;
  readonly action?: string;
  readonly updatedAt: number;
};

export type CrowdCohort = {
  readonly id: string;
  readonly label: string;
  readonly regionId: string;
  readonly occupation: string;
  readonly size: number;
  /** Bins for stance -2, -1, 0, +1, +2. */
  readonly hist: readonly [number, number, number, number, number];
};

export type Commitment = {
  readonly agentId: string;
  readonly regionId: string;
  readonly action: string;
  readonly topicId: string;
  readonly at: number;
  readonly planted?: boolean;
};

export type StoryArc = {
  readonly id: string;
  readonly phase: 'setup' | 'rise' | 'close';
  readonly beat: string;
  readonly at: number;
};

export type OpinionTick = {
  readonly t: number;
  readonly support: number;
  readonly oppose: number;
  readonly neutral: number;
  readonly crowdSupport: number;
  readonly crowdOppose: number;
};

export type CrowdDot = {
  readonly regionId: string;
  readonly x: number;
  readonly y: number;
  readonly stance: number;
};

export type TalkOutcomes = {
  readonly stanceShift?: ReadonlyArray<{
    readonly speaker: string;
    readonly delta: number;
    readonly reason?: string;
  }>;
  readonly commitments?: ReadonlyArray<{
    readonly speaker: string;
    readonly action: string;
  }>;
  readonly newFacts?: readonly string[];
};

export type SocietyMind = {
  readonly policies: readonly PolicyRecord[];
  readonly opinions: readonly OpinionRow[];
  readonly crowd: readonly CrowdCohort[];
  readonly commitments: readonly Commitment[];
  readonly arcs: readonly StoryArc[];
  readonly beliefCards: Readonly<Record<string, string>>;
  readonly fingerprints: Readonly<Record<string, readonly string[]>>;
  readonly recentTopics: readonly string[];
  readonly topicSummaries: Readonly<Record<string, string>>;
  readonly history: readonly OpinionTick[];
  readonly collective?: { readonly action: string; readonly regionId: string; readonly count: number };
  /** One line the town should say once, then drop. */
  readonly spotlight?: { readonly text: string; readonly at: number };
};

export type MindAgent = {
  readonly id: string;
  readonly name: string;
  readonly occupation?: string;
  readonly regionId?: string;
  readonly stance?: string;
};

export function emptyMind(): SocietyMind {
  return {
    policies: [],
    opinions: [],
    crowd: [],
    commitments: [],
    arcs: [],
    beliefCards: {},
    fingerprints: {},
    recentTopics: [],
    topicSummaries: {},
    history: [],
  };
}

export function clampStance(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(-2, Math.min(2, Math.round(n)));
}

export function utteranceFingerprint(text: string): string {
  const norm = text.replace(/\s+/g, '').slice(0, 48);
  let h = 2166136261;
  for (let i = 0; i < norm.length; i++) {
    h ^= norm.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

export function topicIsStale(
  recentTopics: readonly string[],
  topic: string,
): boolean {
  const fp = utteranceFingerprint(topic.trim());
  if (!fp || fp === utteranceFingerprint('')) return false;
  return recentTopics.some((t) => utteranceFingerprint(t) === fp);
}

/** A gathering hardens the stances of the people who showed up. */
export function feedbackCollective(
  mind: SocietyMind,
  regionAgentIds: readonly string[],
  at: number,
): SocietyMind {
  if (!mind.collective || !regionAgentIds.length) return mind;
  const ids = new Set(regionAgentIds);
  const opinions = mind.opinions.map((row) => {
    if (!ids.has(row.agentId)) return row;
    const lean = row.stance === 0 ? -1 : Math.sign(row.stance);
    return {
      ...row,
      stance: clampStance(row.stance + lean),
      confidence: Math.min(1, row.confidence + 0.1),
      updatedAt: at,
    };
  });
  return openSpotlight(
    { ...mind, opinions },
    `大家为了${mind.collective.action}聚到一起`,
    at,
  );
}

export function openSpotlight(mind: SocietyMind, text: string, at: number): SocietyMind {
  const line = text.trim().slice(0, 72);
  if (!line || mind.spotlight?.text === line) return mind;
  return { ...mind, spotlight: { text: line, at } };
}

export function consumeSpotlight(mind: SocietyMind, spoken: string): SocietyMind {
  if (!mind.spotlight) return mind;
  if (utteranceFingerprint(mind.spotlight.text) !== utteranceFingerprint(spoken)) return mind;
  return noteTopic({ ...mind, spotlight: undefined }, spoken);
}

export function noteTopic(mind: SocietyMind, topic: string): SocietyMind {
  const text = topic.trim().slice(0, 72);
  if (!text) return mind;
  if (topicIsStale(mind.recentTopics, text)) return mind;
  return {
    ...mind,
    recentTopics: [...mind.recentTopics, text].slice(-24),
  };
}

export function noteUtterance(
  mind: SocietyMind,
  agentId: string,
  text: string,
): { mind: SocietyMind; novel: boolean } {
  const fp = utteranceFingerprint(text);
  const prev = mind.fingerprints[agentId] ?? [];
  if (prev.includes(fp)) return { mind, novel: false };
  return {
    novel: true,
    mind: {
      ...mind,
      fingerprints: {
        ...mind.fingerprints,
        [agentId]: [...prev, fp].slice(-LINE_MEMORY),
      },
    },
  };
}

export function trimBelief(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length <= BELIEF_CHARS ? t : t.slice(0, BELIEF_CHARS);
}

export function rollTopicSummary(prev: string, next: string): string {
  const joined = [prev, next].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  return joined.length <= TOPIC_CHARS ? joined : joined.slice(joined.length - TOPIC_CHARS);
}

export function rewriteBeliefCard(prev: string, reflection: string): string {
  const next = reflection.trim();
  if (!next) return trimBelief(prev);
  return trimBelief(next);
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) >>> 0;
  return h;
}

function meanHist(hist: readonly number[]): number {
  const w = hist.reduce((a, b) => a + b, 0) || 1;
  let s = 0;
  for (let i = 0; i < hist.length; i++) s += hist[i]! * (i - 2);
  return s / w;
}

function shiftHist(
  hist: readonly [number, number, number, number, number],
  toward: number,
): [number, number, number, number, number] {
  const next = [...hist] as [number, number, number, number, number];
  const mean = meanHist(next);
  if (Math.abs(toward - mean) > 1.15) return next;
  const dir = toward > mean ? 1 : toward < mean ? -1 : 0;
  if (!dir) return next;
  const from = dir > 0 ? 0 : 4;
  const to = dir > 0 ? 4 : 0;
  for (let i = from; dir > 0 ? i < to : i > to; i += dir) {
    const move = next[i]! * 0.08;
    next[i] -= move;
    next[i + dir] = (next[i + dir] ?? 0) + move;
  }
  return next;
}

export function deriveCrowd(
  agents: readonly MindAgent[],
  target = 1500,
): CrowdCohort[] {
  const groups = new Map<string, MindAgent[]>();
  for (const a of agents) {
    const region = a.regionId || 'town';
    const job = (a.occupation || '居民').slice(0, 12);
    const key = `${region}|${job}`;
    const list = groups.get(key) ?? [];
    list.push(a);
    groups.set(key, list);
  }
  const keys = [...groups.keys()].slice(0, 20);
  if (!keys.length) return [];
  const each = Math.max(8, Math.round(target / keys.length));
  return keys.map((key) => {
    const [regionId, occupation] = key.split('|');
    const members = groups.get(key) ?? [];
    const lean = members.reduce((s, a) => {
      const text = a.stance ?? '';
      if (/反|反对|不满|怒/.test(text)) return s - 1;
      if (/支持|赞成|好/.test(text)) return s + 1;
      return s;
    }, 0);
    const center = lean < 0 ? 1 : lean > 0 ? 3 : 2;
    const hist: [number, number, number, number, number] = [8, 18, 48, 18, 8];
    hist[center] += 12;
    return {
      id: key,
      label: `${occupation}·${regionId}`,
      regionId: regionId || 'town',
      occupation: occupation || '居民',
      size: each,
      hist,
    };
  });
}

export type CrowdLeader = {
  readonly agentId: string;
  readonly regionId: string;
  readonly stance: number;
};

export function stepCrowd(
  mind: SocietyMind,
  leaders: readonly CrowdLeader[],
  simTime: number,
): SocietyMind {
  const byRegion = new Map<string, number[]>();
  for (const l of leaders) {
    const list = byRegion.get(l.regionId) ?? [];
    list.push(l.stance);
    byRegion.set(l.regionId, list);
  }
  const crowd = mind.crowd.map((c) => {
    const leans = byRegion.get(c.regionId);
    if (!leans?.length) return c;
    const toward = leans.reduce((a, b) => a + b, 0) / leans.length;
    return { ...c, hist: shiftHist(c.hist, toward) };
  });
  const opinions = mind.opinions.map((row) => {
    const leader = leaders.find((l) => l.agentId === row.agentId);
    if (!leader) return row;
    const home = crowd.find((c) => c.regionId === leader.regionId);
    if (!home) return row;
    const pulled = row.stance + (meanHist(home.hist) - row.stance) * 0.15;
    return { ...row, stance: Math.max(-2, Math.min(2, pulled)) };
  });
  const tick = historyTick(simTime, opinions, crowd);
  return {
    ...mind,
    crowd,
    opinions,
    history: [...mind.history, tick].slice(-HISTORY_CAP),
  };
}

function historyTick(
  simTime: number,
  rows: readonly OpinionRow[],
  crowd: readonly CrowdCohort[],
): OpinionTick {
  const n = rows.length || 1;
  const support = rows.filter((r) => r.stance >= 1).length / n;
  const oppose = rows.filter((r) => r.stance <= -1).length / n;
  const neutral = rows.filter((r) => r.stance > -1 && r.stance < 1).length / n;
  let mass = 0;
  let sup = 0;
  let opp = 0;
  for (const c of crowd) {
    const w = c.hist.reduce((a, b) => a + b, 0) || 1;
    mass += c.size;
    sup += c.size * ((c.hist[3]! + c.hist[4]!) / w);
    opp += c.size * ((c.hist[0]! + c.hist[1]!) / w);
  }
  const denom = mass || 1;
  return {
    t: simTime,
    support,
    oppose,
    neutral,
    crowdSupport: sup / denom,
    crowdOppose: opp / denom,
  };
}

export function publishPolicy(
  mind: SocietyMind,
  input: {
    readonly id: string;
    readonly title: string;
    readonly body: string;
    readonly tags?: readonly string[];
    readonly channel?: PolicyChannel;
    readonly at: number;
    readonly effects?: PolicyEffects;
  },
): SocietyMind {
  const policy: PolicyRecord = {
    id: input.id,
    title: input.title.slice(0, 80),
    body: input.body.slice(0, 400),
    tags: (input.tags ?? []).slice(0, 8),
    channel: input.channel ?? 'notice',
    at: input.at,
    pending: true,
    appraisedIds: [],
    effectsApplied: false,
    ...(input.effects ? { effects: input.effects } : {}),
  };
  return {
    ...mind,
    policies: [...mind.policies, policy].slice(-40),
    recentTopics: [...mind.recentTopics, policy.title].slice(-24),
    topicSummaries: {
      ...mind.topicSummaries,
      [policy.id]: rollTopicSummary(mind.topicSummaries[policy.id] ?? '', policy.body),
    },
  };
}

export function nextAppraisalBatch(
  mind: SocietyMind,
  agents: readonly MindAgent[],
  policyId: string,
): MindAgent[] {
  const policy = mind.policies.find((p) => p.id === policyId);
  if (!policy?.pending) return [];
  const done = new Set(policy.appraisedIds);
  const tags = policy.tags.map((t) => t.trim()).filter(Boolean);
  const pool = agents.filter((a) => {
    if (done.has(a.id)) return false;
    if (!tags.length) return true;
    const hay = `${a.occupation ?? ''} ${a.regionId ?? ''} ${a.name}`;
    return tags.some((t) => hay.includes(t));
  });
  return pool.slice(0, APPRAISAL_BATCH);
}

export function appraisalPrompt(
  policy: Pick<PolicyRecord, 'title' | 'body'>,
  people: readonly MindAgent[],
): string {
  const roster = people
    .map(
      (p, i) =>
        `${i + 1}. id=${p.id} 名字=${p.name} 职业=${p.occupation ?? '居民'} 原立场=${p.stance ?? '未表态'}`,
    )
    .join('\n');
  return `你是小镇居民的集体反应。政策：「${policy.title}」。正文：${policy.body}
对下面每个人给出立场。只返回 JSON：
{"rows":[{"id":"...","stance":-2到2的整数,"emotion":"短词","reason":"不超过24字","action":"打算做的事"}]}
${roster}`;
}

export type AppraisalRow = {
  readonly id: string;
  readonly stance: number;
  readonly emotion: string;
  readonly reason: string;
  readonly action: string;
};

export function parseAppraisal(raw: string): AppraisalRow[] | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as {
      rows?: unknown;
    };
    if (!Array.isArray(parsed.rows)) return null;
    const rows: AppraisalRow[] = [];
    for (const row of parsed.rows) {
      if (!row || typeof row !== 'object') continue;
      const rec = row as Record<string, unknown>;
      if (typeof rec.id !== 'string') continue;
      rows.push({
        id: rec.id,
        stance: clampStance(Number(rec.stance)),
        emotion: String(rec.emotion ?? '').slice(0, 12),
        reason: String(rec.reason ?? '').slice(0, 48),
        action: String(rec.action ?? '').slice(0, 32),
      });
    }
    return rows.length ? rows : null;
  } catch {
    return null;
  }
}

export function applyAppraisal(
  mind: SocietyMind,
  policyId: string,
  rows: readonly AppraisalRow[],
  at: number,
): SocietyMind {
  const opinions = [...mind.opinions];
  for (const row of rows) {
    const next: OpinionRow = {
      agentId: row.id,
      topicId: policyId,
      stance: row.stance,
      confidence: 0.7,
      reason: row.reason,
      emotion: row.emotion,
      action: row.action,
      updatedAt: at,
    };
    const idx = opinions.findIndex(
      (o) => o.agentId === row.id && o.topicId === policyId,
    );
    if (idx >= 0) opinions[idx] = next;
    else opinions.push(next);
  }
  const policies = mind.policies.map((p) => {
    if (p.id !== policyId) return p;
    const appraisedIds = [...new Set([...p.appraisedIds, ...rows.map((r) => r.id)])];
    return { ...p, appraisedIds, pending: true };
  });
  return { ...mind, opinions, policies };
}

export function markPolicyEffectsApplied(
  mind: SocietyMind,
  policyId: string,
): SocietyMind {
  return {
    ...mind,
    policies: mind.policies.map((p) =>
      p.id === policyId ? { ...p, effectsApplied: true } : p,
    ),
  };
}

export function markPolicyAppraised(
  mind: SocietyMind,
  policyId: string,
  agentCount: number,
): SocietyMind {
  return {
    ...mind,
    policies: mind.policies.map((p) =>
      p.id === policyId && p.appraisedIds.length >= agentCount
        ? { ...p, pending: false }
        : p,
    ),
  };
}

export function parseTalkOutcomes(raw: string): TalkOutcomes | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as {
      outcomes?: unknown;
    };
    if (!parsed.outcomes || typeof parsed.outcomes !== 'object') return null;
    const o = parsed.outcomes as Record<string, unknown>;
    const stanceShift = Array.isArray(o.stanceShift)
      ? o.stanceShift
          .map((row) => {
            if (!row || typeof row !== 'object') return null;
            const rec = row as Record<string, unknown>;
            if (typeof rec.speaker !== 'string') return null;
            return {
              speaker: rec.speaker,
              delta: clampStance(Number(rec.delta)),
              ...(typeof rec.reason === 'string' ? { reason: rec.reason.slice(0, 48) } : {}),
            };
          })
          .filter((x): x is NonNullable<typeof x> => Boolean(x))
      : [];
    const commitments = Array.isArray(o.commitments)
      ? o.commitments
          .map((row) => {
            if (!row || typeof row !== 'object') return null;
            const rec = row as Record<string, unknown>;
            if (typeof rec.speaker !== 'string' || typeof rec.action !== 'string') return null;
            return { speaker: rec.speaker, action: rec.action.slice(0, 32) };
          })
          .filter((x): x is NonNullable<typeof x> => Boolean(x))
      : [];
    const newFacts = Array.isArray(o.newFacts)
      ? o.newFacts.filter((x): x is string => typeof x === 'string').map((s) => s.slice(0, 80))
      : [];
    if (!stanceShift.length && !commitments.length && !newFacts.length) return null;
    return { stanceShift, commitments, newFacts };
  } catch {
    return null;
  }
}

export function applyTalkOutcomes(
  mind: SocietyMind,
  input: {
    readonly outcomes: TalkOutcomes;
    readonly people: readonly MindAgent[];
    readonly topicId: string;
    readonly at: number;
  },
): SocietyMind {
  let next = mind;
  const topicId = input.topicId || next.policies.at(-1)?.id || 'talk';
  for (const shift of input.outcomes.stanceShift ?? []) {
    const person =
      input.people.find((p) => p.name === shift.speaker || p.id === shift.speaker) ??
      input.people[shift.speaker.charCodeAt(0) - 65];
    if (!person) continue;
    const prev = next.opinions.find(
      (o) => o.agentId === person.id && o.topicId === topicId,
    );
    const stance = clampStance((prev?.stance ?? 0) + shift.delta);
    const row: OpinionRow = {
      agentId: person.id,
      topicId,
      stance,
      confidence: Math.min(1, (prev?.confidence ?? 0.4) + 0.1),
      reason: shift.reason || prev?.reason || '',
      updatedAt: input.at,
    };
    const opinions = next.opinions.filter(
      (o) => !(o.agentId === person.id && o.topicId === topicId),
    );
    next = { ...next, opinions: [...opinions, row] };
  }
  const commitments = [...next.commitments];
  for (const c of input.outcomes.commitments ?? []) {
    const person = input.people.find((p) => p.name === c.speaker || p.id === c.speaker);
    if (!person) continue;
    commitments.push({
      agentId: person.id,
      regionId: person.regionId || 'town',
      action: c.action,
      topicId,
      at: input.at,
    });
  }
  for (const fact of input.outcomes.newFacts ?? []) {
    next = {
      ...next,
      topicSummaries: {
        ...next.topicSummaries,
        [topicId]: rollTopicSummary(next.topicSummaries[topicId] ?? '', fact),
      },
    };
  }
  next = { ...next, commitments: commitments.slice(-200) };
  const grouped = new Map<string, number>();
  for (const c of next.commitments) {
    const key = `${c.regionId}|${c.action}`;
    grouped.set(key, (grouped.get(key) ?? 0) + 1);
  }
  let collective = next.collective;
  for (const [key, count] of grouped) {
    if (count < COLLECTIVE_THRESHOLD) continue;
    const [regionId, action] = key.split('|');
    collective = { regionId: regionId || 'town', action: action || '聚集', count };
  }
  return collective ? { ...next, collective } : next;
}

export function directorBeat(
  mind: SocietyMind,
  input: {
    readonly at: number;
    readonly lowAffinityPairs: number;
    readonly stanceClash: boolean;
    readonly openCommitments: number;
  },
): SocietyMind {
  const tension =
    input.lowAffinityPairs > 0 || input.stanceClash || input.openCommitments > 0;
  const last = mind.arcs.at(-1);
  if (!tension && last?.phase === 'close') return mind;
  let phase: StoryArc['phase'] = 'setup';
  let beat = '有人开始留意同一件事';
  if (last?.phase === 'setup' && (input.stanceClash || input.openCommitments >= 2)) {
    phase = 'rise';
    beat = '分歧摆到了明面上';
  } else if (last?.phase === 'rise' && input.openCommitments >= COLLECTIVE_THRESHOLD) {
    phase = 'rise';
    beat = '有人约好一起行动';
  } else if (last?.phase === 'rise' && !input.stanceClash && input.openCommitments === 0) {
    phase = 'close';
    beat = '这阵风波暂时过去了';
  } else if (last && last.phase !== 'close' && last.at === input.at) {
    return mind;
  } else if (!tension) {
    return mind;
  }
  if (last && last.phase === phase && last.beat === beat) return mind;
  const arc: StoryArc = {
    id: `arc_${input.at}_${mind.arcs.length}`,
    phase,
    beat,
    at: input.at,
  };
  return { ...mind, arcs: [...mind.arcs, arc].slice(-24) };
}

export type ForecastBand = {
  readonly t: number;
  readonly supportLo: number;
  readonly supportHi: number;
  readonly opposeLo: number;
  readonly opposeHi: number;
};

/** Nudge one district's crowd before a what-if forecast. */
export function shockRegion(
  mind: SocietyMind,
  regionId: string,
  delta: number,
): SocietyMind {
  if (!Number.isFinite(delta) || delta === 0) return mind;
  return {
    ...mind,
    crowd: mind.crowd.map((c) => {
      if (regionId && c.regionId !== regionId) return c;
      return { ...c, hist: shiftHist(c.hist, meanHist(c.hist) + delta) };
    }),
  };
}

export function forecastScenarios(
  mind: SocietyMind,
  scenarios: ReadonlyArray<{ readonly id: string; readonly regionId?: string; readonly delta: number }>,
  hours: number,
  runs = 50,
  seed = 1,
): {
  readonly baseline: readonly ForecastBand[];
  readonly scenarios: ReadonlyArray<{ readonly id: string; readonly bands: readonly ForecastBand[] }>;
} {
  const baseline = forecastCrowd(mind, hours, runs, seed).bands;
  return {
    baseline,
    scenarios: scenarios.map((scenario, index) => ({
      id: scenario.id,
      bands: forecastCrowd(
        shockRegion(mind, scenario.regionId ?? '', scenario.delta),
        hours,
        runs,
        seed + index + 1,
      ).bands,
    })),
  };
}

export function forecastCrowd(
  mind: SocietyMind,
  hours: number,
  runs = 50,
  seed = 1,
): { readonly bands: readonly ForecastBand[] } {
  const steps = Math.max(1, Math.min(48, Math.floor(hours)));
  const samples: number[][] = Array.from({ length: steps }, () => []);
  const opposeSamples: number[][] = Array.from({ length: steps }, () => []);
  for (let r = 0; r < runs; r++) {
    let crowd = mind.crowd.map((c) => ({ ...c, hist: [...c.hist] as CrowdCohort['hist'] }));
    for (let h = 0; h < steps; h++) {
      const noise = ((hashStr(`${seed}:${r}:${h}`) % 100) / 100) * 2 - 1;
      crowd = crowd.map((c) => ({
        ...c,
        hist: shiftHist(c.hist, meanHist(c.hist) + noise * 0.4),
      }));
      const tick = historyTick(h + 1, mind.opinions, crowd);
      samples[h]!.push(tick.crowdSupport);
      opposeSamples[h]!.push(tick.crowdOppose);
    }
  }
  const bands: ForecastBand[] = [];
  for (let h = 0; h < steps; h++) {
    const sup = [...samples[h]!].sort((a, b) => a - b);
    const opp = [...opposeSamples[h]!].sort((a, b) => a - b);
    const lo = (arr: number[]) => arr[Math.floor(arr.length * 0.1)] ?? 0;
    const hi = (arr: number[]) => arr[Math.floor(arr.length * 0.9)] ?? 0;
    bands.push({
      t: h + 1,
      supportLo: lo(sup),
      supportHi: hi(sup),
      opposeLo: lo(opp),
      opposeHi: hi(opp),
    });
  }
  return { bands };
}

export type OpinionBoard = {
  readonly policies: readonly PolicyRecord[];
  readonly history: readonly OpinionTick[];
  readonly leaders: ReadonlyArray<{
    readonly agentId: string;
    readonly stance: number;
    readonly reason: string;
  }>;
  readonly reasons: ReadonlyArray<{ readonly text: string; readonly count: number }>;
  readonly regions: ReadonlyArray<{
    readonly regionId: string;
    readonly support: number;
    readonly oppose: number;
  }>;
  readonly quotes: readonly string[];
  readonly crowdSize: number;
  readonly collective?: SocietyMind['collective'];
  readonly arcs: readonly StoryArc[];
};

export function boardView(mind: SocietyMind): OpinionBoard {
  const latestTopic = mind.policies.at(-1)?.id;
  const rows = latestTopic
    ? mind.opinions.filter((o) => o.topicId === latestTopic)
    : mind.opinions;
  const leaders = [...rows]
    .sort((a, b) => Math.abs(b.stance) - Math.abs(a.stance))
    .slice(0, 8)
    .map((r) => ({ agentId: r.agentId, stance: r.stance, reason: r.reason }));
  const reasonCount = new Map<string, number>();
  for (const r of rows) {
    const text = r.reason.trim();
    if (!text) continue;
    reasonCount.set(text, (reasonCount.get(text) ?? 0) + 1);
  }
  const reasons = [...reasonCount.entries()]
    .map(([text, count]) => ({ text, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
  const regions = new Map<string, { support: number; oppose: number; n: number }>();
  for (const c of mind.crowd) {
    const cur = regions.get(c.regionId) ?? { support: 0, oppose: 0, n: 0 };
    const tick = historyTick(0, [], [c]);
    cur.support += tick.crowdSupport * c.size;
    cur.oppose += tick.crowdOppose * c.size;
    cur.n += c.size;
    regions.set(c.regionId, cur);
  }
  return {
    policies: mind.policies,
    history: mind.history,
    leaders,
    reasons,
    regions: [...regions.entries()].map(([regionId, v]) => ({
      regionId,
      support: v.n ? v.support / v.n : 0,
      oppose: v.n ? v.oppose / v.n : 0,
    })),
    quotes: rows.map((r) => r.reason).filter(Boolean).slice(0, 8),
    crowdSize: mind.crowd.reduce((s, c) => s + c.size, 0),
    ...(mind.collective ? { collective: mind.collective } : {}),
    arcs: mind.arcs,
  };
}

export function sampleCrowdDots(cohorts: readonly CrowdCohort[]): CrowdDot[] {
  const out: CrowdDot[] = [];
  for (const c of cohorts) {
    const n = Math.min(24, Math.max(4, Math.round(c.size / 80)));
    const stance = meanHist(c.hist);
    for (let i = 0; i < n; i++) {
      const h = hashStr(`${c.id}:${i}`);
      out.push({
        regionId: c.regionId,
        x: 2 + (h % 10),
        y: 2 + ((h >>> 4) % 8),
        stance,
      });
    }
  }
  return out.slice(0, 160);
}

export function hydrateMind(raw: unknown): SocietyMind {
  if (!raw || typeof raw !== 'object') return emptyMind();
  const base = emptyMind();
  const rec = raw as Partial<SocietyMind>;
  return {
    ...base,
    policies: Array.isArray(rec.policies) ? rec.policies : [],
    opinions: Array.isArray(rec.opinions) ? rec.opinions : [],
    crowd: Array.isArray(rec.crowd) ? rec.crowd : [],
    commitments: Array.isArray(rec.commitments) ? rec.commitments : [],
    arcs: Array.isArray(rec.arcs) ? rec.arcs : [],
    beliefCards: rec.beliefCards && typeof rec.beliefCards === 'object' ? rec.beliefCards : {},
    fingerprints:
      rec.fingerprints && typeof rec.fingerprints === 'object' ? rec.fingerprints : {},
    recentTopics: Array.isArray(rec.recentTopics) ? rec.recentTopics : [],
    topicSummaries:
      rec.topicSummaries && typeof rec.topicSummaries === 'object' ? rec.topicSummaries : {},
    history: Array.isArray(rec.history) ? rec.history : [],
    ...(rec.collective ? { collective: rec.collective } : {}),
    ...(rec.spotlight &&
    typeof rec.spotlight === 'object' &&
    typeof rec.spotlight.text === 'string'
      ? { spotlight: { text: rec.spotlight.text.slice(0, 72), at: Number(rec.spotlight.at ?? 0) } }
      : {}),
  };
}

export function mindSnapshot(mind: SocietyMind): Record<string, unknown> {
  return { ...mind };
}
