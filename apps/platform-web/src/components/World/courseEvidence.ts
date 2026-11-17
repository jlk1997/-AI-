/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { previewCourseEvidenceHits } from '@opengame/platform-shared';

import type { CourseView } from '../../services/api';
import type { TalkLine } from './societyTownStageModel';

type EvidenceRow = {
  readonly optionId: string;
  readonly label: string;
  readonly hits: number;
  readonly leading: boolean;
};

function liveEvidencePreview(
  current: Pick<
    CourseView,
    'status' | 'options' | 'kind' | 'opensAt' | 'settlesAt'
  >,
  talks: readonly TalkLine[],
): readonly EvidenceRow[] {
  const windowStartMs = Date.parse(current.opensAt);
  const windowEndMs = Date.parse(current.settlesAt);
  return previewCourseEvidenceHits({
    boardKind: current.kind,
    options: current.options.map((option) => ({
      id: option.id,
      label: option.label,
      needles: option.needles,
      predicateType: option.predicateType,
      agentKey: option.agentKey,
      agentName: option.agentName,
      present: option.present,
    })),
    talks: talks.map((line) => ({
      id: line.eventId || line.id,
      kind: line.kind,
      text: line.text,
      who: line.who,
      agentId: line.agentId,
      agentKey: line.agentId,
      degraded: line.degraded,
      neutral: line.neutral,
      createdAtMs: line.createdAtMs,
    })),
    windowStartMs: Number.isFinite(windowStartMs) ? windowStartMs : undefined,
    windowEndMs: Number.isFinite(windowEndMs) ? windowEndMs : undefined,
  });
}

/** SSE/talkLog for live feel; API `evidencePreview` corrects misses and leading. */
export function mergeCourseEvidencePreview(
  live: readonly EvidenceRow[],
  api: CourseView['evidencePreview'],
): readonly EvidenceRow[] {
  if (!api?.matches) return live;
  const merged = live.map((row) => ({
    ...row,
    hits: Math.max(row.hits, api.matches[row.optionId] ?? 0),
    leading: api.leadingOptionId === row.optionId,
  }));
  const apiHasSignal =
    api.leadingOptionId != null ||
    Object.values(api.matches).some((count) => count > 0);
  if (!apiHasSignal) return merged;
  const liveHasSignal = merged.some((row) => row.hits > 0 || row.leading);
  if (liveHasSignal) return merged;
  return merged.map((row) => ({
    ...row,
    hits: api.matches[row.optionId] ?? 0,
    leading: api.leadingOptionId === row.optionId,
  }));
}

export function courseEvidencePreview(
  current: Pick<
    CourseView,
    'status' | 'options' | 'kind' | 'opensAt' | 'settlesAt' | 'evidencePreview'
  >,
  talks: readonly TalkLine[],
): readonly EvidenceRow[] {
  if (current.status !== 'open' && current.status !== 'closed') return [];
  return mergeCourseEvidencePreview(
    liveEvidencePreview(current, talks),
    current.evidencePreview,
  );
}

export function evidenceHitLabels(
  current: Pick<
    CourseView,
    | 'status'
    | 'options'
    | 'kind'
    | 'opensAt'
    | 'settlesAt'
    | 'evidencePreview'
    | 'evidenceHealth'
  >,
  talks: readonly TalkLine[],
): string[] {
  return courseEvidencePreview(current, talks)
    .filter((row) => row.hits > 0 || row.leading)
    .map((row) => row.label);
}

export function courseEvidenceHudState(
  current: Pick<
    CourseView,
    | 'status'
    | 'options'
    | 'kind'
    | 'opensAt'
    | 'settlesAt'
    | 'evidencePreview'
    | 'evidenceHealth'
    | 'mutedHint'
  >,
  talks: readonly TalkLine[],
): {
  readonly hitLabels: readonly string[];
  readonly showMuted: boolean;
} {
  if (current.status !== 'open' && current.status !== 'closed') {
    return { hitLabels: [], showMuted: false };
  }
  const hitLabels = evidenceHitLabels(current, talks);
  const showMuted =
    hitLabels.length === 0 &&
    (current.evidencePreview?.muted === true ||
      current.evidenceHealth === 'muted' ||
      current.mutedHint === true);
  return { hitLabels, showMuted };
}

/** Fires when a side gains new settlement credit during the evidence window. */
export function courseEvidenceHitPulse(
  prev: readonly EvidenceRow[],
  next: readonly EvidenceRow[],
  myOptionId: string | null | undefined,
): {
  readonly label: string;
  readonly optionId: string;
  readonly mine: boolean;
} | null {
  const prevMap = new Map(prev.map((row) => [row.optionId, row]));
  let best: { readonly label: string; readonly optionId: string; readonly delta: number } | null =
    null;
  for (const row of next) {
    const before = prevMap.get(row.optionId)?.hits ?? 0;
    const delta = row.hits - before;
    if (delta <= 0) continue;
    const wasLeading = prevMap.get(row.optionId)?.leading ?? false;
    if (
      !best
      || delta > best.delta
      || (row.leading && !wasLeading)
    ) {
      best = { label: row.label, optionId: row.optionId, delta };
    }
  }
  if (!best) return null;
  return {
    label: best.label,
    optionId: best.optionId,
    mine: best.optionId === myOptionId,
  };
}

export function courseEvidenceHitToastKey(mine: boolean): string {
  return mine
    ? 'product.obs.course.evidenceHitToastMine'
    : 'product.obs.course.evidenceHitToast';
}
