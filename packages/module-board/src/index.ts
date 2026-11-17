/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

export type {
  BoardRules,
  BoardState,
  Cell,
  Move,
  Piece,
  Side,
} from './types.js';
export {
  cellKey,
  inBounds,
  otherSide,
  pieceAt,
} from './types.js';
export { GomokuRules } from './gomoku.js';
export { XiangqiRules } from './xiangqi.js';
export { ChessRules } from './chess.js';
export {
  Match3Rules,
  applySwap,
  createMatch3,
  findMatches,
  legalSwaps,
  type Match3State,
} from './match3.js';

import { ChessRules } from './chess.js';
import { GomokuRules } from './gomoku.js';
import { XiangqiRules } from './xiangqi.js';
import type { BoardRules } from './types.js';

export type BoardKind = 'xiangqi' | 'gomoku' | 'chess' | 'generic';

export function rulesForBoardKind(kind: BoardKind): BoardRules {
  if (kind === 'xiangqi') return XiangqiRules;
  if (kind === 'chess') return ChessRules;
  return GomokuRules;
}
