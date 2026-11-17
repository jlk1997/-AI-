/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Heuristic LLM-as-judge stand-in: does a spoken beat sound like the person,
 * cite a memory, and follow the previous line? Numbers complement novelty/spread.
 * Optional `llm` can refine a single score; CI uses the heuristic only.
 */

import type { LlmTextFn } from './reflect.js';

export interface DialogueJudgeScores {
  /** 0–1: line mentions occupation / name / identity tokens. */
  readonly inCharacter: number;
  /** 0–1: overlap with retrieved memories (not just the rumor seed). */
  readonly citesMemory: number;
  /** 0–1: not a verbatim copy of the previous spoken line. */
  readonly followsLast: number;
  readonly summary: string;
}

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s,，。.!？?；;：:\-/「」""]+/)
    .filter((t) => (/[\u4e00-\u9fff]/.test(t) ? t.length >= 2 : t.length > 3));
}

function overlap(a: readonly string[], b: readonly string[]): number {
  if (!a.length || !b.length) return 0;
  const set = new Set(b);
  let n = 0;
  for (const t of a) if (set.has(t)) n += 1;
  return n / a.length;
}

export function judgeDialogue(input: {
  readonly line: string;
  readonly identity: string;
  readonly memories: readonly string[];
  readonly previousLine?: string;
}): DialogueJudgeScores {
  const lineTok = tokens(input.line);
  const idTok = tokens(input.identity);
  const memTok = tokens(input.memories.join(' '));
  const inCharacter = Math.min(1, overlap(lineTok, idTok) * 4);
  const citesMemory = Math.min(1, overlap(lineTok, memTok) * 3);
  const prev = (input.previousLine ?? '').trim();
  const followsLast =
    !prev || input.line.trim() === prev
      ? prev
        ? 0
        : 1
      : overlap(lineTok, tokens(prev)) > 0.85
        ? 0.2
        : 1;
  const summary = `像本人 ${(inCharacter * 100).toFixed(0)}% · 引用记忆 ${(citesMemory * 100).toFixed(0)}% · 接上一句 ${(followsLast * 100).toFixed(0)}%`;
  return { inCharacter, citesMemory, followsLast, summary };
}

export function judgeDialogueBatch(input: {
  readonly lines: ReadonlyArray<{
    readonly text: string;
    readonly identity: string;
    readonly memories: readonly string[];
  }>;
}): DialogueJudgeScores {
  if (!input.lines.length) {
    return {
      inCharacter: 0,
      citesMemory: 0,
      followsLast: 0,
      summary: '无对白',
    };
  }
  let inCharacter = 0;
  let citesMemory = 0;
  let followsLast = 0;
  let prev: string | undefined;
  for (const line of input.lines) {
    const s = judgeDialogue({
      line: line.text,
      identity: line.identity,
      memories: line.memories,
      previousLine: prev,
    });
    inCharacter += s.inCharacter;
    citesMemory += s.citesMemory;
    followsLast += s.followsLast;
    prev = line.text;
  }
  const n = input.lines.length;
  const out = {
    inCharacter: inCharacter / n,
    citesMemory: citesMemory / n,
    followsLast: followsLast / n,
    summary: '',
  };
  return {
    ...out,
    summary: `像本人 ${(out.inCharacter * 100).toFixed(0)}% · 引用记忆 ${(out.citesMemory * 100).toFixed(0)}% · 接上一句 ${(out.followsLast * 100).toFixed(0)}%`,
  };
}

/** Optional MiniMax pass — never required for CI gates. */
export async function llmJudgeDialogue(input: {
  readonly llm: LlmTextFn;
  readonly line: string;
  readonly identity: string;
}): Promise<number | undefined> {
  try {
    const raw = await input.llm(
      `给这句对白打分 0–10：是否像「${input.identity.slice(0, 40)}」本人在说话。只返回一个整数。\n对白：${input.line.slice(0, 80)}`,
    );
    const n = Number(raw.replace(/[^\d.-]/g, '').slice(0, 4));
    if (!Number.isFinite(n)) return undefined;
    return Math.max(0, Math.min(1, n / 10));
  } catch {
    return undefined;
  }
}
