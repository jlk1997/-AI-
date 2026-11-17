/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

const STORAGE_KEY = 'og.course.outcomes.v1';
const MAX_ITEMS = 24;

export type CourseOutcomeKind = 'won' | 'lost' | 'voided' | 'closed' | 'watch_settled';

const OUTCOME_CHANGED_EVENT = 'og.course.outcomeChanged';

export type CourseOutcomeRecord = {
  readonly gameId: string;
  readonly nodeId: string;
  readonly kind: CourseOutcomeKind;
  readonly prompt?: string;
  readonly canon?: string | null;
  readonly at: number;
  readonly seen: boolean;
};

function readAll(): CourseOutcomeRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CourseOutcomeRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(rows: CourseOutcomeRecord[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rows.slice(0, MAX_ITEMS)));
    window.dispatchEvent(new CustomEvent(OUTCOME_CHANGED_EVENT));
  } catch {
    /* ignore quota */
  }
}

export function onCourseOutcomeChanged(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener(OUTCOME_CHANGED_EVENT, listener);
  return () => window.removeEventListener(OUTCOME_CHANGED_EVENT, listener);
}

export function pushCourseOutcome(
  input: Omit<CourseOutcomeRecord, 'seen'>,
): void {
  const rows = readAll();
  const idx = rows.findIndex(
    (row) => row.gameId === input.gameId && row.nodeId === input.nodeId,
  );
  if (idx >= 0) {
    const prev = rows[idx]!;
    const next: CourseOutcomeRecord = {
      ...prev,
      kind: input.kind,
      prompt: input.prompt ?? prev.prompt,
      canon: input.canon !== undefined ? input.canon : prev.canon,
      at: Math.max(prev.at, input.at),
      // Keep seen — re-sync must not revive dismissed banners.
      seen: prev.seen,
    };
    if (
      prev.kind === next.kind
      && prev.prompt === next.prompt
      && prev.canon === next.canon
      && prev.seen === next.seen
    ) {
      return;
    }
    const copy = rows.slice();
    copy[idx] = next;
    writeAll(copy);
    return;
  }
  writeAll([{ ...input, seen: false }, ...rows]);
}

export function listUnseenCourseOutcomes(gameId?: string): CourseOutcomeRecord[] {
  return readAll().filter(
    (row) => !row.seen && (!gameId || row.gameId === gameId),
  );
}

export function countUnseenCourseOutcomes(): number {
  return readAll().filter((row) => !row.seen).length;
}

export function markCourseOutcomeSeen(gameId: string, nodeId: string): void {
  const rows = readAll().map((row) =>
    row.gameId === gameId && row.nodeId === nodeId ? { ...row, seen: true } : row,
  );
  writeAll(rows);
}

export function courseOutcomeToastKey(kind: CourseOutcomeKind): string {
  if (kind === 'watch_settled') return 'product.obs.course.toast.watch_settled';
  return `product.obs.course.toast.${kind}`;
}
