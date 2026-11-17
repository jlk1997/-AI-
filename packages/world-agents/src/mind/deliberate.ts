/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * A core resident thinks, then names an action in their own words.
 * The force tag is only a bucket for the outcome table.
 */

import { looksSoftened, stripOperationalHowTo } from './contentPolicy.js';
import { emotionLine, type Psyche } from './psyche.js';

export type ForceTag = 'none' | 'push' | 'throw' | 'nonlethal' | 'lethal' | 'flee' | 'property';

export type OpenAction = {
  readonly what: string;
  readonly target: string;
  readonly place: string;
  readonly manner: string;
  readonly public: boolean;
  readonly force: ForceTag;
};

export type Deliberation = {
  readonly monologue: string;
  readonly intent: string;
  readonly action: OpenAction;
};

const FORCES: readonly ForceTag[] = [
  'none',
  'push',
  'throw',
  'nonlethal',
  'lethal',
  'flee',
  'property',
];

export function deliberatePrompt(input: {
  readonly name: string;
  readonly psyche: Psyche;
  readonly situation: string;
  readonly memories: readonly string[];
}): string {
  const p = input.psyche;
  return [
    `${input.name}在想接下来做什么。只返回 JSON。`,
    '可以抗议、罢工、离开、隐瞒、动手或照常过日子。按这个人的性格来，不要写成清单里的走路。',
    '不要写武器制作或袭击步骤。force 只能是 none, push, throw, nonlethal, lethal, flee, property。',
    `处境：${input.situation}`,
    `目标：${p.goals.map((g) => g.text).join('；') || '过自己的日子'}`,
    `情绪：${emotionLine(p)}。怨气 ${p.grievance.toFixed(2)}，对权威 ${p.legitimacy.toFixed(2)}，觉得闹有用 ${p.efficacy.toFixed(2)}。`,
    `秘密：${p.secret || '无'}`,
    `记得：${input.memories.slice(0, 4).join(' | ') || '没什么新的'}`,
    'JSON：{"monologue":"...","intent":"...","action":{"what":"...","target":"","place":"","manner":"","public":true,"force":"none"}}',
  ].join('\n');
}

export function parseDeliberation(raw: string): Deliberation | null {
  if (looksSoftened(raw)) return null;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const o = JSON.parse(raw.slice(start, end + 1)) as {
      monologue?: unknown;
      intent?: unknown;
      action?: Record<string, unknown>;
    };
    const action = o.action ?? {};
    const what = stripOperationalHowTo(String(action['what'] ?? '')).text.trim();
    if (!what) return null;
    const force = FORCES.includes(action['force'] as ForceTag)
      ? (action['force'] as ForceTag)
      : 'none';
    return {
      monologue: stripOperationalHowTo(String(o.monologue ?? '')).text.slice(0, 240),
      intent: String(o.intent ?? '').slice(0, 80),
      action: {
        what: what.slice(0, 180),
        target: String(action['target'] ?? '').slice(0, 40),
        place: String(action['place'] ?? '').slice(0, 40),
        manner: stripOperationalHowTo(String(action['manner'] ?? '')).text.slice(0, 80),
        public: action['public'] !== false,
        force,
      },
    };
  } catch {
    return null;
  }
}

/** Used when the model is absent or refused. Still driven by this person's state. */
export function heuristicAction(psyche: Psyche, situation: string, salt: number): Deliberation {
  const bored = psyche.boredom > 0.65;
  const scared = psyche.emotions.fear > 0.65;
  const angry = psyche.emotions.anger > 0.55 && psyche.grievance > 0.6;
  const goal = psyche.goals[0]?.text || '把自己的事办完';
  let action: OpenAction;
  let intent: string;
  if (scared && psyche.riskTolerance < 0.45) {
    intent = '先保家人';
    action = {
      what: `${psyche.agentId === '' ? '' : ''}带着要紧的东西离开这片，先不跟任何人解释`.replace(
        /^/,
        '',
      ),
      target: '家人',
      place: '住处',
      manner: '趁天没黑',
      public: false,
      force: 'flee',
    };
    action = { ...action, what: '带着要紧的东西离开这片，先不跟任何人解释' };
  } else if (angry && !bored) {
    intent = psyche.efficacy > 0.45 ? '把不满摊开' : '先找人商量';
    const hard = psyche.riskTolerance > 0.7 && psyche.legitimacy < 0.35;
    action = {
      what: hard ? '去堵镇政府门口，不让车进' : '找几个信得过的人，把这事说清楚再决定去不去',
      target: hard ? '镇政府' : '熟人',
      place: situation.slice(0, 24) || '街上',
      manner: hard ? '当众' : '私下',
      public: hard,
      force: hard ? 'push' : 'none',
    };
  } else if (bored) {
    intent = '换一件自己的事';
    action = {
      what: `不再聊刚才那个，改去办：${goal}`,
      target: '',
      place: '自己的地方',
      manner: '一个人',
      public: false,
      force: 'none',
    };
  } else if (salt % 5 === 0 && psyche.secret) {
    intent = '把秘密按住';
    action = {
      what: '有人问起时把话岔开，回头把那件事的痕迹收起来',
      target: '',
      place: '家里',
      manner: '不声张',
      public: false,
      force: 'none',
    };
  } else {
    const job = psyche.identityGroup || '营生';
    const variants = [
      `把今天的${job}做完，顺嘴问了旁边的人一句`,
      `给家里去了个信，说自己还在`,
      `在常去的地方留了张字条：${goal}`,
      `换条路走，避开刚才那摊人`,
    ];
    intent = goal;
    action = {
      what: variants[Math.abs(salt) % variants.length]!,
      target: '',
      place: job,
      manner: '照自己的节奏',
      public: salt % 2 === 0,
      force: 'none',
    };
  }
  return {
    monologue: `${emotionLine(psyche)}。${action.what}`,
    intent,
    action,
  };
}
