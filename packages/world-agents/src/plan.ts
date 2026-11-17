/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { createMemoryEntry, type MemoryStream } from './memory.js';
import { retrieveMemories } from './retrieval.js';
import type { LlmTextFn } from './reflect.js';
import { hashStr, stablePick, type AnchorKind } from './anchors.js';
import { isAsciiCopy } from './copyLocale.js';
import { hasErrandToday, temperamentFor } from './personality.js';

export interface PlanSegment {
  readonly startHour: number;
  readonly endHour: number;
  readonly activity: string;
  readonly locationId?: string;
  /** Human label for `locationId` (anchor / area name, not a raw id). */
  readonly locationName?: string;
  /** 5–15 min action beats under this hour block (day→hour→action). */
  readonly actions?: readonly string[];
}

/** Copy Spec anchor names onto plan segments so the inspector never shows raw ids. */
export function stampPlaceNames(
  segments: readonly PlanSegment[],
  places?: readonly PlanPlace[],
): PlanSegment[] {
  if (!places?.length) return [...segments];
  const byId = new Map(places.map((p) => [p.id, p.name] as const));
  return segments.map((s) => {
    if (!s.locationId) return s;
    const name = byId.get(s.locationId);
    if (!name || name === s.locationName) return s;
    return { ...s, locationName: name };
  });
}

export interface DayPlan {
  readonly agentId: string;
  readonly dayIndex: number;
  readonly segments: PlanSegment[];
}

/** Drop a promised errand into the day's schedule without regenerating it. */
export function insertCommitment(
  plan: DayPlan,
  input: {
    readonly hour: number;
    readonly activity: string;
    readonly locationId?: string;
    readonly spanHours?: number;
  },
): DayPlan {
  const span = Math.max(1, input.spanHours ?? 1);
  const start = Math.max(0, Math.min(23, input.hour));
  const end = Math.min(24, start + span);
  const urgent: PlanSegment = {
    startHour: start,
    endHour: end,
    activity: input.activity,
    ...(input.locationId ? { locationId: input.locationId } : {}),
  };
  const rest = plan.segments.flatMap((s) => {
    if (s.endHour <= start || s.startHour >= end) return [s];
    const parts: PlanSegment[] = [];
    if (s.startHour < start) parts.push({ ...s, endHour: start });
    if (s.endHour > end) parts.push({ ...s, startHour: end });
    return parts;
  });
  return {
    ...plan,
    segments: [...rest, urgent].sort((a, b) => a.startHour - b.startHour),
  };
}

export function segmentAt(plan: DayPlan, hourOfDay: number): PlanSegment | null {
  return (
    plan.segments.find(
      (s) => hourOfDay >= s.startHour && hourOfDay < s.endHour,
    ) ?? null
  );
}

/** Decompose a day/hour segment into concrete short actions. */
export function decomposeSegmentActions(segment: PlanSegment): string[] {
  if (segment.actions?.length) return [...segment.actions];
  const span = Math.max(1, segment.endHour - segment.startHour);
  const beats = Math.min(6, Math.max(3, span));
  const catalog = actionBeatsFor(segment.activity);
  const out: string[] = [];
  for (let i = 0; i < beats; i++) {
    out.push(catalog[i % catalog.length]!);
  }
  return out;
}

function coreActivity(activity: string): string {
  return (
    activity
      .replace(/^[^\s，,]{1,8}\s+/, '')
      .replace(/\s*·\s*第\d+\s*步\s*$/u, '')
      .trim() || activity
  );
}

