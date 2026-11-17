/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import {
  courseEvidencePreview,
  mergeCourseEvidencePreview,
  courseEvidenceHudState,
  courseEvidenceHitPulse,
  courseEvidenceHitToastKey,
} from './courseEvidence.js';

describe('courseEvidence', () => {
  const board = {
    status: 'closed',
    kind: 'custom',
    opensAt: new Date(Date.now() - 60_000).toISOString(),
    settlesAt: new Date(Date.now() + 3_600_000).toISOString(),
    options: [
      {
        id: 'a',
        key: 'a',
        label: '桂花',
        points: 12,
        share: 1,
        needles: ['桂花'],
      },
      {
        id: 'b',
        key: 'b',
        label: '失火',
        points: 0,
        share: 0,
        needles: ['失火'],
      },
    ],
    evidencePreview: {
      muted: false,
      leadingOptionId: 'a',
      matches: { a: 2, b: 0 },
    },
  };

  it('prefers API hits when the visitor SSE log is still empty', () => {
    const rows = courseEvidencePreview(board, []);
    expect(rows.find((row) => row.optionId === 'a')).toMatchObject({
      hits: 2,
      leading: true,
    });
  });

  it('keeps the higher hit count when live talk catches up', () => {
    const live = [
      {
        optionId: 'a',
        label: '桂花',
        hits: 1,
        leading: false,
      },
      {
        optionId: 'b',
        label: '失火',
        hits: 0,
        leading: false,
      },
    ];
    const merged = mergeCourseEvidencePreview(live, board.evidencePreview);
    expect(merged.find((row) => row.optionId === 'a')?.hits).toBe(2);
    expect(merged.find((row) => row.optionId === 'a')?.leading).toBe(true);
  });

  it('flags a muted evidence window on the map hud when API says so', () => {
    const hud = courseEvidenceHudState(
      {
        status: 'closed',
        kind: 'custom',
        opensAt: new Date(Date.now() - 60_000).toISOString(),
        settlesAt: new Date(Date.now() + 3_600_000).toISOString(),
        options: board.options,
        evidencePreview: { muted: true, leadingOptionId: null, matches: {} },
        evidenceHealth: 'muted',
        mutedHint: true,
      },
      [],
    );
    expect(hud.showMuted).toBe(true);
    expect(hud.hitLabels).toEqual([]);
  });

  it('pulses when a side gains new hits during evidence', () => {
    const rows = [
      { optionId: 'a', label: '桂花', hits: 1, leading: true },
      { optionId: 'b', label: '失火', hits: 0, leading: false },
    ];
    expect(
      courseEvidenceHitPulse(
        [{ optionId: 'a', label: '桂花', hits: 0, leading: false }, ...rows.slice(1)],
        rows,
        'a',
      ),
    ).toMatchObject({ label: '桂花', optionId: 'a', mine: true });
    expect(courseEvidenceHitToastKey(true)).toBe(
      'product.obs.course.evidenceHitToastMine',
    );
  });
});
