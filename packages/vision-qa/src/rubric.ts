/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/** Visual QA rubric dimensions (1–5). */
export const VISION_QA_DIMENSIONS = [
  'uiOverlap',
  'textClipping',
  'readability',
  'artConsistency',
  'composition',
  'modernFeel',
] as const;

export type VisionQaDimension = (typeof VISION_QA_DIMENSIONS)[number];

export type VisionQaScores = Record<VisionQaDimension, number>;

export interface VisionQaResult {
  readonly ok: boolean;
  readonly average: number;
  readonly scores: VisionQaScores;
  readonly issues: string[];
  readonly notes: string;
  readonly mode: 'vlm' | 'heuristic';
}

export const VISION_QA_PASS_THRESHOLD = 4.0;

export const VISION_QA_RUBRIC_PROMPT = `You are a senior game UI/art QA reviewer.
Score this gameplay screenshot on each dimension from 1 (terrible) to 5 (excellent):
- uiOverlap: UI elements overlapping or covering gameplay/text
- textClipping: Chinese/Latin text cut off at edges or inside panels
- readability: contrast, font size, HUD clarity
- artConsistency: style matches across sprites/bg; no floating busts or solid-color placeholders
- composition: characters grounded with shadows/y-sort; no orange debug rects
- modernFeel: looks like a 2024 indie game, not a 2010 Flash prototype

Return ONLY valid JSON:
{"scores":{"uiOverlap":n,"textClipping":n,"readability":n,"artConsistency":n,"composition":n,"modernFeel":n},"issues":["..."],"notes":"..."}`;

export function averageScores(scores: VisionQaScores): number {
  const vals = VISION_QA_DIMENSIONS.map((d) => scores[d]);
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

export function parseVisionQaJson(raw: string): VisionQaScores | null {
  try {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    const obj = JSON.parse(raw.slice(start, end + 1)) as {
      scores?: Partial<VisionQaScores>;
    };
    if (!obj.scores) return null;
    const scores = {} as VisionQaScores;
    for (const d of VISION_QA_DIMENSIONS) {
      const v = Number(obj.scores[d] ?? 3);
      scores[d] = Math.max(1, Math.min(5, Number.isFinite(v) ? v : 3));
    }
    return scores;
  } catch {
    return null;
  }
}