const ACTION_BEATS: ReadonlyArray<{ match: RegExp; beats: readonly string[] }> = [
  {
    match: /on watch|handoff|shift change|stand watch/i,
    beats: ['check the station', 'call the next watch', 'note what changed'],
  },
  {
    match: /\bsleep\b|\brest\b|bunk/i,
    beats: ['lie down', 'turn over', 'drift off'],
  },
  {
    match: /\beat\b|mess|galley|lunch|dinner|breakfast/i,
    beats: ['find a seat', 'finish the meal', 'talk to whoever is next to you'],
  },
  {
    match: /talk|chat|meet|gather/i,
    beats: [
      'walk up and greet them',
      'say what you heard today',
      'listen',
      'agree to meet later',
    ],
  },
  {
    match: /works the forge|mends tools|at the forge/i,
    beats: ['stoke the fire', 'heat the blank', 'hammer to shape', 'check the edge'],
  },
  {
    match: /bakes bread|delivers fresh loaves|at the oven/i,
    beats: ['check the dough', 'slide loaves in', 'dust the hot bread', 'set them on the counter'],
  },
  {
    match: /teaches class|marks papers|attends class/i,
    beats: ['write today\'s lesson', 'listen to them read', 'nudge a wandering mind', 'collect the work'],
  },
  {
    match: /tends the bar|pours drinks/i,
    beats: ['wipe a glass', 'pour for whoever walked in', 'hear a complaint from the corner', 'carry empties back'],
  },
  {
    match: /walks the night watch|watches the gate/i,
    beats: ['walk the wall', 'stop at the crossing and listen', 'nod to a passer-by', 'turn the lantern up'],
  },
  {
    match: /sees patients|makes house calls/i,
    beats: ['ask where it hurts', 'find the right tin', 'wrap the packet', 'note who should come back'],
  },
  {
    match: /烘|烤|面包|面团/,
    beats: ['检查面团是否发酵', '把面包推进烤炉', '给刚出炉的面包撒粉', '把热面包摆上柜台'],
  },
  {
    match: /打铁|锻|锤|炉前/,
    beats: ['给炉火添炭', '把铁坯烧红', '锤打成形', '淬火并检查刃口'],
  },
  {
    match: /上课|学堂|功课|批改/,
    beats: ['在黑板上写下今日课题', '听孩子们读一遍', '给走神的孩子提一句', '把功课收到案上'],
  },
  {
    match: /吧台|上酒|招呼客人|客栈/,
    beats: ['擦干净一只杯子', '给进门的人倒上酒', '听角落里谁在抱怨', '把空碗收回后厨'],
  },
  {
    match: /看店|记账|补货|行情/,
    beats: ['把货架理齐', '在账本上记一笔', '向过路人打听进价', '把缺的货写进单子'],
  },
  {
    match: /巡夜|岗哨|盯着/,
    beats: ['沿墙根走一圈', '在路口停下来听动静', '和过路的人点个头', '把灯笼拨亮一点'],
  },
  {
    match: /诊治|出诊|病人|药/,
    beats: ['问清病人哪里不舒服', '在药柜里找对症的药', '把药包扎紧递过去', '记下谁还该复诊'],
  },
  {
    match: /田里|收成|麦|农/,
    beats: ['弯腰看看苗情', '把杂草拔掉一垄', '把收成装进筐里', '挑着筐往集市走'],
  },
  {
    match: /送信|跑腿|消息/,
    beats: ['把信封按门牌理好', '敲一家的门把话送到', '在路上又听来一句闲话', '把回信塞进布袋'],
  },
  {
    match: /典籍|笔记|抄|讨论/,
    beats: ['把卷宗摊开对照', '在页边写下疑问', '把对不上的句子抄下来', '想着待会儿该问谁'],
  },
  {
    match: /睡|补眠/,
    beats: ['躺下合眼', '翻个身继续睡', '在梦里过白天的事'],
  },
  {
    match: /吃早饭|洗漱|起床/,
    beats: ['洗脸梳头', '把昨晚的残羹收拾掉', '出门前再看一眼天色'],
  },
  {
    match: /午饭|晚饭|吃点/,
    beats: ['找个位子坐下', '把碗里的热汤喝完', '跟邻座随便说两句'],
  },
  {
    match: /闲聊|歇脚|碰面|找人|广场|交班|晚课|值班/,
    beats: ['走近熟人打招呼', '把今天听到的事说一遍', '听听对方怎么说', '约好傍晚再碰面'],
  },
];

function actionBeatsFor(activity: string): readonly string[] {
  const hit = ACTION_BEATS.find((b) => b.match.test(activity));
  if (hit) return hit.beats;
  const core = coreActivity(activity);
  if (isAsciiCopy(activity)) {
    return [
      `start ${core}`,
      `get halfway through ${core}`,
      `pause and look around`,
      `finish ${core}`,
    ];
  }
  return [`着手${core}`, `把这件事做到一半`, `停下来看看周围`, `把${core}收个尾`];
}

export function enrichPlanWithActions(plan: DayPlan): DayPlan {
  return {
    ...plan,
    segments: plan.segments.map((s) => ({
      ...s,
      actions: decomposeSegmentActions(s),
    })),
  };
}

/** A destination the planner may schedule (derived from the Spec's anchors). */
export interface PlanPlace {
  readonly id: string;
  readonly name: string;
  readonly kind: AnchorKind;
  readonly regionId: string;
}

export interface PlanRelation {
  readonly name: string;
  readonly summary: string;
  readonly affinity: number;
}

export interface DayPlanContext {
  readonly stream: MemoryStream;
  readonly agentId: string;
  readonly agentName: string;
  readonly identitySummary: string;
  readonly dayIndex: number;
  readonly nowSimTime: number;
  readonly idFactory: () => string;
  readonly llm?: LlmTextFn;
  readonly homeRegionId?: string;
  /** Spec `identity.homeAreaId` — sleep/wake at this resident's own bed. */
  readonly homeAreaId?: string;
  /** Spec `identity.workAreaId` — daytime work at this resident's shop. */
  readonly workAreaId?: string;
  /** From `identity.occupation` — the main source of schedule variety. */
  readonly occupation?: string;
  /** Named destinations across the whole town, not just the home region. */
  readonly places?: readonly PlanPlace[];
  /** Who this agent knows, so the model can plan around people. */
  readonly relations?: readonly PlanRelation[];
  /** Spec-authored anchor points (`entity.schedule`). */
  readonly schedule?: ReadonlyArray<{
    readonly hour: number;
    readonly regionId?: string;
    readonly activity: string;
  }>;
  /** Region whose social anchor the whole town treats as the evening hub. */
  readonly hubRegionId?: string;
  /** Pack clock: watch duty vs diurnal sleep. */
  readonly clockKind?: 'diurnal' | 'watch' | 'event';
}

