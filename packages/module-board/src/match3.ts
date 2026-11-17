/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Match-3 capability — swap / match / gravity. Not a Candy Crush project.
 */

import type { Cell } from './types.js';

export type Match3State = {
  readonly cols: number;
  readonly rows: number;
  readonly cells: readonly (readonly number[])[];
  readonly score: number;
};

const DEFAULT_SIZE = 8;
const COLORS = 6;

function cloneCells(cells: readonly (readonly number[])[]): number[][] {
  return cells.map((row) => [...row]);
}

export function createMatch3(
  cols = DEFAULT_SIZE,
  rows = DEFAULT_SIZE,
  seed = 1,
): Match3State {
  let n = seed >>> 0;
  const rand = (): number => {
    n = (n * 1664525 + 1013904223) >>> 0;
    return 1 + (n % COLORS);
  };
  const cells: number[][] = [];
  for (let row = 0; row < rows; row += 1) {
    const line: number[] = [];
    for (let col = 0; col < cols; col += 1) line.push(rand());
    cells.push(line);
  }
  return { cols, rows, cells, score: 0 };
}

export function findMatches(state: Match3State): readonly Cell[] {
  const hits = new Map<string, Cell>();
  const mark = (col: number, row: number) => {
    hits.set(`${col},${row}`, { col, row });
  };
  for (let row = 0; row < state.rows; row += 1) {
    let run = 1;
    for (let col = 1; col <= state.cols; col += 1) {
      const same =
        col < state.cols &&
        state.cells[row]![col] !== 0 &&
        state.cells[row]![col] === state.cells[row]![col - 1];
      if (same) run += 1;
      else {
        if (run >= 3) {
          for (let k = 0; k < run; k += 1) mark(col - 1 - k, row);
        }
        run = 1;
      }
    }
  }
  for (let col = 0; col < state.cols; col += 1) {
    let run = 1;
    for (let row = 1; row <= state.rows; row += 1) {
      const same =
        row < state.rows &&
        state.cells[row]![col] !== 0 &&
        state.cells[row]![col] === state.cells[row - 1]![col];
      if (same) run += 1;
      else {
        if (run >= 3) {
          for (let k = 0; k < run; k += 1) mark(col, row - 1 - k);
        }
        run = 1;
      }
    }
  }
  return [...hits.values()];
}

function adjacent(a: Cell, b: Cell): boolean {
  return Math.abs(a.col - b.col) + Math.abs(a.row - b.row) === 1;
}

function swapCells(cells: number[][], a: Cell, b: Cell): void {
  const tmp = cells[a.row]![a.col]!;
  cells[a.row]![a.col] = cells[b.row]![b.col]!;
  cells[b.row]![b.col] = tmp;
}

export function applySwap(state: Match3State, a: Cell, b: Cell): Match3State {
  if (!adjacent(a, b)) return state;
  const cells = cloneCells(state.cells);
  swapCells(cells, a, b);
  let next: Match3State = { ...state, cells };
  let matches = findMatches(next);
  if (matches.length === 0) return state;
  let score = state.score;
  while (matches.length > 0) {
    score += matches.length;
    const cleared = cloneCells(next.cells);
    for (const cell of matches) cleared[cell.row]![cell.col] = 0;
    gravity(cleared);
    refill(cleared);
    next = { ...next, cells: cleared, score };
    matches = findMatches(next);
  }
  return next;
}

export function legalSwaps(state: Match3State): readonly { a: Cell; b: Cell }[] {
  const out: { a: Cell; b: Cell }[] = [];
  for (let row = 0; row < state.rows; row += 1) {
    for (let col = 0; col < state.cols; col += 1) {
      const a = { col, row };
      for (const b of [
        { col: col + 1, row },
        { col, row: row + 1 },
      ]) {
        if (b.col >= state.cols || b.row >= state.rows) continue;
        if (applySwap(state, a, b) !== state) out.push({ a, b });
      }
    }
  }
  return out;
}

function gravity(cells: number[][]): void {
  const rows = cells.length;
  const cols = cells[0]?.length ?? 0;
  for (let col = 0; col < cols; col += 1) {
    let write = rows - 1;
    for (let row = rows - 1; row >= 0; row -= 1) {
      if (cells[row]![col] !== 0) {
        cells[write]![col] = cells[row]![col]!;
        if (write !== row) cells[row]![col] = 0;
        write -= 1;
      }
    }
  }
}

function refill(cells: number[][]): void {
  let n = 7;
  for (let row = 0; row < cells.length; row += 1) {
    for (let col = 0; col < (cells[row]?.length ?? 0); col += 1) {
      if (cells[row]![col] === 0) {
        n = (n * 1664525 + 1013904223) >>> 0;
        cells[row]![col] = 1 + (n % COLORS);
      }
    }
  }
}

export const Match3Rules = {
  id: 'match3' as const,
  create: createMatch3,
  findMatches,
  legalSwaps,
  applySwap,
};
