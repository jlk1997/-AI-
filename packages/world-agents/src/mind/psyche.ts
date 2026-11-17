/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Inner life of a core resident: values, goals, emotion, and possibly wrong
 * guesses about other people and institutions.
 */

import { clamp01, hashSeed, mulberry32 } from './rng.js';

export type EmotionKey = 'anger' | 'fear' | 'shame' | 'hope' | 'joy' | 'sadness';

export type Goal = { readonly text: string; readonly progress: number };

export type RelationView = {
  readonly trust: number;
  readonly liking: number;
  readonly respect: number;
  readonly resentment: number;
  readonly debt: number;
  readonly note: string;
};

export type BeliefAbout = {
  readonly wants: string;
  readonly knows: string;
  readonly towardMe: string;
  /** 0–1. Low confidence means the guess is allowed to be wrong. */
  readonly confidence: number;
};

export type Psyche = {
  readonly agentId: string;
  readonly values: readonly string[];
  readonly goals: readonly Goal[];
  readonly worry: string;
  readonly fears: readonly string[];
  readonly secret: string;
  readonly withholdFrom: readonly string[];
  readonly voice: string;
  readonly emotions: Readonly<Record<EmotionKey, number>>;
  readonly narrative: string;
  /** Felt unfairness, 0–1. */
  readonly grievance: number;
  /** Acceptance of authority, 0–1. */
  readonly legitimacy: number;
  /** "Would showing up change anything?" */
  readonly efficacy: number;
  readonly riskTolerance: number;
  readonly identityGroup: string;
  readonly relations: Readonly<Record<string, RelationView>>;
  readonly beliefsAbout: Readonly<Record<string, BeliefAbout>>;
  /** How tired they are of the current topic, 0–1. */
  readonly boredom: number;
};

const EMOTIONS: readonly EmotionKey[] = [
  'anger',
  'fear',
  'shame',
  'hope',
  'joy',
  'sadness',
];

export function emptyEmotions(): Record<EmotionKey, number> {
  return { anger: 0.1, fear: 0.1, shame: 0.05, hope: 0.4, joy: 0.3, sadness: 0.1 };
}

export function seedPsyche(input: {
  readonly agentId: string;
  readonly name?: string;
  readonly occupation?: string;
  readonly backstory?: string;
  readonly secret?: string;
  readonly stance?: string;
  readonly grievance?: number;
  readonly legitimacy?: number;
}): Psyche {
  const rng = mulberry32(hashSeed(input.agentId + (input.name ?? '')));
  const grievance = clamp01(input.grievance ?? 0.25 + rng() * 0.4);
  return {
    agentId: input.agentId,
    values: input.occupation ? [`把${input.occupation}的日子过下去`] : ['家里人平安'],
    goals: [
      { text: input.occupation ? `保住${input.occupation}这份营生` : '把这个月过完', progress: 0.3 },
      { text: '别让家里人受惊', progress: 0.2 },
    ],
    worry: input.backstory?.slice(0, 80) || '最近的事不踏实',
    fears: grievance > 0.6 ? ['被收拾', '没人管'] : ['丢了营生'],
    secret: input.secret ?? '',
    withholdFrom: [],
    voice: '口语，短句',
    emotions: {
      ...emptyEmotions(),
      anger: clamp01(grievance * 0.6),
      fear: clamp01(0.15 + (1 - (input.legitimacy ?? 0.5)) * 0.2),
    },
    narrative: input.backstory?.slice(0, 180) || `${input.name ?? '这个人'}按自己的日子过。`,
    grievance,
    legitimacy: clamp01(input.legitimacy ?? 0.55 - grievance * 0.2),
    efficacy: clamp01(0.35 + rng() * 0.3),
    riskTolerance: clamp01(0.2 + rng() * 0.5),
    identityGroup: input.occupation || '居民',
    relations: {},
    beliefsAbout: {},
    boredom: 0,
  };
}

export function decayEmotions(psyche: Psyche, hours: number): Psyche {
  const keep = Math.exp(-Math.max(0, hours) / 18);
  const emotions = { ...psyche.emotions };
  for (const key of EMOTIONS) {
    const base = key === 'hope' || key === 'joy' ? 0.25 : 0.08;
    emotions[key] = clamp01(base + (emotions[key] - base) * keep);
  }
  return { ...psyche, emotions, boredom: clamp01(psyche.boredom * keep) };
}

export function shockEmotion(
  psyche: Psyche,
  shock: Partial<Record<EmotionKey, number>> & {
    readonly grievance?: number;
    readonly legitimacy?: number;
    readonly efficacy?: number;
  },
): Psyche {
  const emotions = { ...psyche.emotions };
  for (const key of EMOTIONS) {
    const delta = shock[key];
    if (typeof delta === 'number') emotions[key] = clamp01(emotions[key] + delta);
  }
  return {
    ...psyche,
    emotions,
    grievance: clamp01(psyche.grievance + (shock.grievance ?? 0)),
    legitimacy: clamp01(psyche.legitimacy + (shock.legitimacy ?? 0)),
    efficacy: clamp01(psyche.efficacy + (shock.efficacy ?? 0)),
  };
}