export async function generateDayPlan(input: DayPlanContext): Promise<DayPlan> {
  const memories = input.stream.list(input.agentId);
  const ascii = isAsciiCopy(
    `${input.agentName}${input.identitySummary}${input.occupation ?? ''}`,
  );
  const ctx = retrieveMemories(
    memories,
    ascii
      ? `${input.agentName} ${input.occupation ?? ''} day goals ties plan`
      : `${input.agentName} ${input.occupation ?? ''} 日常 目标 关系 计划`,
    input.nowSimTime,
    { limit: 10 },
  );
  const home =
    input.homeRegionId ??
    input.hubRegionId ??
    input.places?.[0]?.regionId ??
    'home';
  const ownHome = (input.places ?? []).find((p) => p.id === input.homeAreaId);
  const ownWork = (input.places ?? []).find((p) => p.id === input.workAreaId);

  if (input.llm) {
    const reflections = memories
      .filter((m) => m.kind === 'reflection')
      .sort((a, b) => b.simTime - a.simTime)
      .slice(0, 3);
    const placeLines = (input.places ?? [])
      .slice(0, 24)
      .map((p) =>
        ascii
          ? `- ${p.id} (${p.name}, ${p.kind}, in ${p.regionId})`
          : `- ${p.id}（${p.name}，${p.kind}，位于 ${p.regionId}）`,
      )
      .join('\n');
    const relationLines = (input.relations ?? [])
      .slice(0, 8)
      .map((r) =>
        ascii
          ? `- ${r.name} (affinity ${r.affinity.toFixed(2)}): ${r.summary}`
          : `- ${r.name}（亲近度 ${r.affinity.toFixed(2)}）：${r.summary}`,
      )
      .join('\n');
    const specSchedule = (input.schedule ?? [])
      .map((s) =>
        ascii
          ? `- ${s.hour}:00 ${s.activity}${s.regionId ? ` (${s.regionId})` : ''}`
          : `- ${s.hour}:00 ${s.activity}${s.regionId ? `（${s.regionId}）` : ''}`,
      )
      .join('\n');
    const prompt = ascii
      ? `Write a one-day schedule for ${input.agentName} in English.
Identity: ${input.identitySummary}
Occupation: ${input.occupation ?? 'resident'}
Home: ${ownHome ? `${ownHome.name} (${ownHome.id})` : home}
Work: ${ownWork ? `${ownWork.name} (${ownWork.id})` : 'pick from the place list'}
${placeLines ? `Places (locationId must be one of these):\n${placeLines}` : ''}
${relationLines ? `Ties:\n${relationLines}` : ''}
${specSchedule ? `Fixed appointments (keep these):\n${specSchedule}` : ''}
${reflections.length ? `Recent reflections:\n${reflections.map((m) => `- ${m.text}`).join('\n')}` : ''}
Memories:
${ctx.map((m) => `- ${m.text}`).join('\n')}
Rules:
1. 6–9 segments covering 6:00–23:00, hours 0–23, no overlap.
2. The day should look like this occupation, not generic work/rest.
3. At least 2 segments leave home (work, shop, or gathering place).
4. Daytime must include a chance to meet someone.
5. Evening must include a social activity.
6. activity is a short English clause saying what they are doing.
Return a JSON array only: [{"startHour":8,"endHour":12,"activity":"English activity","locationId":"place-id"}]`
      : `用中文为 ${input.agentName} 安排一天的日程。
身份：${input.identitySummary}
职业：${input.occupation ?? '镇民'}
住所：${ownHome ? `${ownHome.name}（${ownHome.id}）` : home}
职场：${ownWork ? `${ownWork.name}（${ownWork.id}）` : '按职业在地点列表里选'}
${placeLines ? `镇上可去的地点（locationId 必须从这里选）：\n${placeLines}` : ''}
${relationLines ? `关系网：\n${relationLines}` : ''}
${specSchedule ? `固定安排（务必保留）：\n${specSchedule}` : ''}
${reflections.length ? `近期反思：\n${reflections.map((m) => `- ${m.text}`).join('\n')}` : ''}
相关记忆：
${ctx.map((m) => `- ${m.text}`).join('\n')}
要求：
1. 6–9 段，覆盖 6:00–23:00，小时为 0–23，段之间不要重叠。
2. 日程要体现这个职业的独特性，不要写成通用的"工作/休息"。
3. 至少有 2 段离开住所区域（去工作地点、店铺或公共集会处）。
4. 白天安排至少一段可能遇见别人的时段（午饭、歇脚或路过集会处）。
5. 傍晚再安排一段与他人碰面的社交活动。
6. activity 必须是中文短句，写明在做什么。
只返回 JSON 数组：[{"startHour":8,"endHour":12,"activity":"中文活动","locationId":"地点id"}]`;
    const raw = await input.llm(prompt);
    try {
      const start = raw.indexOf('[');
      const end = raw.lastIndexOf(']');
      const parsed = JSON.parse(raw.slice(start, end + 1)) as PlanSegment[];
      if (Array.isArray(parsed) && parsed.length >= 3) {
        const restPlace =
          ownHome ??
          (input.places ?? []).find(
            (p) => p.kind === 'rest' && p.regionId === home,
          );
        const segments = stampPlaceNames(
          fillPlanGaps(
            parsed,
            input.agentName,
            restPlace?.id ?? input.homeAreaId ?? home,
            ascii,
          ),
          input.places,
        );
        rememberPlan(input, segments);
        return enrichPlanWithActions({
          agentId: input.agentId,
          dayIndex: input.dayIndex,
          segments,
        });
      }
    } catch {
      /* fall through */
    }
  }

  const segments = stampPlaceNames(
    steerPlanWithMemories(occupationDayPlan(input), {
      agentName: input.agentName,
      places: input.places,
      relations: input.relations,
      memories: input.stream.list(input.agentId),
    }),
    input.places,
  );
  rememberPlan(input, segments);
  return enrichPlanWithActions({
    agentId: input.agentId,
    dayIndex: input.dayIndex,
    segments,
  });
}

