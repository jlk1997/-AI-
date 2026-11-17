/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DayPlan } from './plan.js';
import { segmentAt } from './plan.js';
import type { LlmTextFn } from './reflect.js';
import type { SocietyObjectKind } from './objects.js';
import {
  INTERESTING_OBJECT_RE,
  isAsciiCopy,
  isTalkingAction,
} from './copyLocale.js';

export interface AgentPose {
  readonly agentId: string;
  readonly name: string;
  readonly regionId: string;
  readonly x: number;
  readonly y: number;
  readonly currentAction?: string;
  readonly areaId?: string;
}

export interface WorldObjectState {
  readonly id: string;
  readonly areaId: string;
  readonly name: string;
  readonly state: string;
  readonly regionId?: string;
  readonly areaName?: string;
  readonly kind?: SocietyObjectKind;
}

/** Region the object lives in — never treat `areaId` as a region after Spec trees exist. */
export function objectRegionId(obj: WorldObjectState): string {
  return obj.regionId || obj.areaId;
}

export function objectInAgentRegion(
  obj: WorldObjectState,
  regionId: string,
): boolean {
  return objectRegionId(obj) === regionId;
}

export interface Perception {
  readonly nearbyAgents: AgentPose[];
  readonly nearbyObjects: WorldObjectState[];
}

export type ReactionKind = 'continue' | 'converse' | 'replan' | 'investigate';

export interface Reaction {
  readonly kind: ReactionKind;
  readonly targetAgentId?: string;
  readonly reason: string;
}

/** Who this resident chooses to approach — memory and ties beat raw distance. */
export interface TalkChoice {
  readonly target: AgentPose;
  readonly reason: string;
}

function pairKey(a: string, b: string): string {
  return [a, b].sort().join('|');
}

/**
 * Stanford-style attention: pick a person worth walking over to, not always
 * the nearest body. Rumors, memories, and unfinished social need rank higher
 * than standing next to a stranger.
 */
export function isSocialHour(
  hourOfDay: number,
  clockKind?: 'diurnal' | 'watch' | 'event',
): boolean {
  if (clockKind === 'watch' || clockKind === 'event') return true;
  return hourOfDay >= 8 && hourOfDay < 21;
}

/** Below this, daytime proximity is not enough reason to start a chat. */
export const SOCIAL_TALK_THRESHOLD = 0.28;

export function wantsToChat(input: {
  readonly socialNeed?: number;
  readonly rumorHint?: string;
  readonly lonely?: boolean;
  readonly mentioned?: boolean;
}): boolean {
  if (input.rumorHint) return true;
  if (input.lonely) return true;
  if (input.mentioned) return true;
  return (input.socialNeed ?? 0) >= SOCIAL_TALK_THRESHOLD;
}

/**
 * Who, if anyone, should this resident walk up to?
 */
