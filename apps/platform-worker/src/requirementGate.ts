/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Checks the delivered workspace against the requirements extracted from the
 * user's prompt (see {@link ./requirementSpec.ts}).
 *
 * This is a *soft* gate on purpose. A false "missing" verdict would spend a FIX
 * round of the generation budget chasing a mechanic that is already there, so it
 * never fails a job by itself and never revokes an already-delivered playable
 * preview — it only contributes lines to the escalation prompt, where the coder
 * still has the workspace in front of it.
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

import {
  readRequirementSpec,
  type RequiredFeature,
  type RequirementSpec,
} from './requirementSpec.js';

export interface RequirementCheck {
  readonly id: string;
  readonly label: string;
  readonly satisfied: boolean;
  /** Which of the feature's signals were found, for debugging a verdict. */
  readonly matched: readonly string[];
  readonly hint: string;
}

export interface RequirementGateResult {
  /** True when every claimed feature has enough evidence (or none were claimed). */
  readonly ok: boolean;
  readonly checks: readonly RequirementCheck[];
  readonly missing: readonly RequirementCheck[];
  /** Human-readable issues, shaped like the other gates' `issues`. */
  readonly issues: string[];
}

/**
 * Narrative JSON is deliberately excluded from the evidence: a line of dialogue
 * saying "我去钓鱼了" is not a fishing mechanic, and counting prose as proof was
 * the obvious way for this gate to be confidently wrong.
 */
const NARRATIVE_JSON = /^(?:STORY_BIBLE|CONTENT_GRAPH|CONTENT|SYSTEMS|chapter_\d+|REQUIREMENTS|VISION_QA)\.json$/i;

async function collectTsSources(dir: string, out: string[], depth = 0): Promise<void> {
  if (depth > 4 || !fs.existsSync(dir)) return;
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      await collectTsSources(full, out, depth + 1);
    } else if (entry.isFile() && /\.(?:ts|tsx|js)$/.test(entry.name)) {
      out.push(await fsp.readFile(full, 'utf8'));
    }
  }
}

/** Everything that counts as proof a mechanic was implemented. */
export async function readRequirementEvidence(workspace: string): Promise<string> {
  const parts: string[] = [];
  await collectTsSources(path.join(workspace, 'src'), parts);

  const publicDir = path.join(workspace, 'public');
  if (fs.existsSync(publicDir)) {
    for (const name of await fsp.readdir(publicDir)) {
      if (!name.endsWith('.json') || NARRATIVE_JSON.test(name)) continue;
      parts.push(await fsp.readFile(path.join(publicDir, name), 'utf8'));
    }
  }
  return parts.join('\n');
}

export function checkRequirement(
  feature: RequiredFeature,
  evidence: string,
): RequirementCheck {
  const matched: string[] = [];
  for (const signal of feature.signals) {
    try {
      if (new RegExp(signal, 'i').test(evidence)) matched.push(signal);
    } catch {
      // A malformed pattern must not be read as "implemented".
    }
  }
  return {
    id: feature.id,
    label: feature.label,
    satisfied: matched.length >= Math.max(1, feature.minSignals),
    matched,
    hint: feature.hint,
  };
}

/** Escape hatch, like the other soft gates: `false` disables the check. */
export function requirementGateEnabled(): boolean {
  return process.env['PLATFORM_REQUIREMENT_GATE'] !== 'false';
}

export async function runRequirementGate(
  workspace: string,
  spec?: RequirementSpec | null,
): Promise<RequirementGateResult> {
  const resolved = requirementGateEnabled()
    ? (spec ?? readRequirementSpec(workspace))
    : null;
  if (!resolved || resolved.features.length === 0) {
    return { ok: true, checks: [], missing: [], issues: [] };
  }
  const evidence = await readRequirementEvidence(workspace);
  const checks = resolved.features.map((f) => checkRequirement(f, evidence));
  const missing = checks.filter((c) => !c.satisfied);
  return {
    ok: missing.length === 0,
    checks,
    missing,
    issues: missing.map((m) => `需求未落地: ${m.label} — ${m.hint}`),
  };
}

/** FIX-round instruction naming each missing mechanic and how to land it. */
export function formatRequirementFixPrompt(result: RequirementGateResult): string {
  return [
    '【需求贴合门禁 / Requirement fit】用户点名要求的玩法在工作区里找不到实现证据：',
    ...result.missing.map((m) => `- ${m.label}：${m.hint}`),
    '',
    '要求：把上述玩法真的实现进 Scene/DSL（不是只在对话文案里提到），',
    '保留现有可玩闭环与已通过的门禁，不要重写整个项目。',
  ].join('\n');
}