function rememberPlan(
  input: {
    readonly stream: MemoryStream;
    readonly agentId: string;
    readonly nowSimTime: number;
    readonly idFactory: () => string;
  },
  segments: PlanSegment[],
): void {
  const ascii = isAsciiCopy(segments.map((s) => s.activity).join(''));
  input.stream.add(
    createMemoryEntry({
      id: input.idFactory(),
      agentId: input.agentId,
      kind: 'plan',
      text: ascii
        ? `Today's plan: ${segments
            .map(
              (s) =>
                `${s.startHour}-${s.endHour} ${s.activity}${
                  s.locationName ? ` (${s.locationName})` : ''
                }`,
            )
            .join('; ')}`
        : `今日计划：${segments
            .map(
              (s) =>
                `${s.startHour}-${s.endHour} ${s.activity}${
                  s.locationName ? `（${s.locationName}）` : ''
                }`,
            )
            .join('；')}`,
      simTime: input.nowSimTime,
      importance: 4,
    }),
  );
}

interface OccupationProfile {
  readonly match: RegExp;
  /** Morning shift as [startHour, endHour); may wrap past midnight. */
  readonly shift: readonly [number, number];
  readonly workText: string;
  readonly afternoonText: string;
  readonly workTextEn: string;
  readonly afternoonTextEn: string;
  readonly placeKinds: readonly AnchorKind[];
}

/**
 * Every resident used to share one schedule pinned to their home region, so
 * nobody ever crossed the town and nobody's day looked like their job.
 */