export function pickTalkPartner(input: {
  readonly self: AgentPose;
  readonly candidates: readonly AgentPose[];
  readonly hourOfDay: number;
  readonly activity?: string;
  readonly rumorHint?: string;
  readonly rumorUnknownTo?: readonly string[];
  readonly drive?: { readonly kind: string; readonly label: string };
  readonly lastConverseAt?: Map<string, number>;
  readonly affinityOf?: (agentId: string) => number;
  readonly mentionedIds?: ReadonlySet<string>;
  readonly nowSimTime?: number;
  readonly clockKind?: 'diurnal' | 'watch' | 'event';
}): TalkChoice | undefined {
  if (!input.candidates.length) return undefined;
  const daytime = isSocialHour(input.hourOfDay, input.clockKind);
  const lonely = input.drive?.kind === 'social';
  const curious = input.drive?.kind === 'curiosity';
  if (!daytime && !input.rumorHint && !lonely) return undefined;

  const unknown = new Set(input.rumorUnknownTo ?? []);
  const now = input.nowSimTime ?? 0;
  const ascii = isAsciiCopy(
    `${input.self.name}${input.self.currentAction ?? ''}${input.activity ?? ''}`,
  );
  const activity = input.activity || input.self.currentAction || (ascii ? 'wandering' : '闲逛');
  let best: { target: AgentPose; score: number } | undefined;
  for (const c of input.candidates) {
    if (c.agentId === input.self.agentId) continue;
    const dist = Math.hypot(c.x - input.self.x, c.y - input.self.y);
    const last =
      input.lastConverseAt?.get(pairKey(input.self.agentId, c.agentId)) ?? -999;
    const hoursSince = now - last;
    const affinity = input.affinityOf?.(c.agentId) ?? 0;
    const mentioned = input.mentionedIds?.has(c.agentId) === true;
    const rumorUnknown = Boolean(input.rumorHint) && unknown.has(c.agentId);
    let score = 10 - dist;
    if (rumorUnknown) score += 80;
    if (mentioned) score += 36;
    score += affinity * 28;
    score += hoursSince > 80 ? 18 : Math.min(16, Math.max(0, hoursSince) * 4);
    if (lonely) score += 12;
    if (curious) score += 8;
    if (isTalkingAction(c.currentAction ?? '')) score -= 6;
    if (!best || score > best.score) best = { target: c, score };
  }
  if (!best) return undefined;
  const other = best.target;
  const reason = input.mentionedIds?.has(other.agentId)
    ? ascii
      ? `thinking of ${other.name}, want a word`
      : `想起${other.name}，想过去说两句`
    : lonely
      ? ascii
        ? `${input.drive!.label}, ran into ${other.name}`
        : `${input.drive!.label}，正好碰上 ${other.name}`
      : ascii
        ? `saw ${other.name} nearby, I am ${activity}`
        : `看见 ${other.name} 在附近，自己正在${activity}`;
  return { target: other, reason };
}

export function perceive(
  self: AgentPose,
  others: readonly AgentPose[],
  objects: readonly WorldObjectState[],
  radius = 3,
): Perception {
  const nearbyAgents = others
    .filter(
      (o) =>
        o.agentId !== self.agentId &&
        o.regionId === self.regionId &&
        Math.hypot(o.x - self.x, o.y - self.y) <= radius,
    )
    .sort(
      (a, b) =>
        Math.hypot(a.x - self.x, a.y - self.y) -
        Math.hypot(b.x - self.x, b.y - self.y),
    );
  const nearbyObjects = objects
    .filter((o) => objectInAgentRegion(o, self.regionId))
    .sort((a, b) => {
      const aHere = self.areaId && a.areaId === self.areaId ? 0 : 1;
      const bHere = self.areaId && b.areaId === self.areaId ? 0 : 1;
      return aHere - bHere;
    });
  return { nearbyAgents, nearbyObjects };
}

export function decideReaction(input: {
  readonly self: AgentPose;
  readonly plan: DayPlan | null;
  readonly hourOfDay: number;
  readonly perception: Perception;
  /** Recent whisper/rumor text — prefer talking even at night. */
  readonly rumorHint?: string;
  /** Nearby agent ids who have not stored this rumor yet. */
  readonly rumorUnknownTo?: readonly string[];
  /** A drive past its threshold that the schedule is not addressing. */
  readonly drive?: { readonly kind: string; readonly label: string };
  readonly lastConverseAt?: Map<string, number>;
  readonly affinityOf?: (agentId: string) => number;
  readonly mentionedIds?: ReadonlySet<string>;
  readonly nowSimTime?: number;
  readonly clockKind?: 'diurnal' | 'watch' | 'event';
  /** 0–1 social drive. Daytime filler chats require this to be non-zero. */
  readonly socialNeed?: number;
}): Reaction {
  const seg = input.plan ? segmentAt(input.plan, input.hourOfDay) : null;
  const activity = seg?.activity ?? input.self.currentAction ?? '';
  const ascii = isAsciiCopy(`${input.self.name}${activity}`);

  const choice = pickTalkPartner({
    self: input.self,
    candidates: input.perception.nearbyAgents,
    hourOfDay: input.hourOfDay,
    activity,
    rumorHint: input.rumorHint,
    rumorUnknownTo: input.rumorUnknownTo,
    drive: input.drive,
    lastConverseAt: input.lastConverseAt,
    affinityOf: input.affinityOf,
    mentionedIds: input.mentionedIds,
    nowSimTime: input.nowSimTime,
    clockKind: input.clockKind,
  });
  if (choice) {
    const mentioned = input.mentionedIds?.has(choice.target.agentId) === true;
    if (
      wantsToChat({
        socialNeed: input.socialNeed,
        rumorHint: input.rumorHint,
        lonely: input.drive?.kind === 'social',
        mentioned,
      })
    ) {
      return {
        kind: 'converse',
        targetAgentId: choice.target.agentId,
        reason: choice.reason,
      };
    }
  }

  // A drive nobody can satisfy on the spot rewrites the rest of the day. This
  // is the only path that reaches the `replan` branch in practice.
  if (input.drive && input.plan) {
    return { kind: 'replan', reason: input.drive.label };
  }

  const interesting = input.perception.nearbyObjects.find((o) =>
    INTERESTING_OBJECT_RE.test(o.state + o.name),
  );
  if (interesting) {
    return {
      kind: 'investigate',
      reason: ascii
        ? `noticed ${interesting.name}: ${interesting.state}`
        : `注意到 ${interesting.name}：${interesting.state}`,
    };
  }

  return {
    kind: 'continue',
    reason: activity || (ascii ? 'keep going' : '继续日常'),
  };
}

