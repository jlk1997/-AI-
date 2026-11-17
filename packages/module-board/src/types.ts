/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

export type Side = 'red' | 'black';

export type Cell = { readonly col: number; readonly row: number };

export type Piece = {
  readonly id: string;
  readonly side: Side;
  readonly kind: string;
  readonly col: number;
  readonly row: number;
};

export type BoardState = {
  readonly cols: number;
  readonly rows: number;
  readonly turn: Side;
  readonly pieces: readonly Piece[];
  readonly winner: Side | 'draw' | null;
};

export type Move = {
  readonly from?: Cell;
  readonly to: Cell;
  readonly pieceId?: string;
};

export interface BoardRules {
  readonly id: string;
  readonly cols: number;
  readonly rows: number;
  initial(): BoardState;
  legalMoves(board: BoardState, from?: Cell): readonly Move[];
  applyMove(board: BoardState, move: Move): BoardState;
  winner(board: BoardState): Side | 'draw' | null;
}

export function cellKey(col: number, row: number): string {
  return `${col},${row}`;
}

export function pieceAt(board: BoardState, col: number, row: number): Piece | undefined {
  return board.pieces.find((p) => p.col === col && p.row === row);
}

export function inBounds(board: Pick<BoardState, 'cols' | 'rows'>, col: number, row: number): boolean {
  return col >= 0 && row >= 0 && col < board.cols && row < board.rows;
}

export function otherSide(side: Side): Side {
  return side === 'red' ? 'black' : 'red';
}
