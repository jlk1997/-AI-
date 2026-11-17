/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Machine-readable "what the user actually asked for" list.
 *
 * Every gate we had verified generic playability: it boots, something moves,
 * a win state is reachable. None of them asked whether the delivered game
 * contains the mechanic the user requested, so "做一个可以钓鱼的游戏" could pass
 * every check with no fishing in it. This module turns the free-text prompt into
 * a small set of named features, each carrying the static signals that prove the
 * feature landed, so {@link ./requirementGate.ts} can check them.
 *
 * Deliberately keyword-driven rather than a second LLM round: a wrong "missing"
 * verdict costs a FIX round out of the generation budget, so we only ever claim
 * a requirement we can describe precisely. Anything the lexicon does not know
 * stays unclaimed instead of being guessed at.
 */

import * as fsp from 'node:fs/promises';
import * as fs from 'node:fs';
import * as path from 'node:path';

import type { MechanicSpec } from './mechanicSpec.js';

/** Where a feature's evidence is expected to live. */
export type RequirementScope = 'code' | 'dsl' | 'either';

export interface RequiredFeature {
  readonly id: string;
  /** Chinese label — goes into user-facing events and the FIX prompt. */
  readonly label: string;
  readonly source: 'prompt' | 'params' | 'gdd';
  /** Regex sources; a feature counts as present at `minSignals` distinct hits. */
  readonly signals: readonly string[];
  /**
   * Some words appear in incidental dialogue copy ("我去钓鱼了"), so features
   * whose name is also ordinary speech need a second, mechanical signal.
   */
  readonly minSignals: number;
  readonly scope: RequirementScope;
  /** Concrete instruction handed to the coder when the feature is missing. */
  readonly hint: string;
}

export interface RequirementSpec {
  readonly schema: 'opengame-requirements-v1';
  readonly prompt: string;
  readonly features: readonly RequiredFeature[];
  readonly updatedAt: string;
}

export const REQUIREMENT_SPEC_FILE = '.opengame-requirements.json';
/** Also published with the build so the delivered artifact states its contract. */
export const REQUIREMENT_PUBLIC_FILE = 'REQUIREMENTS.json';

interface LexiconEntry {
  readonly id: string;
  readonly label: string;
  /** Matches the user's prompt. */
  readonly match: RegExp;
  readonly signals: readonly string[];
  readonly minSignals?: number;
  readonly scope?: RequirementScope;
  readonly hint: string;
}

/**
 * Mechanics users ask for often enough to be worth verifying, each with the
 * identifiers a real implementation cannot avoid writing.
 */