/**
 * Park et al.: given memory, should this resident interrupt the schedule?
 * One sampled call per step — never 12 heads hitting the model at once.
 */
export async function maybeLlmReaction(input: {
  readonly agentName: string;
  readonly identity: string;
  readonly activity: string;
  readonly nearby: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  readonly memories: readonly string[];
  readonly rumorHint?: string;
  readonly llm: LlmTextFn;
}): Promise<Reaction | null> {
  const ascii = isAsciiCopy(`${input.agentName}${input.identity}`);
  const prompt = ascii
    ? `You are ${input.agentName}. Given memory, should you interrupt the current schedule?
Identity: ${input.identity.slice(0, 80)}
Doing: ${input.activity.slice(0, 40)}
Nearby: ${input.nearby.map((n) => n.name).slice(0, 5).join(', ') || 'nobody'}
Rumor: ${input.rumorHint?.slice(0, 40) || 'none'}
Memories:
${input.memories.slice(0, 6).map((m) => `- ${m.slice(0, 50)}`).join('\n') || '- none'}
Return JSON only: {"kind":"continue"|"converse"|"replan"|"investigate","reason":"short English","targetName":"optional"}`
    : `你是${input.agentName}。根据记忆，现在该不该停下当前日程？
身份：${input.identity.slice(0, 80)}
正在做：${input.activity.slice(0, 40)}
附近的人：${input.nearby.map((n) => n.name).slice(0, 5).join('、') || '没人'}
传闻：${input.rumorHint?.slice(0, 40) || '无'}
记忆：
${input.memories.slice(0, 6).map((m) => `- ${m.slice(0, 50)}`).join('\n') || '- 无'}
只返回 JSON：{"kind":"continue"|"converse"|"replan"|"investigate","reason":"短中文","targetName":"可选"}`;
  try {
    const raw = await input.llm(prompt);
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end < start) return null;
    const parsed = JSON.parse(raw.slice(start, end + 1)) as {
      kind?: string;
      reason?: string;
      targetName?: string;
    };
    const kind = parsed.kind;
    if (
      kind !== 'continue' &&
      kind !== 'converse' &&
      kind !== 'replan' &&
      kind !== 'investigate'
    ) {
      return null;
    }
    const hit = parsed.targetName
      ? input.nearby.find(
          (n) =>
            n.name === parsed.targetName ||
            n.name.includes(parsed.targetName!) ||
            parsed.targetName!.includes(n.name),
        )
      : input.nearby[0];
    return {
      kind,
      reason: String(parsed.reason ?? (ascii ? 'from memory' : '根据记忆决定')).slice(
        0,
        80,
      ),
      targetAgentId: kind === 'converse' ? hit?.id : undefined,
    };
  } catch {
    return null;
  }
}
