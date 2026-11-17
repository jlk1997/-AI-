/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * International chess, enough for a legal first move. Castling / en passant
 * are omitted on purpose — this is a capability table, not a tournament engine.
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

const COLS = 8;
const ROWS = 8;

function seed(side: Side, kind: string, col: number, row: number, i: number): Piece {
  return { id: `${side}-${kind}-${i}`, side, kind, col, row };
}

function slides(
  board: BoardState,
  piece: Piece,
  dirs: ReadonlyArray<readonly [number, number]>,
): Cell[] {
  const cells: Cell[] = [];
  for (const [dc, dr] of dirs) {
    for (let i = 1; i < 8; i += 1) {
      const c = piece.col + dc * i;
      const r = piece.row + dr * i;
      if (!inBounds(board, c, r)) break;
      const hit = pieceAt(board, c, r);
      if (!hit) {
        cells.push({ col: c, row: r });
        continue;
      }
      if (hit.side !== piece.side) cells.push({ col: c, row: r });
      break;
    }
  }
  return cells;
}

function rawMoves(board: BoardState, piece: Piece): Cell[] {
  const { col, row, side, kind } = piece;
  if (kind === 'N') {
    const hops = [
      [1, 2],
      [-1, 2],
      [1, -2],
      [-1, -2],
      [2, 1],
      [2, -1],
      [-2, 1],
      [-2, -1],
    ] as const;
    return hops
      .map(([dc, dr]) => ({ col: col + dc, row: row + dr }))
      .filter((c) => inBounds(board, c.col, c.row) && pieceAt(board, c.col, c.row)?.side !== side);
  }
  if (kind === 'B') {
    return slides(board, piece, [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ]);
  }
  if (kind === 'R') {
    return slides(board, piece, [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]);
  }
  if (kind === 'Q') {
    return slides(board, piece, [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ]);
  }
  if (kind === 'K') {
    const cells: Cell[] = [];
    for (let dc = -1; dc <= 1; dc += 1) {
      for (let dr = -1; dr <= 1; dr += 1) {
        if (!dc && !dr) continue;
        const c = col + dc;
        const r = row + dr;
        if (inBounds(board, c, r) && pieceAt(board, c, r)?.side !== side) {
          cells.push({ col: c, row: r });
        }
      }
    }
    return cells;
  }
  if (kind === 'P') {
    const dir = side === 'red' ? 1 : -1;
    const start = side === 'red' ? 1 : 6;
    const cells: Cell[] = [];
    const f1 = row + dir;
    if (inBounds(board, col, f1) && !pieceAt(board, col, f1)) {
      cells.push({ col, row: f1 });
      const f2 = row + dir * 2;
      if (row === start && inBounds(board, col, f2) && !pieceAt(board, col, f2)) {
        cells.push({ col, row: f2 });
      }
    }
    for (const dc of [-1, 1]) {
      const c = col + dc;
      const hit = pieceAt(board, c, f1);
      if (hit && hit.side !== side) cells.push({ col: c, row: f1 });
    }
    return cells;
  }
  return [];
}

function inCheck(board: BoardState, side: Side): boolean {
  const king = board.pieces.find((p) => p.side === side && p.kind === 'K');
  if (!king) return true;
  for (const enemy of board.pieces.filter((p) => p.side !== side)) {
    if (rawMoves(board, enemy).some((c) => c.col === king.col && c.row === king.row)) {
      return true;
    }
  }
  return false;
}

function applyRaw(board: BoardState, piece: Piece, to: Cell): BoardState {
  const captured = pieceAt(board, to.col, to.row);
  let moved: Piece = { ...piece, col: to.col, row: to.row };
  if (piece.kind === 'P' && (to.row === 0 || to.row === 7)) {
    moved = { ...moved, kind: 'Q' };
  }
  const pieces = board.pieces
    .filter((p) => p.id !== piece.id && p.id !== captured?.id)
    .concat(moved);
  return { ...board, pieces, turn: otherSide(board.turn), winner: null };
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

export const ChessRules: BoardRules = {
  id: 'chess',
  cols: COLS,
  rows: ROWS,
  initial(): BoardState {
    const back = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'] as const;
    const pieces: Piece[] = [];
    back.forEach((kind, col) => {
      pieces.push(seed('red', kind, col, 0, col));
      pieces.push(seed('black', kind, col, 7, col));
    });
    for (let col = 0; col < 8; col += 1) {
      pieces.push(seed('red', 'P', col, 1, col));
      pieces.push(seed('black', 'P', col, 6, col));
    }
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
    if (
      !legalForPiece(board, piece).some((m) => m.to.col === move.to.col && m.to.row === move.to.row)
    ) {
      return board;
    }
    const next = applyRaw(board, piece, move.to);
    const opp = otherSide(piece.side);
    const oppMoves = ChessRules.legalMoves({ ...next, turn: opp });
    const oppKing = next.pieces.some((p) => p.side === opp && p.kind === 'K');
    const winner = !oppKing || (inCheck(next, opp) && oppMoves.length === 0) ? piece.side : null;
    return { ...next, winner };
  },
  winner(board: BoardState): Side | 'draw' | null {
    return board.winner;
  },
};
