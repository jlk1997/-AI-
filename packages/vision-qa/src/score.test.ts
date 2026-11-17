/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { scoreVisionHeuristic } from './heuristic.js';
import { formatVisionQaForFixPrompt, scoreVision } from './score.js';
import { parseVisionQaJson } from './rubric.js';

describe('vision-qa', () => {
  it('flags debug rects and missing tilemap', () => {
    const r = scoreVisionHeuristic({
      hasDebugRects: true,
      hasAtlas: false,
      hasTilemap: false,
      usesGameUiKit: false,
      usesWordWrap: false,
      usesFixedHeightDialogue: true,
    });
    expect(r.ok).toBe(false);
    expect(r.average).toBeLessThan(4.0);
    expect(r.issues.length).toBeGreaterThan(2);
  });

  it('passes a polished signal set', () => {
    const r = scoreVisionHeuristic({
      hasDebugRects: false,
      hasAtlas: true,
      hasTilemap: true,
      usesGameUiKit: true,
      usesWordWrap: true,
      usesFixedHeightDialogue: false,
    });
    expect(r.ok).toBe(true);
    expect(r.average).toBeGreaterThanOrEqual(4.0);
  });

  it('parses VLM json and formats fix prompt', async () => {
    const scores = parseVisionQaJson(
      'here {"scores":{"uiOverlap":4,"textClipping":5,"readability":4,"artConsistency":3,"composition":3,"modernFeel":2},"issues":["flashy"],"notes":"ok"}',
    );
    expect(scores?.modernFeel).toBe(2);
    const r = await scoreVision({
      hasAtlas: true,
      hasTilemap: true,
      usesGameUiKit: true,
      usesWordWrap: true,
      screenshotBase64: 'aaaa',
      callVision: async () =>
        JSON.stringify({
          scores: {
            uiOverlap: 5,
            textClipping: 5,
            readability: 5,
            artConsistency: 5,
            composition: 5,
            modernFeel: 5,
          },
          issues: [],
          notes: 'great',
        }),
    });
    expect(r.mode).toBe('vlm');
    expect(formatVisionQaForFixPrompt(r)).toContain('Vision QA');
  });
});
