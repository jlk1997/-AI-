/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  averageScores,
  type VisionQaResult,
  type VisionQaScores,
  VISION_QA_PASS_THRESHOLD,
} from './rubric.js';

export interface HeuristicVisionInput {
  /** Absolute or relative paths of PNGs under public/assets or dist. */
  readonly imagePaths?: readonly string[];
  /** Scene/source TypeScript blobs for static smell checks. */
  readonly sceneSource?: string;
  /** Whether orange/brown debug rects are known present. */
  readonly hasDebugRects?: boolean;
  /** Whether sprites use atlas / walk cycles. */
  readonly hasAtlas?: boolean;
  /** Whether tilemap (not single BG image) is used. */
  readonly hasTilemap?: boolean;
  /** Dialogue/UI kit usage signals. */
  readonly usesGameUiKit?: boolean;
  readonly usesWordWrap?: boolean;
  readonly usesFixedHeightDialogue?: boolean;
}

/**
 * Offline heuristic scorer used when no VLM credentials are available.
 * Still catches the worst structural smells that produce "toy" screenshots.
 */
export function scoreVisionHeuristic(
  input: HeuristicVisionInput,
): VisionQaResult {
  const scores: VisionQaScores = {
    uiOverlap: 4,
    textClipping: 4,
    readability: 4,
    artConsistency: 3.5,
    composition: 3.5,
    modernFeel: 3,
  };
  const issues: string[] = [];

  if (input.hasDebugRects) {
    scores.composition = Math.min(scores.composition, 2);
    scores.modernFeel = Math.min(scores.modernFeel, 2);
    issues.push('Debug/placeholder colored rectangles visible in scene');
  }
  if (!input.hasAtlas) {
    scores.artConsistency = Math.min(scores.artConsistency, 3);
    scores.composition = Math.min(scores.composition, 3);
    issues.push('No walk-cycle atlas — characters likely static floating sprites');
  }
  if (!input.hasTilemap) {
    scores.composition = Math.min(scores.composition, 3);
    scores.modernFeel = Math.min(scores.modernFeel, 2.5);
    issues.push('Single background image instead of tilemap');
  }
  if (input.usesFixedHeightDialogue) {
    scores.textClipping = Math.min(scores.textClipping, 2);
    issues.push('Dialogue uses fixedHeight which clips CJK glyphs');
  }
  if (!input.usesWordWrap) {
    scores.readability = Math.min(scores.readability, 3);
    issues.push('Missing wordWrap on dialogue/UI text');
  }
  if (!input.usesGameUiKit) {
    scores.uiOverlap = Math.min(scores.uiOverlap, 3);
    scores.readability = Math.min(scores.readability, 3);
    issues.push('Not using GameUiKit dialogue/title panels');
  } else {
    scores.uiOverlap = Math.max(scores.uiOverlap, 4.2);
    scores.readability = Math.max(scores.readability, 4.2);
  }
  if (input.hasAtlas && input.hasTilemap && input.usesGameUiKit && input.usesWordWrap) {
    scores.artConsistency = Math.max(scores.artConsistency, 4.2);
    scores.composition = Math.max(scores.composition, 4.2);
    scores.modernFeel = Math.max(scores.modernFeel, 4.0);
  }

  const src = input.sceneSource ?? '';
  if (/rectangle\([^)]*0x7c3a1d/i.test(src) || /decoration.*house/i.test(src)) {
    scores.composition = Math.min(scores.composition, 2.5);
    issues.push('House/decoration solid-color rectangles over scenic art');
  }
  if (/\.setAlpha\(0\.[0-5]\d*\)/.test(src) && /bg_region/i.test(src)) {
    scores.artConsistency = Math.min(scores.artConsistency, 3);
    issues.push('Background heavily dimmed (low alpha)');
  }

  const avg = averageScores(scores);
  return {
    ok: avg >= VISION_QA_PASS_THRESHOLD,
    average: Math.round(avg * 100) / 100,
    scores,
    issues,
    notes: 'Heuristic vision QA (no VLM). Enable OPENAI_VISION_MODEL for VLM scoring.',
    mode: 'heuristic',
  };
}
