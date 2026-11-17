/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { scoreVisionHeuristic, type HeuristicVisionInput } from './heuristic.js';
import {
  averageScores,
  parseVisionQaJson,
  VISION_QA_PASS_THRESHOLD,
  VISION_QA_RUBRIC_PROMPT,
  type VisionQaResult,
  type VisionQaScores,
} from './rubric.js';

export type VisionLlmCaller = (args: {
  readonly prompt: string;
  readonly imageBase64?: string;
  readonly mimeType?: string;
}) => Promise<string>;

export interface ScoreVisionInput extends HeuristicVisionInput {
  /** Optional PNG/JPEG bytes as base64 (no data: prefix). */
  readonly screenshotBase64?: string;
  readonly screenshotMimeType?: string;
  /** Injected LLM/VLM caller. When absent, heuristic only. */
  readonly callVision?: VisionLlmCaller;
}

/**
 * Score a screenshot + structural signals. Prefers VLM when `callVision` is
 * provided and a screenshot is present; otherwise falls back to heuristics.
 */
export async function scoreVision(
  input: ScoreVisionInput,
): Promise<VisionQaResult> {
  const heuristic = scoreVisionHeuristic(input);

  if (!input.callVision || !input.screenshotBase64) {
    return heuristic;
  }

  try {
    const raw = await input.callVision({
      prompt: VISION_QA_RUBRIC_PROMPT,
      imageBase64: input.screenshotBase64,
      mimeType: input.screenshotMimeType ?? 'image/png',
    });
    const scores = parseVisionQaJson(raw);
    if (!scores) {
      return {
        ...heuristic,
        notes: `${heuristic.notes}; VLM response unparseable — kept heuristic.`,
      };
    }
    // Blend: never let VLM fully override structural red flags below 2.5
    const blended = {} as VisionQaScores;
    for (const key of Object.keys(scores) as (keyof VisionQaScores)[]) {
      blended[key] = Math.min(scores[key], Math.max(heuristic.scores[key], 2.5));
      if (heuristic.scores[key] <= 2.5) {
        blended[key] = Math.min(blended[key], heuristic.scores[key] + 0.5);
      }
    }
    const avg = averageScores(blended);
    let issues: string[] = [];
    try {
      const start = raw.indexOf('{');
      const end = raw.lastIndexOf('}');
      const obj = JSON.parse(raw.slice(start, end + 1)) as {
        issues?: string[];
        notes?: string;
      };
      issues = [...(obj.issues ?? []), ...heuristic.issues];
      const notes = obj.notes ?? '';
      return {
        ok: avg >= VISION_QA_PASS_THRESHOLD,
        average: Math.round(avg * 100) / 100,
        scores: blended,
        issues: [...new Set(issues)],
        notes: notes || 'VLM + heuristic blend',
        mode: 'vlm',
      };
    } catch {
      return {
        ok: avg >= VISION_QA_PASS_THRESHOLD,
        average: Math.round(avg * 100) / 100,
        scores: blended,
        issues: heuristic.issues,
        notes: 'VLM scores parsed; issue list from heuristic',
        mode: 'vlm',
      };
    }
  } catch (err) {
    return {
      ...heuristic,
      notes: `VLM failed (${err instanceof Error ? err.message : String(err)}); heuristic used.`,
    };
  }
}

/** Format for FIX prompts so the coder agent can act on visual failures. */
export function formatVisionQaForFixPrompt(result: VisionQaResult): string {
  const lines = [
    `【视觉 QA / Vision QA — ${result.mode} avg=${result.average} ${result.ok ? 'PASS' : 'FAIL'}】`,
    `scores: ${JSON.stringify(result.scores)}`,
    ...result.issues.map((i) => `- ${i}`),
    result.notes ? `notes: ${result.notes}` : '',
    '必须修复：去掉色块占位、禁止文字裁切、角色落地+阴影、用 GameUiKit/wordWrap、优先 tilemap/atlas。',
  ];
  return lines.filter(Boolean).join('\n');
}
