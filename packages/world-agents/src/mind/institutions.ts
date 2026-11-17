/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Governments, police, units, papers, clans, and crowds are actors with a
 * chain of command. The person at the bottom can delay, exceed, or refuse.
 */

import type { Psyche } from './psyche.js';
import { clamp01 } from './rng.js';
import type { AuthorityResponse } from './conflict.js';

export type InstitutionKind =
  | 'government'
  | 'police'
  | 'military'
  | 'hospital'
  | 'media'
  | 'company'
  | 'clan'
  | 'faith'
  | 'gang'
  | 'crowd';

export type Doctrine = {
  /** Prefer talking before force. */
  readonly negotiateFirst: boolean;
  readonly allowIrritant: boolean;
  readonly allowFirearm: boolean;
  readonly noticeHours: number;
  readonly liveFire: boolean;
};

export type Institution = {
  readonly id: string;
  readonly name: string;
  readonly kind: InstitutionKind;
  readonly regionId: string;
  readonly goal: string;
  readonly headId?: string;
  readonly memberIds: readonly string[];
  readonly people: number;
  readonly gearLevel: number;
  readonly mobility: number;
  readonly medical: number;
  readonly doctrine: Doctrine;
  /** What the public is told. May differ from the internal note. */
  readonly publicLine: string;
  readonly internalNote: string;
};

export type Order = {
  readonly fromId: string;
  readonly text: string;
  readonly response: AuthorityResponse;
  readonly regionId: string;
};

export type Compliance = 'obey' | 'delay' | 'escalate' | 'refuse' | 'conceal';

export function defaultInstitutions(regionId: string): Institution[] {
  return [
    {
      id: 'gov',
      name: '镇政府',
      kind: 'government',
      regionId,
      goal: '把局面按住，别上头条',
      memberIds: [],
      people: 12,
      gearLevel: 0,
      mobility: 0.4,
      medical: 0,
      doctrine: {
        negotiateFirst: true,
        allowIrritant: false,
        allowFirearm: false,
        noticeHours: 48,
        liveFire: false,
      },
      publicLine: '',
      internalNote: '',
    },
    {
      id: 'police',
      name: '派出所',
      kind: 'police',
      regionId,
      goal: '别出事，出事了先控制现场',
      memberIds: [],
      people: 30,
      gearLevel: 1,
      mobility: 0.6,
      medical: 0.1,
      doctrine: {
        negotiateFirst: true,
        allowIrritant: true,
        allowFirearm: false,
        noticeHours: 0,
        liveFire: false,
      },
      publicLine: '',
      internalNote: '',
    },
    {
      id: 'clinic',
      name: '卫生院',
      kind: 'hospital',
      regionId,
      goal: '把伤员接下来',
      memberIds: [],
      people: 15,
      gearLevel: 0,
      mobility: 0.3,
      medical: 0.6,
      doctrine: {
        negotiateFirst: true,
        allowIrritant: false,
        allowFirearm: false,
        noticeHours: 0,
        liveFire: false,
      },
      publicLine: '',
      internalNote: '',
    },
    {
      id: 'paper',
      name: '本地号',
      kind: 'media',
      regionId,
      goal: '先发出去',
      memberIds: [],
      people: 4,
      gearLevel: 0,
      mobility: 0.8,
      medical: 0,
      doctrine: {
        negotiateFirst: true,
        allowIrritant: false,
        allowFirearm: false,
        noticeHours: 0,
        liveFire: false,
      },
      publicLine: '',
      internalNote: '',
    },
  ];
}

export function militaryUnit(input: {
  readonly regionId: string;
  readonly liveFire: boolean;
  readonly noticeHours: number;
  readonly people?: number;
}): Institution {
  return {
    id: 'unit',
    name: '演训分队',
    kind: 'military',
    regionId: input.regionId,
    goal: '按计划完成演训，别伤到居民',
    memberIds: [],
    people: input.people ?? 80,
    gearLevel: input.liveFire ? 3 : 1,
    mobility: 0.7,
    medical: 0.4,
    doctrine: {
      negotiateFirst: false,
      allowIrritant: false,
      allowFirearm: input.liveFire,
      noticeHours: input.noticeHours,
      liveFire: input.liveFire,
    },
    publicLine: input.noticeHours > 0 ? `提前 ${input.noticeHours} 小时通知禁入` : '未提前通知',
    internalNote: input.liveFire ? '实弹' : '非实弹',
  };
}

/**
 * The person who has to carry the order out. High fear and low legitimacy
 * make refusal or concealment more likely. This is a tendency, not a script.
 */
export function comply(
  order: Order,
  psyche: Pick<Psyche, 'fear' extends never ? never : 'legitimacy'> & {
    readonly legitimacy: number;
    readonly grievance: number;
    readonly riskTolerance: number;
    readonly emotions: { readonly fear: number; readonly anger: number };
  },
  rng: () => number,
): Compliance {
  const fear = psyche.emotions.fear;
  const roll = rng();
  if (order.response === 'lethal' && psyche.legitimacy < 0.35 && roll < 0.25 + fear * 0.2) {
    return 'refuse';
  }
  if (psyche.grievance > 0.7 && psyche.emotions.anger > 0.6 && roll < 0.2) return 'escalate';
  if (fear > 0.65 && roll < 0.3) return 'conceal';
  if (psyche.riskTolerance < 0.3 && roll < 0.25) return 'delay';
  return 'obey';
}

export function chooseResponse(
  inst: Institution,
  pressure: number,
): AuthorityResponse {
  if (inst.kind === 'media' || inst.kind === 'hospital') return 'none';
  if (inst.doctrine.negotiateFirst && pressure < 0.55) return 'dialogue';
  if (pressure < 0.35) return 'concession';
  if (pressure < 0.6) return inst.doctrine.allowIrritant ? 'disperse' : 'dialogue';
  if (pressure < 0.8) return 'arrest';
  if (inst.doctrine.allowFirearm && pressure > 0.85) return 'lethal';
  return 'disperse';
}

export function mediaLine(official: string, rumor: string, rng: () => number): {
  readonly official: string;
  readonly street: string;
} {
  const twist = rng() < 0.35;
  return {
    official: official || '官方尚未回应',
    street: twist ? `街上的说法和通知不一样：${rumor || '有人受伤'}` : rumor || official,
  };
}

export function clampPressure(n: number): number {
  return clamp01(n);
}
