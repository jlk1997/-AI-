/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import { ChessRules } from './chess.js';
import { GomokuRules } from './gomoku.js';
import { applySwap, createMatch3, findMatches } from './match3.js';
import { rulesForBoardKind } from './index.js';
import { pieceAt } from './types.js';
import { XiangqiRules } from './xiangqi.js';

describe('XiangqiRules', () => {
  it('opens with a legal chariot step and rejects an illegal leap', () => {
    const start = XiangqiRules.initial();
    const rook = pieceAt(start, 0, 0);
    expect(rook?.kind).toBe('R');
    const legal = XiangqiRules.legalMoves(start, { col: 0, row: 0 });
    expect(legal.some((m) => m.to.col === 0 && m.to.row === 2)).toBe(true);
    const moved = XiangqiRules.applyMove(start, {
      pieceId: rook!.id,
      from: { col: 0, row: 0 },
      to: { col: 0, row: 2 },
    });
    expect(pieceAt(moved, 0, 2)?.kind).toBe('R');
    expect(moved.turn).toBe('black');
    const blocked = XiangqiRules.applyMove(start, {
      pieceId: rook!.id,
      from: { col: 0, row: 0 },
      to: { col: 0, row: 4 },
    });
    expect(pieceAt(blocked, 0, 0)?.kind).toBe('R');
  });

  it('ends the game when the opposing general is captured', () => {
    const board = {
      cols: 9,
      rows: 10,
      turn: 'red' as const,
      winner: null,
      pieces: [
        { id: 'r-r', side: 'red' as const, kind: 'R', col: 4, row: 0 },
        { id: 'r-g', side: 'red' as const, kind: 'G', col: 3, row: 0 },
        { id: 'b-g', side: 'black' as const, kind: 'G', col: 4, row: 9 },
      ],
    };
    const next = XiangqiRules.applyMove(board, {
      pieceId: 'r-r',
      from: { col: 4, row: 0 },
      to: { col: 4, row: 9 },
    });
    expect(pieceAt(next, 4, 9)?.kind).toBe('R');
    expect(next.winner).toBe('red');
  });

  it('blocks a horse when the hobbled square is occupied', () => {
    const start = XiangqiRules.initial();
    const horse = pieceAt(start, 1, 0)!;
    expect(
      XiangqiRules.legalMoves(start, { col: 1, row: 0 }).some(
        (m) => m.to.col === 2 && m.to.row === 2,
      ),
    ).toBe(true);
    const pawnUp = {
      ...start,
      pieces: start.pieces.map((p) =>
        p.col === 2 && p.row === 3 ? { ...p, col: 1, row: 1 } : p,
      ),
    };
    expect(
      XiangqiRules.legalMoves(pawnUp, { col: 1, row: 0 }).some(
        (m) => m.to.col === 2 && m.to.row === 2,
      ),
    ).toBe(false);
    expect(horse.kind).toBe('H');
  });
});

describe('GomokuRules', () => {
  it('wins on five in a row', () => {
    let board = GomokuRules.initial();
    const place = (col: number, row: number) => {
      board = GomokuRules.applyMove(board, { to: { col, row } });
    };
    place(0, 0);
    place(0, 1);
    place(1, 0);
    place(1, 1);
    place(2, 0);
    place(2, 1);
    place(3, 0);
    place(3, 1);
    place(4, 0);
    expect(board.winner).toBe('red');
  });
});

describe('ChessRules', () => {
  it('allows a legal pawn double step', () => {
    const start = ChessRules.initial();
    const pawn = pieceAt(start, 4, 1)!;
    const next = ChessRules.applyMove(start, {
      pieceId: pawn.id,
      from: { col: 4, row: 1 },
      to: { col: 4, row: 3 },
    });
    expect(pieceAt(next, 4, 3)?.kind).toBe('P');
    expect(next.turn).toBe('black');
  });
});

describe('Match3Rules', () => {
  it('clears a horizontal three after a legal swap', () => {
    const cells = [
      [1, 2, 1, 3],
      [2, 1, 2, 3],
      [4, 4, 5, 6],
      [1, 2, 3, 4],
    ];
    const start = { cols: 4, rows: 4, cells, score: 0 };
    expect(findMatches(start)).toHaveLength(0);
    const next = applySwap(start, { col: 1, row: 0 }, { col: 1, row: 1 });
    expect(next.score).toBeGreaterThan(0);
    expect(next).not.toBe(start);
  });

  it('creates a seeded board', () => {
    const board = createMatch3(6, 6, 9);
    expect(board.cells).toHaveLength(6);
    expect(board.cells[0]).toHaveLength(6);
  });
});

describe('rulesForBoardKind', () => {
  it('maps kinds to tables', () => {
    expect(rulesForBoardKind('xiangqi').id).toBe('xiangqi');
    expect(rulesForBoardKind('chess').id).toBe('chess');
    expect(rulesForBoardKind('gomoku').id).toBe('gomoku');
  });
});
