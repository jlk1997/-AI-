/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ArcadeCarrier, BoardKind } from './types.js';

export function isRedoPrompt(prompt: string): boolean {
  return /重做|换类型|整盘重来|从头做|推倒重来|全部重写/i.test(prompt);
}

export function detectBoardKind(prompt: string): BoardKind | null {
  const t = prompt;
  if (/国际象棋|\bchess\b/i.test(t) && !/中国象棋|xiangqi/i.test(t)) {
    return 'chess';
  }
  if (/中国象棋|xiangqi/i.test(t) || (/象棋/.test(t) && !/国际象棋/.test(t))) {
    return 'xiangqi';
  }
  if (/五子棋|gomoku|连五|连珠/i.test(t)) return 'gomoku';
  if (/围棋|跳棋|黑白棋|othello|reversi|棋盘|board\s*game/i.test(t)) {
    return 'generic';
  }
  return null;
}

export function detectArcadeHint(
  hay: string,
  boardKind: BoardKind | null,
): ArcadeCarrier | null {
  if (boardKind) return 'board_turn';
  if (/贪吃蛇|\bsnake\b/i.test(hay)) return 'snake';
  if (/flappy|飞鸟|小鸟|拍翅膀/i.test(hay)) return 'flappy';
  if (/2048|二〇四八/i.test(hay)) return 'g2048';
  if (/消消乐|三消|match[\s-]?3/i.test(hay)) return 'match3';
  if (/sub-?type[:\s]*tactics|战术棋|战棋|点选走子/i.test(hay)) return 'board_turn';
  return null;
}

export function hasExploreHint(hay: string): boolean {
  return /俯视|top[\s-]?down|小镇|探索|走动|rpg|角色扮演|武侠|江湖|开放世界/i.test(
    hay,
  );
}

export function hasDialogueHint(hay: string): boolean {
  return /对话选项|分支对话|加上对话|视觉小说|galgame|choice/i.test(hay);
}

export function hasCardsHint(hay: string): boolean {
  return /卡牌|手牌|抽牌|打牌|deck\b|card\s*game/i.test(hay);
}

export function hasEmitterHint(hay: string): boolean {
  return /弹幕|bullet\s*hell|danmaku|发射器/i.test(hay);
}

export function hasMatchHint(hay: string): boolean {
  return /消消乐|三消|match[\s-]?3/i.test(hay);
}

/** Walkable world + a bound capability (board / match / cards / emitter). */
export function isMixedWorldAndBoard(hay: string, boardKind: BoardKind | null): boolean {
  if (!hasExploreHint(hay)) return false;
  return (
    Boolean(boardKind) ||
    hasMatchHint(hay) ||
    hasCardsHint(hay) ||
    hasEmitterHint(hay)
  );
}