const OCCUPATIONS: readonly OccupationProfile[] = [
  {
    match: /面包|烘|baker|厨|cook/i,
    shift: [5, 12],
    workText: '在烤炉前烘面包',
    afternoonText: '给街坊送新出炉的面包',
    workTextEn: 'bakes bread at the oven',
    afternoonTextEn: 'delivers fresh loaves',
    placeKinds: ['food', 'commerce'],
  },
  {
    match: /铁匠|锻|打铁|smith|forge/i,
    shift: [8, 17],
    workText: '在炉前打铁',
    afternoonText: '修补邻居送来的工具',
    workTextEn: 'works the forge',
    afternoonTextEn: 'mends tools',
    placeKinds: ['work'],
  },
  {
    match: /教|老师|teacher|学堂|讲/i,
    shift: [8, 15],
    workText: '在学堂上课',
    afternoonText: '批改功课并准备明天的课',
    workTextEn: 'teaches class',
    afternoonTextEn: 'marks papers and preps tomorrow',
    placeKinds: ['learn'],
  },
  {
    match: /旅店|客栈|酒馆|掌柜|innkeeper|tavern|店主/i,
    shift: [11, 23],
    workText: '在吧台招呼客人',
    afternoonText: '给客人上酒并听他们讲镇上的事',
    workTextEn: 'tends the bar',
    afternoonTextEn: 'pours drinks and listens',
    placeKinds: ['social', 'commerce'],
  },
  {
    match: /商|货|摊|店|merchant|trader|shop/i,
    shift: [9, 18],
    workText: '看店记账',
    afternoonText: '去补货并和同行打听行情',
    workTextEn: 'keeps the shop books',
    afternoonTextEn: 'restocks and asks around',
    placeKinds: ['commerce'],
  },
  {
    match: /守卫|巡|兵|guard|watch/i,
    shift: [20, 4],
    workText: '沿街巡夜',
    afternoonText: '在岗哨上盯着来往行人',
    workTextEn: 'walks the night watch',
    afternoonTextEn: 'watches the gate',
    placeKinds: ['work', 'social'],
  },
  {
    match: /医|药|doctor|healer/i,
    shift: [8, 17],
    workText: '给来看病的人诊治',
    afternoonText: '出诊探访卧床的病人',
    workTextEn: 'sees patients',
    afternoonTextEn: 'makes house calls',
    placeKinds: ['work', 'learn'],
  },
  {
    match: /农|田|farm|种/i,
    shift: [6, 15],
    workText: '在田里干活',
    afternoonText: '把收成挑到集市上',
    workTextEn: 'works the fields',
    afternoonTextEn: 'carries harvest to market',
    placeKinds: ['work', 'commerce'],
  },
  {
    match: /邮|信|post|courier|矿|miner/i,
    shift: [8, 16],
    workText: '在镇上跑腿送信',
    afternoonText: '把路上听来的消息带回镇里',
    workTextEn: 'runs messages',
    afternoonTextEn: 'brings news back',
    placeKinds: ['work', 'commerce'],
  },
  {
    match: /学者|研究|抄写|scholar|scribe|书|library/i,
    shift: [9, 18],
    workText: '查阅典籍做笔记',
    afternoonText: '找人讨论没想通的问题',
    workTextEn: 'reads and takes notes',
    afternoonTextEn: 'talks through a puzzle',
    placeKinds: ['learn'],
  },
  {
    match: /学生|孩子|child|student/i,
    shift: [8, 15],
    workText: '在学堂上课',
    afternoonText: '和同伴在镇上乱跑',
    workTextEn: 'attends class',
    afternoonTextEn: 'runs around with friends',
    placeKinds: ['learn', 'social'],
  },
];

const DEFAULT_PROFILE: OccupationProfile = {
  match: /.^/,
  shift: [8, 17],
  workText: '在岗位上干活',
  afternoonText: '处理手上的杂务',
  workTextEn: 'works the post',
  afternoonTextEn: 'handles odd jobs',
  placeKinds: ['work'],
};

export function occupationProfileFor(text: string): OccupationProfile {
  return OCCUPATIONS.find((p) => p.match.test(text)) ?? DEFAULT_PROFILE;
}

function pickPlace(
  places: readonly PlanPlace[],
  kinds: readonly AnchorKind[],
  seed: string,
): PlanPlace | undefined {
  for (const kind of kinds) {
    const matches = places.filter((p) => p.kind === kind);
    const pick = stablePick(matches, seed);
    if (pick) return pick;
  }
  return undefined;
}

/**
 * The town's shared evening hub — everyone converges here, which is the point.
 * Picking by id alone chose whichever social anchor sorted first, which landed
 * the whole town in a cramped café; the main square must win.
 */
function townHub(
  places: readonly PlanPlace[],
  hubRegionId?: string,
): PlanPlace | undefined {
  const social = places.filter((p) => p.kind === 'social');
  if (!social.length) return undefined;
  const inHub = social.filter((p) => p.regionId === hubRegionId);
  const pool = inHub.length ? inHub : social;
  return [...pool].sort((a, b) => a.id.localeCompare(b.id))[0];
}

/**
 * Where this resident spends their public hour. The main square stays the
 * town's centre of gravity — sociable residents head straight there — but the
 * quieter half keeps to a local haunt, so the map has several small circles
 * instead of one queue outside the same café.
 */
function personalHub(
  places: readonly PlanPlace[],
  input: { hubRegionId?: string; homeRegionId?: string; seed: string },
  sociability: number,
): PlanPlace | undefined {
  const main = townHub(places, input.hubRegionId);
  if (sociability >= 0.55) return main;
  const social = places.filter((p) => p.kind === 'social');
  if (social.length <= 1) return main;
  const local = social.filter((p) => p.regionId === input.homeRegionId);
  const pool = (local.length ? local : social).filter(
    (p) => p.id !== main?.id,
  );
  return stablePick(pool.length ? pool : social, `hub:${input.seed}`) ?? main;
}

/** A destination outside the daily triangle of home / work / food. */
function errandPlace(
  places: readonly PlanPlace[],
  input: { seed: string; dayIndex: number; avoid: ReadonlySet<string> },
): PlanPlace | undefined {
  const pool = places.filter((p) => !input.avoid.has(p.id));
  if (!pool.length) return undefined;
  // Prefer somewhere that means running into other people.
  const social = pool.filter(
    (p) => p.kind === 'social' || p.kind === 'commerce' || p.kind === 'learn',
  );
  return stablePick(
    social.length ? social : pool,
    `errand:${input.seed}:${input.dayIndex}`,
  );
}

