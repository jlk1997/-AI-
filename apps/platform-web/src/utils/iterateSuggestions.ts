/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Post-success / empty-state iterate prompts for multiturn UX.
 */

export type IteratePromptKind = 'platformer' | 'narrative' | 'generic' | 'world';

/** Map QuickActions keys → concrete Chinese prompts the worker ChangePlan can parse. */
export const QUICK_ACTION_PROMPTS: Record<string, string> = {
  'main-quest': '加一条主线任务：对话推进并在通关时触发结局',
  'side-quest': '给铁匠加一条可接取支线任务，并补三句对话',
  dialogue: '给 ChapterScene 加对话选项，选项影响结局（优先改 public/story/*.json）',
  'player-stats': '给玩家加可显示的生命值 HUD，受伤和回复要看得见',
  inventory: '加简单背包：拾取道具后 HUD 显示物品名',
  skills: '加一个技能按键（如 J），释放时有特效和冷却',
  battle: '加强回合战斗：玩家与敌人轮流行动，胜负跳转结局',
  'real-time': '把战斗改成即时接触伤害，闪避要有反馈',
  enemies: '多加两类敌人，行为与血量要有区别',
  'world-map': '加可切换的小地图或区域提示，别动 Title 场景',
  'save-system': '加本地存档：记录进度与对话 flag，读档后可继续',
  audio: '补上 BGM 与胜负音效，别删现有 PlatformSceneHelper 接线',
  harder: '更难一点，多几个敌人',
  boss: '加一个 Boss，保留 bossPresent 标记',
  cyber: '画风换成赛博朋克',
};

export function resolveQuickActionPrompt(type: string): string {
  return (
    QUICK_ACTION_PROMPTS[type] ??
    `请增量实现「${type}」相关玩法，点名要改的场景，不要整盘重写`
  );
}

export function detectIterateKind(options: {
  readonly generationMode?: 'game' | 'world';
  readonly recentSummaries?: readonly string[];
  readonly lastUserPrompt?: string | null;
}): IteratePromptKind {
  if (options.generationMode === 'world') return 'world';
  const blob = [
    options.lastUserPrompt ?? '',
    ...(options.recentSummaries ?? []),
  ].join('\n');
  if (/剧情|对话|小镇|NPC|STORY|chapter|ui_heavy|视觉小说|选项影响/i.test(blob)) {
    return 'narrative';
  }
  if (/跑酷|平台|横版|Neon|关卡|Boss|赛博|platform/i.test(blob)) {
    return 'platformer';
  }
  return 'generic';
}

export const SHARE_TO_COMMUNITY_PROMPT = '把当前作品分享到社区';

export function isShareToCommunityPrompt(prompt: string): boolean {
  const p = prompt.trim();
  return (
    p === SHARE_TO_COMMUNITY_PROMPT ||
    /分享到社区|share\s*to\s*community/i.test(p)
  );
}

export function buildSuccessIteratePrompts(
  kind: IteratePromptKind,
): string[] {
  // Share is a dedicated CTA in the chat card — not a fake "prompt" row.
  switch (kind) {
    case 'narrative':
      return [
        '给铁匠加三句对话，别动标题',
        '加一个对话选项，选「离开」走另一结局',
        '给向导加一条支线任务',
      ];
    case 'platformer':
      return [
        '第1关多一个金币',
        '更难一点，加一个 Boss',
        '画风换成赛博朋克',
      ];
    case 'world':
      return [
        '给铁匠加三句新台词',
        '扩展一片森林区域',
        '给矿工加一条支线任务',
      ];
    default:
      return [
        '更难一点',
        '加一段对话或 NPC',
        '换个画风再美化一点',
      ];
  }
}

export function emptyStateGameChips(): Array<{
  label: string;
  prompt: string;
  recommended?: boolean;
}> {
  return [
    {
      label: '小镇剧情',
      prompt: '做一个小镇剧情：3 个 NPC、2 个任务、对话选项影响结局',
      recommended: true,
    },
    {
      label: '霓虹跑酷',
      prompt: '做一个横版霓虹跑酷，两关，可玩平台跳跃',
    },
    {
      label: '回合 RPG',
      prompt: '做一个短篇 RPG：对话章节 + 回合战斗 + 结局',
    },
    {
      label: '塔防',
      prompt: '做一个简单塔防：放塔、几波敌人、胜负结算',
    },
  ];
}
