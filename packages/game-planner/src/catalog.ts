/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Living capability directory. Add a module when a loop class keeps failing
 * the gate — never add a sixth exclusive archetype bucket or a finished game.
 */

import type { CapabilityEntry, MechanicModule } from './types.js';

/** Scene class bound when the module is in MechanicSpec.modules. */
export const MODULE_CAPABILITY_SCENES: Readonly<
  Partial<Record<MechanicModule, string>>
> = {
  board: 'BoardTurnScene',
  match: 'Match3Scene',
  cards: 'CardsHandScene',
  emitter: 'EmitterScene',
};

export const CAPABILITY_ENTRIES: readonly CapabilityEntry[] = [
  {
    id: 'platform',
    pkg: '@opengame/module-platform',
    useWhen: '音效 / 暂停 / 镜头 / 对话框 juice，所有循环都该留着',
    api: 'PlatformSceneHelper / GameUiKit',
  },
  {
    id: 'board',
    pkg: '@opengame/module-board',
    useWhen: '棋盘回合、点选走子、将死 / 五连',
    api: 'rulesForBoardKind / legalMoves / applyMove / winner',
  },
  {
    id: 'match',
    pkg: '@opengame/module-board',
    useWhen: '三消交换、连消计分 — 能力表，不是消消乐成品',
    api: 'Match3Rules / findMatches / legalSwaps / applySwap',
  },
  {
    id: 'cards',
    pkg: '@opengame/module-cards',
    useWhen: '手牌、抽牌、出牌、弃牌 — 能力，不是卡牌成品工程',
    api: 'createStarterDeck / draw / playCard / discardCard',
  },
  {
    id: 'emitter',
    pkg: '@opengame/module-emitter',
    useWhen: '弹幕发射、步进、命中检测 — 能力，不是弹幕成品工程',
    api: 'emitRadial / stepBullets / hitTest',
  },
  {
    id: 'td',
    pkg: '@opengame/module-td',
    useWhen: '波次、布防、漏怪扣血',
    api: 'WaveManager / EconomyManager',
  },
  {
    id: 'dialogue',
    pkg: '@opengame/module-dialogue',
    useWhen: '对话选项、章节、分支',
    api: 'DialogueManager + ChoicePanel',
  },
  {
    id: 'combat',
    pkg: '@opengame/module-combat',
    useWhen: '回合战斗、HP、胜负回调',
    api: 'TurnManager',
  },
  {
    id: 'world',
    pkg: '@opengame/module-world',
    useWhen: '俯视区域、门户、走动探索',
    api: 'WorldSceneHelper',
  },
  {
    id: 'systems',
    pkg: '@opengame/module-systems',
    useWhen: '背包、商店、合成、任务 DAG',
    api: 'inventory / shop / craft / quest',
  },
];

export const MODULE_EXTRA_SCENES = MODULE_CAPABILITY_SCENES;

export function formatCapabilityCatalogForCoder(
  modules?: readonly MechanicModule[] | null,
): string {
  const wanted = new Set(modules ?? CAPABILITY_ENTRIES.map((e) => e.id));
  const lines = CAPABILITY_ENTRIES.filter((e) => wanted.has(e.id)).map(
    (e) => `  - ${e.pkg}：${e.api}（${e.useWhen}）`,
  );
  return [
    '【能力目录 — 按 loops 组合 import，缺循环就加模块，不加第 6 个桶】',
    ...lines,
  ].join('\n');
}