/**
 * The heuristic schedule. It only needs identity and geography, so it is typed
 * narrower than {@link DayPlanContext} and can be exercised on its own.
 */
export type OccupationPlanInput = Pick<
  DayPlanContext,
  | 'agentName'
  | 'homeRegionId'
  | 'homeAreaId'
  | 'workAreaId'
  | 'occupation'
  | 'places'
  | 'hubRegionId'
  | 'clockKind'
> &
  Partial<Pick<DayPlanContext, 'agentId' | 'identitySummary' | 'dayIndex'>>;

export function occupationDayPlan(input: OccupationPlanInput): PlanSegment[] {
  const name = input.agentName;
  const home =
    input.homeRegionId ??
    input.hubRegionId ??
    input.places?.[0]?.regionId ??
    'home';
  const places = input.places ?? [];
  const profile = occupationProfileFor(
    `${input.occupation ?? ''} ${input.identitySummary ?? ''}`,
  );
  const seed = input.agentId ?? name;
  const temperament = temperamentFor(
    seed,
    `${input.occupation ?? ''} ${input.identitySummary ?? ''}`,
  );
  // ±1h so the whole town does not move in lockstep; the scattered half of the
  // town drifts up to ±2h so shifts do not all start on the same beat.
  const driftSpan = temperament.punctuality < 0.4 ? 2 : 1;
  const drift =
    (Math.abs(hashStr(seed)) % (driftSpan * 2 + 1)) - driftSpan;
  const shiftIn = (h: number): number => ((h + drift + 24) % 24);

  const workPlace =
    places.find((p) => p.id === input.workAreaId) ??
    pickPlace(places, profile.placeKinds, `work:${input.agentId}`);
  const foodPlace = pickPlace(places, ['food'], `food:${input.agentId}`);
  const restPlace =
    places.find((p) => p.id === input.homeAreaId) ??
    places.find((p) => p.kind === 'rest' && p.regionId === home) ??
    pickPlace(places, ['rest'], `rest:${input.agentId}`);
  const hub = personalHub(
    places,
    { hubRegionId: input.hubRegionId, homeRegionId: input.homeRegionId, seed },
    temperament.sociability,
  );
  const homeId = restPlace?.id ?? input.homeAreaId ?? home;
  const workId = workPlace?.id ?? input.workAreaId ?? home;
  const foodId = foodPlace?.id ?? homeId;
  const hubId = hub?.id ?? home;
  const ascii = isAsciiCopy(
    `${name}${input.occupation ?? ''}${input.identitySummary ?? ''}`,
  );
  const workLine = ascii ? profile.workTextEn : profile.workText;
  const afternoonLine = ascii ? profile.afternoonTextEn : profile.afternoonText;
  const workWhere = workPlace
    ? ascii
      ? `at ${workPlace.name} `
      : `在${workPlace.name}`
    : '';
  const hubLabel =
    hub?.name ??
    (input.clockKind === 'watch'
      ? ascii
        ? 'mess'
        : '公共舱'
      : ascii
        ? 'gathering'
        : '集会处');
  const nightShift = profile.shift[0] > profile.shift[1];

  const segments: PlanSegment[] = [];
  const push = (
    startHour: number,
    endHour: number,
    activity: string,
    locationId: string,
  ): void => {
    if (endHour <= startHour) return;
    segments.push({ startHour, endHour, activity, locationId });
  };

  if (input.clockKind === 'watch') {
    if (ascii) {
      push(0, 8, `${name} on watch`, workId);
      push(8, 9, `${name} eats and talks at ${hubLabel}`, hubId);
      push(9, 16, `${name} ${workWhere}${workLine}`, workId);
      push(16, 17, `${name} handoff at ${hubLabel}`, hubId);
      push(17, 24, `${name} rests in the bunks`, homeId);
    } else {
      push(0, 8, `${name} 值班`, workId);
      push(8, 9, `${name} 在${hubLabel}用餐碰面`, hubId);
      push(9, 16, `${name} ${workWhere}${workLine}`, workId);
      push(16, 17, `${name} 在${hubLabel}交班`, hubId);
      push(17, 24, `${name} 在铺位休息`, homeId);
    }
    return segments;
  }

  if (nightShift) {
    const offDuty = Math.max(1, shiftIn(profile.shift[1]));
    if (ascii) {
      push(0, offDuty, `${name} ${workLine}`, workId);
      push(offDuty, 12, `${name} sleeps at home`, homeId);
      push(12, 14, `${name} gets something to eat`, foodId);
      push(14, 17, `${name} ${afternoonLine}`, workId);
      push(17, 18, `${name} chats at ${hubLabel}`, hubId);
      push(18, 19, `${name} has dinner`, foodId);
      push(19, 24, `${name} ${workLine}`, workId);
    } else {
      push(0, offDuty, `${name} ${workLine}`, workId);
      push(offDuty, 12, `${name} 回住处补眠`, homeId);
      push(12, 14, `${name} 起来吃点东西`, foodId);
      push(14, 17, `${name} ${afternoonLine}`, workId);
      push(17, 18, `${name} 在${hubLabel}和人闲聊`, hubId);
      push(18, 19, `${name} 吃晚饭`, foodId);
      push(19, 24, `${name} ${workLine}`, workId);
    }
    return segments;
  }

  const workStart = Math.max(6, shiftIn(profile.shift[0]));
  const workEnd = Math.min(20, shiftIn(profile.shift[1]));
  const wake = Math.max(4, workStart - 1);
  if (ascii) {
    push(0, wake, `${name} sleeps at home`, homeId);
    push(wake, workStart, `${name} wakes, washes, breakfast`, homeId);
  } else {
    push(0, wake, `${name} 在住处睡觉`, homeId);
    push(wake, workStart, `${name} 起床洗漱吃早饭`, homeId);
  }
  const lunch = Math.min(Math.max(11, workStart + 3), 14);
  push(workStart, lunch, `${name} ${workWhere}${workLine}`, workId);
  push(lunch, lunch + 1, ascii ? `${name} has lunch` : `${name} 吃午饭`, foodId);
  const afterLunch = lunch + 1;
  const pauseAt = Math.min(
    Math.max(afterLunch + 1, 15),
    Math.max(afterLunch, workEnd - 1),
  );
  const errand = hasErrandToday(seed, input.dayIndex ?? 0, temperament.wanderlust)
    ? errandPlace(places, {
        seed,
        dayIndex: input.dayIndex ?? 0,
        avoid: new Set([homeId, workId, foodId]),
      })
    : undefined;
  const breaksRoutine = Boolean(errand) || temperament.sociability >= 0.45;
  if (
    breaksRoutine &&
    workEnd - afterLunch >= 3 &&
    pauseAt > afterLunch &&
    pauseAt < workEnd
  ) {
    push(afterLunch, pauseAt, `${name} ${afternoonLine}`, workId);
    // An errand is the day's off-route beat: it puts this resident somewhere
    // their schedule never sends them, next to people they never meet.
    push(
      pauseAt,
      pauseAt + 1,
      errand
        ? ascii
          ? `${name} runs an errand at ${errand.name}`
          : `${name} 临时去${errand.name}办点事`
        : ascii
          ? `${name} pauses at ${hubLabel} to see who is around`
          : `${name} 在${hubLabel}歇脚，看看谁在`,
      errand ? errand.id : hubId,
    );
    push(pauseAt + 1, workEnd, `${name} ${afternoonLine}`, workId);
  } else {
    push(afterLunch, workEnd, `${name} ${afternoonLine}`, workId);
  }
  // Public time is where conversations happen, so *when* it lands matters more
  // than whether it happens. Outgoing residents go straight from work to the
  // hub and linger; quiet ones eat first and drop by at the end of the evening.
  const eveningRoom = Math.max(0, 21 - workEnd);
  const hubSpan = Math.min(
    temperament.sociability >= 0.6 ? 2 : 1,
    Math.max(0, eveningRoom - 1),
  );
  const hubLine = ascii
    ? `${name} chats with neighbors at ${hubLabel}`
    : `${name} 在${hubLabel}和邻居闲聊`;
  const dinnerLine = ascii ? `${name} has dinner` : `${name} 吃晚饭`;
  if (temperament.sociability >= 0.35) {
    push(workEnd, workEnd + hubSpan, hubLine, hubId);
    push(workEnd + hubSpan, 21, dinnerLine, foodId);
  } else {
    const dinnerEnd = Math.min(21, workEnd + Math.max(1, eveningRoom - hubSpan));
    push(workEnd, dinnerEnd, dinnerLine, foodId);
    push(dinnerEnd, 21, hubLine, hubId);
  }
  push(
    21,
    23,
    ascii
      ? `${name} winds down at home, thinking over the day`
      : `${name} 在住处歇着，想想今天的事`,
    homeId,
  );
  push(
    23,
    24,
    ascii ? `${name} sleeps at home` : `${name} 在住处睡觉`,
    homeId,
  );
  return segments;
}

