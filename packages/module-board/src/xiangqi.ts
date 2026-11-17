/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Chinese chess (象棋) legal-move table. Scene code imports this; it does not
 * invent 蹩马 / 炮打隔子 from scratch.
 */

import {
  type BoardRules,
  type BoardState,
  type Cell,
  type Move,
  type Piece,
  type Side,
  inBounds,
  otherSide,
  pieceAt,
} from './types.js';

const COLS = 9;
const ROWS = 10;

function palace(side: Side, col: number, row: number): boolean {
  if (col < 3 || col > 5) return false;
  return side === 'red' ? row >= 0 && row <= 2 : row >= 7 && row <= 9;
}

function crossedRiver(side: Side, row: number): boolean {
  return side === 'red' ? row >= 5 : row <= 4;
}

function ownRiver(side: Side, row: number): boolean {
  return side === 'red' ? row <= 4 : row >= 5;
}

function lineClear(
  board: BoardState,
  c0: number,
  r0: number,
  c1: number,
  r1: number,
): number {
  if (c0 !== c1 && r0 !== r1) return -1;
  let n = 0;
  if (c0 === c1) {
    const a = Math.min(r0, r1);
    const b = Math.max(r0, r1);
    for (let r = a + 1; r < b; r += 1) if (pieceAt(board, c0, r)) n += 1;
  } else {
    const a = Math.min(c0, c1);
    const b = Math.max(c0, c1);
    for (let c = a + 1; c < b; c += 1) if (pieceAt(board, c, r0)) n += 1;
  }
  return n;
}

function generalsFace(board: BoardState): boolean {
  const red = board.pieces.find((p) => p.side === 'red' && p.kind === 'G');
  const black = board.pieces.find((p) => p.side === 'black' && p.kind === 'G');
  if (!red || !black || red.col !== black.col) return false;
  return lineClear(board, red.col, red.row, black.col, black.row) === 0;
}

function rawMoves(board: BoardState, piece: Piece): Cell[] {
  const { col, row, side, kind } = piece;
  const cells: Cell[] = [];
  const push = (c: number, r: number) => {
    if (!inBounds(board, c, r)) return;
    const hit = pieceAt(board, c, r);
    if (hit?.side === side) return;
    cells.push({ col: c, row: r });
  };

  if (kind === 'G') {
    for (const [dc, dr] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const c = col + dc;
      const r = row + dr;
      if (palace(side, c, r)) push(c, r);
    }
    const enemy = board.pieces.find((p) => p.side !== side && p.kind === 'G');
    if (enemy && enemy.col === col && lineClear(board, col, row, enemy.col, enemy.row) === 0) {
      push(enemy.col, enemy.row);
    }
    return cells;
  }
  if (kind === 'A') {
    for (const [dc, dr] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ] as const) {
      const c = col + dc;
      const r = row + dr;
      if (palace(side, c, r)) push(c, r);
    }
    return cells;
  }
  if (kind === 'E') {
    for (const [dc, dr] of [
      [2, 2],
      [2, -2],
      [-2, 2],
      [-2, -2],
    ] as const) {
      const eyeC = col + dc / 2;
      const eyeR = row + dr / 2;
      if (pieceAt(board, eyeC, eyeR)) continue;
      const c = col + dc;
      const r = row + dr;
      if (ownRiver(side, r)) push(c, r);
    }
    return cells;
  }
  if (kind === 'H') {
    const hops: ReadonlyArray<readonly [number, number, number, number]> = [
      [1, 2, 0, 1],
      [-1, 2, 0, 1],
      [1, -2, 0, -1],
      [-1, -2, 0, -1],
      [2, 1, 1, 0],
      [2, -1, 1, 0],
      [-2, 1, -1, 0],
      [-2, -1, -1, 0],
    ];
    for (const [dc, dr, bc, br] of hops) {
      if (pieceAt(board, col + bc, row + br)) continue;
      push(col + dc, row + dr);
    }
    return cells;
  }
  if (kind === 'R') {
    for (const [dc, dr] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      for (let i = 1; i < 10; i += 1) {
        const c = col + dc * i;
        const r = row + dr * i;
        if (!inBounds(board, c, r)) break;
        const hit = pieceAt(board, c, r);
        if (!hit) {
          cells.push({ col: c, row: r });
          continue;
        }
        if (hit.side !== side) cells.push({ col: c, row: r });
        break;
      }
    }
    return cells;
  }
  if (kind === 'C') {
    for (const [dc, dr] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      let jumped = false;
      for (let i = 1; i < 10; i += 1) {
        const c = col + dc * i;
        const r = row + dr * i;
        if (!inBounds(board, c, r)) break;
        const hit = pieceAt(board, c, r);
        if (!jumped) {
          if (!hit) cells.push({ col: c, row: r });
          else jumped = true;
          continue;
        }
        if (hit) {
          if (hit.side !== side) cells.push({ col: c, row: r });
          break;
        }
      }
    }
    return cells;
  }
  if (kind === 'P') {
    const forward = side === 'red' ? 1 : -1;
    push(col, row + forward);
    if (crossedRiver(side, row)) {
      push(col - 1, row);
      push(col + 1, row);
    }
    return cells;
  }
  return cells;
}