const LEXICON: readonly LexiconEntry[] = [
  {
    id: 'pvp',
    label: '双人对战 / 同屏双人',
    match: /双人|两个玩家|2\s*p\b|pvp|对战|对打/i,
    signals: ['player2|playerTwo|p2(?:Score|Hp|Key)|pvp', 'addKeys\\('],
    hint: '第二套输入键位（如 WASD vs 方向键）+ 第二个玩家实体 player2，双方状态各自结算',
  },
  {
    id: 'boss',
    label: 'Boss 战',
    match: /boss|首领|头目|最终.{0,4}战|大魔王/i,
    signals: ['\\bboss\\b', 'bossHp|bossPresent|bossAlive'],
    hint: 'Boss 实体 + bossHp/bossPresent 状态 + 击败后进入胜利结算',
  },
  {
    id: 'fishing',
    label: '钓鱼',
    match: /钓鱼|钓魚|fishing|钓竿/i,
    signals: ['fish|钓鱼|钓竿', 'cast|bite|hook|抛竿|上钩|收竿|鱼获'],
    minSignals: 2,
    hint: '抛竿→等待咬钩→收竿判定的可重复循环，产出物进入分数或背包',
  },
  {
    id: 'shop',
    label: '商店 / 购买',
    match: /商店|商铺|购买|买东西|shop\b|store\b/i,
    signals: ['shop|商店|购买|buy', 'coin|gold|money|金币|price|价格|cost'],
    minSignals: 2,
    hint: '商店界面 + 货币扣减 + 购得物影响玩法（不是纯文本对话）',
  },
  {
    id: 'inventory',
    label: '背包 / 物品栏',
    match: /背包|物品栏|inventory|道具栏/i,
    signals: ['inventory|背包|物品栏', 'addItem|items\\[|itemCount'],
    hint: '可增删的物品集合 + 打开查看的 UI',
  },
  {
    id: 'save',
    label: '存档 / 进度保存',
    match: /存档|读档|保存进度|save\s*(?:game|slot)|localStorage/i,
    signals: ['localStorage|saveGame|saveSlot|存档'],
    hint: 'localStorage 写入与读回，重开后进度延续',
  },
  {
    id: 'multiEnding',
    label: '多结局',
    match: /多结局|多个结局|不同结局|multiple\s+endings|good\s+end/i,
    signals: ['ending_[ab]|endings\\b|多结局', 'ending'],
    hint: '至少两个可达结局，由玩家选择或状态分流决定',
  },
  {
    id: 'dialogueChoice',
    label: '对话选项 / 分支',
    match: /对话选项|选项|分支对话|branching|choice/i,
    signals: ['ChoicePanel|choices|selectChoice|选项'],
    hint: 'ChoicePanel 呈现选项并 on("selected")→selectChoice 推进分支',
  },
  {
    id: 'skill',
    label: '技能 / 升级成长',
    match: /技能树|技能|升级|成长|skill\s*tree|level\s*up/i,
    signals: ['skill|技能|levelUp|升级', 'level|exp|经验'],
    minSignals: 2,
    hint: '经验或资源累积 → 解锁并可感知地改变数值/能力',
  },
  {
    id: 'crafting',
    label: '合成 / 制作',
    match: /合成|制作|craft|配方|recipe/i,
    signals: ['craft|合成|recipe|配方', 'inventory|items|材料'],
    minSignals: 2,
    hint: '材料消耗 + 配方判定 + 产出物进入背包',
  },
  {
    id: 'farming',
    label: '种植 / 农场',
    match: /种地|种植|农场|farming|作物|浇水/i,
    signals: ['farm|crop|种植|作物|plant', 'water|grow|浇水|成熟|harvest|收获'],
    minSignals: 2,
    hint: '播种→生长（计时）→收获的可重复循环',
  },
  {
    id: 'stealth',
    label: '潜行 / 躲避视野',
    match: /潜行|躲避|不被发现|stealth|sneak/i,
    signals: ['stealth|潜行|detect|视野|suspicion|警戒'],
    hint: '敌方视野/警戒值 + 被发现的失败或惩罚',
  },
  {
    id: 'puzzle',
    label: '解谜 / 机关',
    match: /解谜|谜题|机关|开关|puzzle|riddle/i,
    signals: ['puzzle|解谜|机关|lever|switch|开关', 'solved|unlock|开启'],
    minSignals: 2,
    hint: '有解的谜题状态机 + 解开后世界发生可见变化',
  },
  {
    id: 'timeLimit',
    label: '限时 / 倒计时',
    match: /限时|倒计时|时间限制|countdown|time\s*limit/i,
    signals: ['countdown|timeLeft|timer|倒计时|限时'],
    hint: '递减计时器 + 归零判负，HUD 常显剩余时间',
  },
  {
    id: 'leaderboard',
    label: '排行榜 / 最高分',
    match: /排行榜|最高分|highscore|leaderboard|best\s*score/i,
    signals: ['highScore|bestScore|leaderboard|排行榜|最高分'],
    hint: '最高分持久化并在标题或结算界面展示',
  },
  {
    id: 'dayNight',
    label: '昼夜 / 时间流转',
    match: /昼夜|白天.{0,4}夜晚|日夜|day.?night|时辰/i,
    signals: ['dayNight|昼夜|isNight|timeOfDay|时辰'],
    hint: '时间推进改变画面色调，并影响至少一条玩法规则',
  },
  {
    id: 'weather',
    label: '天气',
    match: /天气|下雨|下雪|weather|rain|snow/i,
    signals: ['weather|天气|rain|snow|下雨|下雪'],
    hint: '天气状态切换 + 可见的视觉表现',
  },
  {
    id: 'pet',
    label: '宠物 / 同伴',
    match: /宠物|同伴|伙伴|pet\b|companion/i,
    signals: ['pet|companion|同伴|宠物|伙伴', 'follow|跟随'],
    minSignals: 2,
    hint: '跟随玩家的同伴实体，且对玩法有实际作用',
  },
  {
    id: 'racing',
    label: '竞速 / 赛道',
    match: /赛车|竞速|赛道|racing|圈数|\blap\b/i,
    signals: ['lap|race|赛道|圈数|checkpoint'],
    hint: '圈数或检查点计数 + 计时结算',
  },
  {
    id: 'tower',
    label: '塔防 / 布防',
    match: /塔防|防守|布防|tower\s*defense|炮塔/i,
    signals: ['tower|炮塔|turret|布防', 'wave|波次|spawn'],
    minSignals: 2,
    hint: '可放置的防御单位 + 成波来袭的敌人 + 漏怪扣血',
  },
  {
    id: 'boardTurn',
    label: '棋盘回合 / 点选走子',
    match: /棋盘|走子|点选|回合棋|board\s*game|将死|五连/i,
    signals: ['legalMoves', 'BoardTurn|module-board|cell-select|applyMove'],
    hint: '点选棋子或落点，轮流，非法格不可走，胜负由规则表判定',
  },
  {
    id: 'xiangqi',
    label: '中国象棋',
    match: /中国象棋|xiangqi|(?<!国际)象棋/i,
    signals: [
      'XiangqiRules|rulesForBoardKind\\(\'xiangqi\'\\)|9×10',
      'legalMoves|将死|kind === \'G\'',
    ],
    minSignals: 2,
    hint: '9×10 红黑棋盘 + legalMoves/applyMove + 将死结束，禁止空格加分壳',
  },
  {
    id: 'gomoku',
    label: '五子棋',
    match: /五子棋|gomoku|连五|连珠/i,
    signals: ['GomokuRules|rulesForBoardKind\\(\'gomoku\'\\)', 'five|五子|legalMoves'],
    minSignals: 2,
    hint: '15×15 落子 + 五连判定，规则 import @opengame/module-board',
  },
  {
    id: 'chess',
    label: '国际象棋',
    match: /国际象棋|\bchess\b/i,
    signals: ['ChessRules|rulesForBoardKind\\(\'chess\'\\)', 'legalMoves'],
    minSignals: 2,
    hint: '8×8 点选走子 + legalMoves，不要做成横版跳跃',
  },
  {
    id: 'match3',
    label: '三消棋盘',
    match: /消消乐|三消|match[\s-]?3/i,
    signals: ['Match3Rules|findMatches|applySwap', 'legalSwaps'],
    hint: '相邻交换 + 三连消除，import Match3Rules，不是消消乐成品工程',
  },
  {
    id: 'cards',
    label: '卡牌手牌',
    match: /卡牌|手牌|抽牌|打牌/i,
    signals: ['draw\\(|playCard|CardHand', 'hand'],
    hint: '抽牌/出牌/弃牌，import @opengame/module-cards',
  },
  {
    id: 'danmaku',
    label: '弹幕发射',
    match: /弹幕|bullet\s*hell|danmaku|发射器/i,
    signals: ['emitRadial|stepBullets|BulletEmitter', 'bullet'],
    hint: '发射器 + 步进弹幕，import @opengame/module-emitter',
  },
];