/**
 * When the model is not available, still let yesterday's reflections move
 * today's feet — otherwise every new day is the same occupation template.
 */
export function steerPlanWithMemories(
  segments: PlanSegment[],
  input: {
    readonly agentName: string;
    readonly places?: readonly PlanPlace[];
    readonly relations?: readonly PlanRelation[];
    readonly memories?: ReadonlyArray<{ kind: string; text: string }>;
  },
): PlanSegment[] {
  const reflections = (input.memories ?? []).filter(
    (m) => m.kind === 'reflection',
  );
  const texts = reflections.map((m) => m.text).join('\n');
  if (!texts.trim() || !segments.length) return segments;

  const places = input.places ?? [];
  const placeHit = places.find(
    (p) => p.name.length >= 2 && texts.includes(p.name),
  );
  const personHit = (input.relations ?? []).find(
    (r) => r.name.length >= 2 && texts.includes(r.name),
  );
  if (!placeHit && !personHit) return segments;

  const idx = segments.findIndex(
    (s) =>
      s.startHour >= 12 &&
      s.startHour < 19 &&
      !/睡|休息|补眠|sleep|rest/i.test(s.activity),
  );
  if (idx < 0) return segments;

  const hub = places.find((p) => p.kind === 'social');
  const dest = placeHit ?? hub;
  if (!dest) return segments;

  const ascii = isAsciiCopy(`${input.agentName}${texts}`);
  const next = [...segments];
  const who = personHit
    ? ascii
      ? `looking for ${personHit.name}`
      : `找${personHit.name}`
    : ascii
      ? `follow up on yesterday`
      : `办昨天记下的事`;
  next[idx] = {
    ...next[idx]!,
    locationId: dest.id,
    activity: ascii
      ? `${input.agentName} goes to ${dest.name} to ${who}`
      : `${input.agentName} 去${dest.name}${who}`,
  };
  return next;
}

