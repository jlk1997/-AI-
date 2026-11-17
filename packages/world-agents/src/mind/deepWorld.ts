/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * One deep town: a few named residents plus a crowd, institutions, and a ledger.
 */

import type { ChronicleEntry } from './chronicle.js';
import { emptyConflict, type ConflictCell } from './conflict.js';
import {
  defaultInstitutions,
  militaryUnit,
  type Institution,
} from './institutions.js';
import type { SubjectiveMemory } from './memoryV2.js';
import { seedPsyche, type Psyche } from './psyche.js';
import { hashSeed, mulberry32 } from './rng.js';
import { applyLedger, emptyLedger, ensurePerson, type WorldLedger } from './worldLedger.js';

export type DeepAgent = {
  readonly id: string;
  readonly name: string;
  readonly occupation: string;
  readonly regionId: string;
  readonly identity: string;
  readonly core: boolean;
  readonly away?: boolean;
};

export type TownPoll = {
  readonly simHour: number;
  readonly n: number;
  readonly oppose: number;
  readonly afraid: number;
  readonly wouldShow: number;
  readonly wouldForce: number;
};

export type TownIssue = {
  readonly simHour: number;
  readonly title: string;
  readonly lines: readonly string[];
};

export type TownWriting = {
  readonly simHour: number;
  readonly authorId: string;
  readonly authorName: string;
  readonly kind: 'diary' | 'notice' | 'post' | 'letter';
  readonly text: string;
};

export type DeepWorld = {
  readonly simHour: number;
  readonly seed: number;
  readonly population: number;
  readonly economy: number;
  readonly agents: readonly DeepAgent[];
  readonly psyches: Readonly<Record<string, Psyche>>;
  readonly ledger: WorldLedger;
  readonly institutions: readonly Institution[];
  readonly conflict: readonly ConflictCell[];
  readonly chronicle: readonly ChronicleEntry[];
  readonly recentLines: readonly string[];
  readonly topicCounts: Readonly<Record<string, number>>;
  readonly memories: Readonly<Record<string, readonly SubjectiveMemory[]>>;
  readonly monologues: Readonly<Record<string, string>>;
  readonly writings: readonly TownWriting[];
  /** Phrases and stories the town has started to repeat. */
  readonly culture: readonly string[];
  readonly polls?: readonly TownPoll[];
  readonly paper?: readonly TownIssue[];
  readonly outside?: readonly string[];
  readonly usage: { readonly bucket: string; readonly calls: number; readonly softened: number };
  readonly casualtyScale: number;
  readonly weather: string;
};

const NAMES = [
  '周衡', '林夏', '赵猛', '陈穗', '孙磊', '吴晚', '郑川', '冯宁',
  '何乔', '马诚', '许棠', '韩朔', '曹毅', '邓晚晴', '彭卫国', '谢小满',
  '袁舟', '唐柠', '蒋北', '卢曼', '蔡石', '潘禾', '董齐', '叶晚',
];

const JOBS = [
  '菜贩', '护士', '辅警', '教师', '镇政府办事员', '记者', '货车司机', '电工',
  '退休职工', '学生', '诊所医生', '店铺老板', '宗族长辈', '工厂工人', '士兵', '清洁工',
  '渔民', '会计', '包工头', '网店主', '牧师', '小贩', '保安', '厨师',
];

export function seedDeepWorld(input?: {
  readonly seed?: number;
  readonly population?: number;
  readonly regionId?: string;
  readonly core?: number;
  readonly grievance?: number;
  readonly legitimacy?: number;
  readonly liveFire?: boolean;
  readonly noticeHours?: number;
  readonly agents?: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly occupation?: string;
    readonly regionId?: string;
    readonly identity?: string;
    readonly secret?: string;
    readonly stance?: string;
  }>;
}): DeepWorld {
  const seed = input?.seed ?? 1;
  const regionId = input?.regionId ?? 'town';
  const rng = mulberry32(hashSeed(`seed:${seed}`));
  const coreN = Math.max(2, Math.min(24, input?.core ?? 12));
  const provided = input?.agents ?? [];
  const agents: DeepAgent[] = [];
  for (let i = 0; i < coreN; i++) {
    const given = provided[i];
    agents.push({
      id: given?.id ?? `core_${i}`,
      name: given?.name ?? NAMES[i % NAMES.length]!,
      occupation: given?.occupation ?? JOBS[i % JOBS.length]!,
      regionId: given?.regionId ?? regionId,
      identity: given?.identity ?? `${JOBS[i % JOBS.length]}，在这镇上过日子`,
      core: true,
    });
  }
  const psyches: Record<string, Psyche> = {};
  let ledger = emptyLedger();
  for (const agent of agents) {
    const given = provided.find((a) => a.id === agent.id);
    psyches[agent.id] = seedPsyche({
      agentId: agent.id,
      name: agent.name,
      occupation: agent.occupation,
      backstory: agent.identity,
      secret: given?.secret,
      stance: given?.stance,
      grievance: input?.grievance,
      legitimacy: input?.legitimacy,
    });
    ledger = ensurePerson(ledger, agent.id, {
      agentId: agent.id,
      job: agent.occupation,
      home: regionId,
      money: 80 + Math.floor(rng() * 400),
    });
  }
  let institutions: Institution[] = defaultInstitutions(regionId).map((inst, index) => ({
    ...inst,
    headId: agents[index]?.id,
    memberIds: agents[index] ? [agents[index]!.id] : [],
  }));
  if (input?.liveFire || (input?.noticeHours ?? 0) > 0) {
    institutions = [
      ...institutions,
      militaryUnit({
        regionId,
        liveFire: Boolean(input?.liveFire),
        noticeHours: input?.noticeHours ?? 0,
      }),
    ];
  }
  const cell = {
    ...emptyConflict(regionId, input?.population ?? 1500),
    grievance: input?.grievance ?? 0.35,
    legitimacy: input?.legitimacy ?? 0.55,
    anger: Math.min(1, (input?.grievance ?? 0.35) * 0.8),
  };
  ledger = applyLedger(ledger, {
    district: { regionId, hospitalBeds: 20 },
    org: { id: 'town', name: '镇', food: 40, fuel: 20, medicine: 8, cash: 500 },
  });
  return {
    simHour: 8,
    seed,
    population: input?.population ?? 1500,
    economy: 0.5,
    agents,
    psyches,
    ledger,
    institutions,
    conflict: [cell],
    chronicle: [],
    recentLines: [],
    topicCounts: {},
    memories: {},
    monologues: {},
    writings: [],
    culture: [],
    polls: [],
    paper: [],
    outside: [],
    usage: { bucket: '0', calls: 0, softened: 0 },
    casualtyScale: 1,
    weather: 'clear',
  };
}

export function hydrateDeepWorld(raw: unknown): DeepWorld | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Partial<DeepWorld>;
  if (!o.agents || !o.psyches || !o.ledger) return null;
  return {
    ...(o as DeepWorld),
    writings: o.writings ?? [],
    culture: o.culture ?? [],
    polls: o.polls ?? [],
    paper: o.paper ?? [],
    outside: o.outside ?? [],
  };
}
