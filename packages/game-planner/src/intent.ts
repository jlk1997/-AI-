/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Compile-time IR. MechanicSpec is synthesized from this — GDD is the manual.
 */

import {
  detectArcadeHint,
  detectBoardKind,
  hasCardsHint,
  hasDialogueHint,
  hasEmitterHint,
  hasExploreHint,
  isMixedWorldAndBoard,
  isRedoPrompt,
} from './detect.js';
import { extractCustomLoops } from './loops.js';
import type {
  ArcadeCarrier,
  BoardKind,
  GameArchetypeHint,
  GameIntent,
  MechanicInput,
  MechanicModule,
  MechanicSpace,
  MechanicTime,
  MechanicWin,
  NamedLoop,
} from './types.js';

export function inferGameIntent(
  userPrompt: string,
  designBrief?: string | null,
): GameIntent {
  const hay = `${userPrompt}\n${designBrief ?? ''}`;
  const boardKind = detectBoardKind(hay);
  const arcadeHint = detectArcadeHint(hay, boardKind);
  const mixed = isMixedWorldAndBoard(hay, boardKind);
  const loopSeeds = seedLoops(hay, boardKind, arcadeHint);
  const moduleHints = seedModules(hay, boardKind, arcadeHint, mixed);
  return {
    schema: 'opengame-game-intent-v1',
    prompt: userPrompt.slice(0, 2000),
    redo: isRedoPrompt(userPrompt),
    boardKind,
    arcadeHint,
    spaceHints: seedSpaces(hay, boardKind),
    timeHints: seedTimes(hay, boardKind, arcadeHint),
    inputHints: seedInputs(hay, boardKind),
    winHints: seedWins(hay, boardKind, arcadeHint),
    moduleHints,
    loopSeeds,
    archetypeHint: inferArchetypeHint(hay, boardKind, mixed),
    mixed,
  };
}

export function inferArchetypeHint(
  hay: string,
  boardKind: BoardKind | null,
  mixed = isMixedWorldAndBoard(hay, boardKind),
): GameArchetypeHint {
  if (/视觉小说|galgame|纯对话/i.test(hay) && !hasExploreHint(hay)) {
    return 'ui_heavy';
  }
  if (/塔防|tower\s*defense/i.test(hay)) return 'tower_defense';
  if (mixed) return 'top_down';
  if (
    boardKind ||
    /贪吃蛇|2048|消消乐|三消|match[\s-]?3|五子棋|棋盘|象棋|\bchess\b/i.test(hay)
  ) {
    return 'grid_logic';
  }
  if (hasExploreHint(hay)) return 'top_down';
  return 'platformer';
}

function seedSpaces(hay: string, boardKind: BoardKind | null): MechanicSpace[] {
  const out: MechanicSpace[] = [];
  if (boardKind || /棋盘|格子/i.test(hay)) out.push('grid');
  if (hasExploreHint(hay)) out.push('top_down');
  if (/横版|侧视|platform/i.test(hay)) out.push('side');
  if (/视觉小说|纯对话|选项/i.test(hay)) out.push('ui');
  if (/塔防|路径|lane/i.test(hay)) out.push('path');
  return out;
}

function seedTimes(
  hay: string,
  boardKind: BoardKind | null,
  arcade: ArcadeCarrier | null,
): MechanicTime[] {
  const out: MechanicTime[] = [];
  if (boardKind || /回合|轮流|turn/i.test(hay)) out.push('turn');
  if (/波次|wave|塔防/i.test(hay)) out.push('wave');
  if (/步进|一格一格|step/i.test(hay)) out.push('step');
  if (
    arcade === 'snake' ||
    arcade === 'flappy' ||
    arcade === 'match3' ||
    /实时|realtime/i.test(hay)
  ) {
    out.push('realtime');
  }
  return out;
}

function seedInputs(hay: string, boardKind: BoardKind | null): MechanicInput[] {
  const out: MechanicInput[] = [];
  if (boardKind || /点选|走子|cell-select/i.test(hay)) out.push('cell-select');
  if (/放置|布防|place/i.test(hay)) out.push('place');
  if (/选项|choice|对话分支/i.test(hay)) out.push('choice');
  if (/点击|指针|pointer|tap/i.test(hay)) out.push('pointer');
  if (/方向键|wasd|键盘/i.test(hay)) out.push('keys');
  return out;
}

function seedWins(
  hay: string,
  boardKind: BoardKind | null,
  arcade: ArcadeCarrier | null,
): MechanicWin[] {
  const out: MechanicWin[] = [];
  if (boardKind || /将死|五连|checkmate/i.test(hay)) out.push('checkmate');
  if (/高分|分数|score/i.test(hay) || arcade === 'match3') out.push('score');
  if (/通关|旗子|flag/i.test(hay)) out.push('flag');
  if (/任务|结局|quest/i.test(hay)) out.push('quest');
  if (/生存|波次|survive/i.test(hay)) out.push('survive');
  return out;
}