export function relate(
  psyche: Psyche,
  otherId: string,
  patch: Partial<RelationView>,
): Psyche {
  const prev = psyche.relations[otherId] ?? {
    trust: 0.4,
    liking: 0.4,
    respect: 0.4,
    resentment: 0.1,
    debt: 0,
    note: '',
  };
  return {
    ...psyche,
    relations: {
      ...psyche.relations,
      [otherId]: {
        trust: clamp01(patch.trust ?? prev.trust),
        liking: clamp01(patch.liking ?? prev.liking),
        respect: clamp01(patch.respect ?? prev.respect),
        resentment: clamp01(patch.resentment ?? prev.resentment),
        debt: clamp01(patch.debt ?? prev.debt),
        note: patch.note ?? prev.note,
      },
    },
  };
}

export function believeAbout(
  psyche: Psyche,
  otherId: string,
  belief: BeliefAbout,
): Psyche {
  return {
    ...psyche,
    beliefsAbout: { ...psyche.beliefsAbout, [otherId]: belief },
  };
}

export function biographyPrompt(input: {
  readonly name: string;
  readonly occupation?: string;
  readonly backstory?: string;
  readonly traits?: readonly string[];
}): string {
  return [
    '写一份人物小传，只返回 JSON。',
    `姓名：${input.name}`,
    `职业：${input.occupation ?? '居民'}`,
    `已知：${input.backstory ?? '无'}`,
    `性格：${(input.traits ?? []).join('、') || '未写'}`,
    '字段：values(字符串数组), goals([{text,progress}]), worry, fears(数组), voice, narrative, grievance(0到1), legitimacy(0到1), efficacy(0到1), riskTolerance(0到1), identityGroup。',
    '这个人要像真人，有私心，不要写成英雄模板。',
  ].join('\n');
}

export function parseBiography(raw: string): Partial<Psyche> | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const o = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    const goals = Array.isArray(o['goals'])
      ? o['goals']
          .map((g) => {
            if (!g || typeof g !== 'object') return null;
            const text = String((g as { text?: unknown }).text ?? '').trim();
            if (!text) return null;
            return {
              text,
              progress: clamp01(Number((g as { progress?: unknown }).progress ?? 0)),
            };
          })
          .filter((g): g is Goal => Boolean(g))
      : [];
    return {
      ...(Array.isArray(o['values'])
        ? { values: o['values'].map((v) => String(v)).slice(0, 4) }
        : {}),
      ...(goals.length ? { goals } : {}),
      ...(typeof o['worry'] === 'string' ? { worry: o['worry'].slice(0, 120) } : {}),
      ...(Array.isArray(o['fears'])
        ? { fears: o['fears'].map((v) => String(v)).slice(0, 4) }
        : {}),
      ...(typeof o['voice'] === 'string' ? { voice: o['voice'].slice(0, 80) } : {}),
      ...(typeof o['narrative'] === 'string'
        ? { narrative: o['narrative'].slice(0, 240) }
        : {}),
      ...(Number.isFinite(Number(o['grievance']))
        ? { grievance: clamp01(Number(o['grievance'])) }
        : {}),
      ...(Number.isFinite(Number(o['legitimacy']))
        ? { legitimacy: clamp01(Number(o['legitimacy'])) }
        : {}),
      ...(Number.isFinite(Number(o['efficacy']))
        ? { efficacy: clamp01(Number(o['efficacy'])) }
        : {}),
      ...(Number.isFinite(Number(o['riskTolerance']))
        ? { riskTolerance: clamp01(Number(o['riskTolerance'])) }
        : {}),
      ...(typeof o['identityGroup'] === 'string'
        ? { identityGroup: o['identityGroup'].slice(0, 40) }
        : {}),
    };
  } catch {
    return null;
  }
}

export async function writeBiography(
  seed: Parameters<typeof seedPsyche>[0] & {
    readonly name: string;
    readonly traits?: readonly string[];
  },
  llm?: (prompt: string) => Promise<string>,
): Promise<Psyche> {
  const base = seedPsyche(seed);
  if (!llm) return base;
  try {
    const raw = await llm(
      biographyPrompt({
        name: seed.name,
        occupation: seed.occupation,
        backstory: seed.backstory,
        traits: seed.traits,
      }),
    );
    const parsed = parseBiography(raw);
    if (!parsed) return base;
    return { ...base, ...parsed, agentId: base.agentId };
  } catch {
    return base;
  }
}

export function emotionLine(psyche: Psyche): string {
  const top = EMOTIONS.map((k) => [k, psyche.emotions[k]] as const).sort(
    (a, b) => b[1] - a[1],
  )[0];
  const name: Record<EmotionKey, string> = {
    anger: '火气',
    fear: '害怕',
    shame: '难堪',
    hope: '还抱着希望',
    joy: '还算舒坦',
    sadness: '发闷',
  };
  return top && top[1] > 0.35 ? name[top[0]] : '心情平常';
}