/** Requirement ids the pipeline can be told about directly, outside the prompt. */
const VARIANT_FEATURES: Record<string, string> = { pvp: 'pvp' };

function entryToFeature(
  entry: LexiconEntry,
  source: RequiredFeature['source'],
): RequiredFeature {
  return {
    id: entry.id,
    label: entry.label,
    source,
    signals: entry.signals,
    minSignals: entry.minSignals ?? 1,
    scope: entry.scope ?? 'either',
    hint: entry.hint,
  };
}

/**
 * Read the requirements out of a prompt.
 *
 * `designBrief` is folded in because the intake interview is where users spell
 * out mechanics they only gestured at in the one-line prompt.
 */
export function extractRequirements(
  userPrompt: string,
  options?: {
    readonly designBrief?: string | null;
    readonly variant?: string | null;
    readonly gdd?: string | null;
    /** Named loops from MechanicSpec — including custom promises not in LEXICON. */
    readonly mechanic?: MechanicSpec | null;
  },
): RequirementSpec {
  const brief = options?.designBrief?.trim() ?? '';
  // The GDD is included as a *matching* surface but never as evidence: it says
  // what was designed, not what was built.
  const haystack = [userPrompt, brief, options?.gdd ?? ''].join('\n');
  const byId = new Map<string, RequiredFeature>();

  for (const entry of LEXICON) {
    // Only the user's own words may create a requirement; the GDD can restate
    // one we already found but must not invent obligations of its own.
    if (entry.match.test(`${userPrompt}\n${brief}`)) {
      byId.set(entry.id, entryToFeature(entry, 'prompt'));
    } else if (options?.gdd && entry.match.test(haystack)) {
      byId.set(entry.id, entryToFeature(entry, 'gdd'));
    }
  }

  const variantId = options?.variant ? VARIANT_FEATURES[options.variant] : undefined;
  if (variantId) {
    const entry = LEXICON.find((e) => e.id === variantId);
    if (entry) byId.set(entry.id, entryToFeature(entry, 'params'));
  }

  for (const loop of options?.mechanic?.loops ?? []) {
    if (byId.has(loop.id)) continue;
    byId.set(loop.id, {
      id: loop.id,
      label: loop.label,
      source: 'prompt',
      signals: loop.signals,
      minSignals: 1,
      scope: 'either',
      hint: loop.hint ?? `实现「${loop.label}」循环，门禁验这条承诺而不是验街机桶`,
    });
  }

  return {
    schema: 'opengame-requirements-v1',
    prompt: userPrompt.slice(0, 2000),
    features: [...byId.values()],
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Persist the spec next to the other pipeline metadata, and into `public/` so
 * the published build carries the contract it was held to.
 */
export async function writeRequirementSpec(
  workspace: string,
  spec: RequirementSpec,
): Promise<void> {
  const body = JSON.stringify(spec, null, 2);
  await fsp.writeFile(path.join(workspace, REQUIREMENT_SPEC_FILE), body, 'utf8');
  const publicDir = path.join(workspace, 'public');
  await fsp.mkdir(publicDir, { recursive: true }).catch(() => {});
  await fsp
    .writeFile(path.join(publicDir, REQUIREMENT_PUBLIC_FILE), body, 'utf8')
    .catch(() => {
      /* public/ is optional on some archetypes */
    });
}

export function readRequirementSpec(workspace: string): RequirementSpec | null {
  for (const rel of [REQUIREMENT_SPEC_FILE, path.join('public', REQUIREMENT_PUBLIC_FILE)]) {
    const file = path.join(workspace, rel);
    if (!fs.existsSync(file)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as RequirementSpec;
      if (parsed?.schema === 'opengame-requirements-v1' && Array.isArray(parsed.features)) {
        return parsed;
      }
    } catch {
      // fall through to the next candidate
    }
  }
  return null;
}

/** Maximum features restated in a prompt, so this block cannot bloat a round. */
const CODER_PROMPT_FEATURE_CAP = 8;

/** Summary for the coder prompt, so the ask is restated where it is acted on. */
export function formatRequirementsForCoder(spec: RequirementSpec | null): string | null {
  if (!spec || spec.features.length === 0) return null;
  // What the user said outranks what the GDD inferred, so it survives the cap.
  const ordered = [...spec.features].sort((a, b) => {
    const rank = (f: RequiredFeature): number => (f.source === 'gdd' ? 1 : 0);
    return rank(a) - rank(b);
  });
  const shown = ordered.slice(0, CODER_PROMPT_FEATURE_CAP);
  const lines = shown.map((f) => `  - ${f.label}：${f.hint}`);
  if (ordered.length > shown.length) {
    lines.push(`  - （其余 ${ordered.length - shown.length} 项见 REQUIREMENTS.json）`);
  }
  return [
    '- **用户点名要求的玩法（必须真的实现，门禁会检查）**：',
    ...lines,
  ].join('\n');
}