/** True when the segments leave no uncovered hour in [0, 24). */
export function planCoversDay(segments: readonly PlanSegment[]): boolean {
  const sorted = [...segments].sort((a, b) => a.startHour - b.startHour);
  let cursor = 0;
  for (const s of sorted) {
    if (s.startHour > cursor) return false;
    cursor = Math.max(cursor, s.endHour);
    if (cursor >= 24) return true;
  }
  return cursor >= 24;
}

/**
 * Model-authored plans routinely skip the small hours. Pad the gaps with rest
 * at home so `segmentAt` never returns null.
 */
export function fillPlanGaps(
  segments: readonly PlanSegment[],
  name: string,
  homeLocationId?: string,
  ascii = isAsciiCopy(name),
): PlanSegment[] {
  const sorted = [...segments]
    .filter((s) => Number.isFinite(s.startHour) && Number.isFinite(s.endHour))
    .map((s) => ({
      ...s,
      startHour: Math.max(0, Math.min(24, s.startHour)),
      endHour: Math.max(0, Math.min(24, s.endHour)),
    }))
    .filter((s) => s.endHour > s.startHour)
    .sort((a, b) => a.startHour - b.startHour);
  const out: PlanSegment[] = [];
  let cursor = 0;
  for (const s of sorted) {
    if (s.startHour > cursor) {
      out.push({
        startHour: cursor,
        endHour: s.startHour,
        activity: ascii ? `${name} rests at home` : `${name} 在住处休息`,
        locationId: homeLocationId,
      });
    }
    if (s.endHour <= cursor) continue;
    out.push({ ...s, startHour: Math.max(s.startHour, cursor) });
    cursor = s.endHour;
  }
  if (cursor < 24) {
    out.push({
      startHour: cursor,
      endHour: 24,
      activity: ascii ? `${name} rests at home` : `${name} 在住处休息`,
      locationId: homeLocationId,
    });
  }
  return out;
}

/** @deprecated Kept for callers without place/occupation context. */
export function heuristicDayPlan(
  name: string,
  homeRegionId = 'home',
): PlanSegment[] {
  return occupationDayPlan({
    agentId: name,
    agentName: name,
    identitySummary: name,
    homeRegionId,
  });
}

/** Break current plan and replan from now (interrupt). */
export async function replanFromNow(
  input: Parameters<typeof generateDayPlan>[0] & {
    readonly reason: string;
    readonly hourOfDay: number;
    /**
     * What the interruption demands right now (e.g. "去找点吃的"). Inserted
     * ahead of the regenerated schedule, otherwise a replan triggered by hunger
     * would hand back the same day and the drive would never be satisfied.
     */
    readonly urgentActivity?: string;
    readonly urgentLocationId?: string;
  },
): Promise<DayPlan> {
  input.stream.add(
    createMemoryEntry({
      id: input.idFactory(),
      agentId: input.agentId,
      kind: 'observation',
      text: isAsciiCopy(`${input.agentName}${input.reason}`)
        ? `interrupted: ${input.reason}`
        : `被打断：${input.reason}`,
      simTime: input.nowSimTime,
      importance: 5,
    }),
  );
  const plan = await generateDayPlan(input);
  const remaining = plan.segments.filter((s) => s.endHour > input.hourOfDay);
  if (!input.urgentActivity) return { ...plan, segments: remaining };
  const urgent: PlanSegment = {
    startHour: input.hourOfDay,
    endHour: Math.min(24, input.hourOfDay + 1),
    activity: input.urgentActivity,
    locationId: input.urgentLocationId,
  };
  return {
    ...plan,
    segments: [
      { ...urgent, actions: decomposeSegmentActions(urgent) },
      ...remaining,
    ],
  };
}
