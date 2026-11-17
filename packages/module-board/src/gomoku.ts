/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type BoardRules,
  type BoardState,
  type Cell,
  type Move,
  type Side,
  inBounds,
  otherSide,
  pieceAt,
} from './types.js';

const SIZE = 15;

function hasFive(board: BoardState, side: Side, col: number, row: number): boolean {
  const dirs: ReadonlyArray<readonly [number, number]> = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ];
  for (const [dc, dr] of dirs) {
    let n = 1;
    for (const sign of [1, -1]) {
      let c = col + dc * sign;
      let r = row + dr * sign;
      while (inBounds(board, c, r) && pieceAt(board, c, r)?.side === side) {
        n += 1;
        c += dc * sign;
        r += dr * sign;
      }
    }
    if (n >= 5) return true;
  }
  return false;
}

export const GomokuRules: BoardRules = {
  id: 'gomoku',
  cols: SIZE,
  rows: SIZE,
  initial(): BoardState {
    return {
      cols: SIZE,
      rows: SIZE,
      turn: 'red',
      pieces: [],
      winner: null,
    };
  },
  legalMoves(board: BoardState, from?: Cell): readonly Move[] {
    if (board.winner || from) return [];
    const out: Move[] = [];
    for (let row = 0; row < board.rows; row += 1) {
      for (let col = 0; col < board.cols; col += 1) {
        if (!pieceAt(board, col, row)) out.push({ to: { col, row } });
      }
    }
    return out;
  },
  applyMove(board: BoardState, move: Move): BoardState {
    if (board.winner || pieceAt(board, move.to.col, move.to.row)) return board;
    const placed = {
      id: `${board.turn}-${board.pieces.length}`,
      side: board.turn,
      kind: 'stone',
      col: move.to.col,
      row: move.to.row,
    };
    const pieces = [...board.pieces, placed];
    const next: BoardState = {
      ...board,
      pieces,
      turn: otherSide(board.turn),
      winner: null,
    };
    const win = hasFive(next, board.turn, move.to.col, move.to.row)
      ? board.turn
      : pieces.length >= board.cols * board.rows
        ? 'draw'
        : null;
    return { ...next, winner: win };
  },
  winner(board: BoardState): Side | 'draw' | null {
    return board.winner;
  },
};