function inCheck(board: BoardState, side: Side): boolean {
  const king = board.pieces.find((p) => p.side === side && p.kind === 'G');
  if (!king) return true;
  const ghost: BoardState = { ...board, turn: otherSide(side) };
  for (const enemy of board.pieces.filter((p) => p.side !== side)) {
    if (rawMoves(ghost, enemy).some((c) => c.col === king.col && c.row === king.row)) {
      return true;
    }
  }
  return generalsFace(board);
}

function applyRaw(board: BoardState, piece: Piece, to: Cell): BoardState {
  const captured = pieceAt(board, to.col, to.row);
  const pieces = board.pieces
    .filter((p) => p.id !== piece.id && p.id !== captured?.id)
    .concat({ ...piece, col: to.col, row: to.row });
  return {
    ...board,
    pieces,
    turn: otherSide(board.turn),
    winner: null,
  };
}

function legalForPiece(board: BoardState, piece: Piece): Move[] {
  if (piece.side !== board.turn || board.winner) return [];
  const out: Move[] = [];
  for (const to of rawMoves(board, piece)) {
    const next = applyRaw(board, piece, to);
    if (!inCheck(next, piece.side)) {
      out.push({ from: { col: piece.col, row: piece.row }, to, pieceId: piece.id });
    }
  }
  return out;
}

function seed(side: Side, kind: string, col: number, row: number, i: number): Piece {
  return { id: `${side}-${kind}-${i}`, side, kind, col, row };
}

export const XiangqiRules: BoardRules = {
  id: 'xiangqi',
  cols: COLS,
  rows: ROWS,
  initial(): BoardState {
    const pieces: Piece[] = [
      seed('red', 'R', 0, 0, 0),
      seed('red', 'H', 1, 0, 0),
      seed('red', 'E', 2, 0, 0),
      seed('red', 'A', 3, 0, 0),
      seed('red', 'G', 4, 0, 0),
      seed('red', 'A', 5, 0, 1),
      seed('red', 'E', 6, 0, 1),
      seed('red', 'H', 7, 0, 1),
      seed('red', 'R', 8, 0, 1),
      seed('red', 'C', 1, 2, 0),
      seed('red', 'C', 7, 2, 1),
      seed('red', 'P', 0, 3, 0),
      seed('red', 'P', 2, 3, 1),
      seed('red', 'P', 4, 3, 2),
      seed('red', 'P', 6, 3, 3),
      seed('red', 'P', 8, 3, 4),
      seed('black', 'R', 0, 9, 0),
      seed('black', 'H', 1, 9, 0),
      seed('black', 'E', 2, 9, 0),
      seed('black', 'A', 3, 9, 0),
      seed('black', 'G', 4, 9, 0),
      seed('black', 'A', 5, 9, 1),
      seed('black', 'E', 6, 9, 1),
      seed('black', 'H', 7, 9, 1),
      seed('black', 'R', 8, 9, 1),
      seed('black', 'C', 1, 7, 0),
      seed('black', 'C', 7, 7, 1),
      seed('black', 'P', 0, 6, 0),
      seed('black', 'P', 2, 6, 1),
      seed('black', 'P', 4, 6, 2),
      seed('black', 'P', 6, 6, 3),
      seed('black', 'P', 8, 6, 4),
    ];
    return { cols: COLS, rows: ROWS, turn: 'red', pieces, winner: null };
  },
  legalMoves(board: BoardState, from?: Cell): readonly Move[] {
    if (from) {
      const piece = pieceAt(board, from.col, from.row);
      return piece ? legalForPiece(board, piece) : [];
    }
    return board.pieces.filter((p) => p.side === board.turn).flatMap((p) => legalForPiece(board, p));
  },
  applyMove(board: BoardState, move: Move): BoardState {
    const piece = move.pieceId
      ? board.pieces.find((p) => p.id === move.pieceId)
      : move.from
        ? pieceAt(board, move.from.col, move.from.row)
        : undefined;
    if (!piece) return board;
    const legal = legalForPiece(board, piece);
    if (!legal.some((m) => m.to.col === move.to.col && m.to.row === move.to.row)) {
      return board;
    }
    const next = applyRaw(board, piece, move.to);
    const opp = otherSide(piece.side);
    const oppMoves = XiangqiRules.legalMoves({ ...next, turn: opp });
    const oppKing = next.pieces.some((p) => p.side === opp && p.kind === 'G');
    const winner = !oppKing || (inCheck(next, opp) && oppMoves.length === 0) ? piece.side : null;
    return { ...next, winner };
  },
  winner(board: BoardState): Side | 'draw' | null {
    return board.winner;
  },
};