function seedModules(
  hay: string,
  boardKind: BoardKind | null,
  arcade: ArcadeCarrier | null,
  mixed: boolean,
): MechanicModule[] {
  const out: MechanicModule[] = ['platform'];
  if (boardKind || arcade === 'board_turn') out.push('board');
  if (arcade === 'match3' || /消消乐|三消|match[\s-]?3/i.test(hay)) {
    out.push('match');
  }
  if (hasCardsHint(hay)) out.push('cards', 'systems');
  if (hasEmitterHint(hay)) out.push('emitter');
  if (/塔防|tower/i.test(hay)) out.push('td', 'world');
  if (hasDialogueHint(hay) || /对话|rpg|探索|小镇/i.test(hay) || mixed) {
    out.push('dialogue');
  }
  if (/战斗|打架|rpg|武侠/i.test(hay)) out.push('combat');
  if (/钓鱼|商店|背包|合成|rpg|探索/i.test(hay)) out.push('systems');
  if (hasExploreHint(hay) || mixed || /塔防/i.test(hay)) out.push('world');
  return [...new Set(out)];
}

function seedLoops(
  hay: string,
  boardKind: BoardKind | null,
  arcade: ArcadeCarrier | null,
): NamedLoop[] {
  const loops: NamedLoop[] = [];
  if (boardKind) {
    loops.push({
      id: 'boardTurn',
      label: '棋盘回合 / 点选走子',
      signals: ['legalMoves', 'BoardTurn|module-board|applyMove'],
      source: 'lexicon',
      hint: '点选棋子或落点，轮流，非法格不可走',
    });
    if (boardKind === 'xiangqi') {
      loops.push({
        id: 'xiangqi',
        label: '中国象棋',
        signals: ['XiangqiRules|rulesForBoardKind\\(\'xiangqi\'\\)|9×10', 'legalMoves'],
        source: 'lexicon',
        hint: '9×10、红黑、将死',
      });
    } else if (boardKind === 'gomoku') {
      loops.push({
        id: 'gomoku',
        label: '五子棋',
        signals: ['GomokuRules|rulesForBoardKind\\(\'gomoku\'\\)', 'five|五子'],
        source: 'lexicon',
      });
    } else if (boardKind === 'chess') {
      loops.push({
        id: 'chess',
        label: '国际象棋',
        signals: ['ChessRules|rulesForBoardKind\\(\'chess\'\\)', 'legalMoves'],
        source: 'lexicon',
      });
    }
  }
  if (arcade === 'match3' || /消消乐|三消|match[\s-]?3/i.test(hay)) {
    loops.push({
      id: 'match3',
      label: '三消棋盘',
      signals: ['Match3Rules|findMatches|applySwap', 'legalSwaps'],
      source: 'lexicon',
      hint: '相邻交换 + 三连消除，import @opengame/module-board Match3Rules，不是消消乐成品工程',
    });
  }
  if (hasCardsHint(hay)) {
    loops.push({
      id: 'cards',
      label: '卡牌手牌',
      signals: ['draw\\(|playCard|CardHand', 'hand'],
      source: 'lexicon',
      hint: '抽牌/出牌/弃牌，import @opengame/module-cards，不是卡牌成品工程',
    });
  }
  if (hasEmitterHint(hay)) {
    loops.push({
      id: 'danmaku',
      label: '弹幕发射',
      signals: ['emitRadial|stepBullets|BulletEmitter', 'bullet'],
      source: 'lexicon',
      hint: '发射器 + 步进弹幕，import @opengame/module-emitter，不是弹幕成品工程',
    });
  }
  if (/钓鱼|fishing/i.test(hay)) {
    loops.push({
      id: 'fishing',
      label: '钓鱼',
      signals: ['cast|bite|hook|抛竿', 'fish|钓鱼'],
      source: 'lexicon',
    });
  }
  if (/商店|购买|shop\b/i.test(hay)) {
    loops.push({
      id: 'shop',
      label: '商店',
      signals: ['shop|商店|buy', 'coin|gold|价格'],
      source: 'lexicon',
    });
  }
  if (/塔防|tower\s*defense|炮塔/i.test(hay)) {
    loops.push({
      id: 'tower',
      label: '塔防 / 布防',
      signals: ['WaveManager', 'tower|炮塔|turret'],
      source: 'lexicon',
    });
  }
  for (const custom of extractCustomLoops(hay, loops)) {
    loops.push(custom);
  }
  return loops;
}

function uniqHint<T>(list: readonly T[]): T[] {
  return [...new Set(list)];
}

/**
 * Follow-ups must not wipe the compile-time IR. "加上钓鱼" keeps chess
 * boardKind / loop seeds unless the user asked to 重做.
 */
export function mergeGameIntent(
  base: GameIntent | null | undefined,
  next: GameIntent,
): GameIntent {
  if (!base || next.redo) return next;
  const loopSeeds = [...base.loopSeeds];
  for (const loop of next.loopSeeds) {
    if (!loopSeeds.some((l) => l.id === loop.id)) loopSeeds.push(loop);
  }
  return {
    schema: 'opengame-game-intent-v1',
    prompt: base.prompt,
    redo: false,
    boardKind: next.boardKind ?? base.boardKind,
    arcadeHint: next.arcadeHint ?? base.arcadeHint,
    spaceHints: uniqHint([...base.spaceHints, ...next.spaceHints]),
    timeHints: uniqHint([...base.timeHints, ...next.timeHints]),
    inputHints: uniqHint([...base.inputHints, ...next.inputHints]),
    winHints: uniqHint([...base.winHints, ...next.winHints]),
    moduleHints: uniqHint([...base.moduleHints, ...next.moduleHints]),
    loopSeeds,
    archetypeHint: base.archetypeHint,
    mixed: base.mixed || next.mixed,
  };
}
