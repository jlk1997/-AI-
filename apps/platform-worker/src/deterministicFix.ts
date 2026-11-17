/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Deterministic TypeScript repairs for the generate self-heal loop.
 *
 * `summarizeBuildFailure` used to encode these same rules as *prompt hints*:
 * every `TS2554 lineStyle(color)` or `TS18047 possibly null` cost a full CLI
 * Agent round (minutes + tokens) to fix one character. The rules are mechanical,
 * so we apply them here as line/column-targeted codemods and only escalate to
 * the Agent when the compiler still complains.
 *
 * Rules are intentionally conservative: they never restructure code, only make
 * the minimal edit tsc asks for, and they refuse to touch anything outside
 * `src/`.
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

export interface TscDiagnostic {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly code: string;
  readonly message: string;
}

export interface DeterministicFixResult {
  readonly ok: boolean;
  /** Human-readable edits for the agent timeline. */
  readonly applied: string[];
  readonly files: string[];
  /** Diagnostics we recognized but could not safely rewrite. */
  readonly skipped: string[];
}

const MAX_EDITS = 40;

/** Parses non-pretty tsc output: `src/x.ts(12,5): error TS2531: message`. */
export function parseTscDiagnostics(output: string): TscDiagnostic[] {
  const out: TscDiagnostic[] = [];
  const re =
    /^(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.*)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(output)) !== null) {
    const [, file, line, column, code, message] = m;
    if (!file || !line || !column || !code) continue;
    out.push({
      file: file.replace(/\\/g, '/').trim(),
      line: Number(line),
      column: Number(column),
      code,
      message: (message ?? '').trim(),
    });
  }
  return out;
}

/** `lineStyle(0xff0000)` → `lineStyle(2, 0xff0000)` (Phaser needs width first). */
function fixLineStyleArity(line: string): string | null {
  const re = /\.lineStyle\(\s*([^,()]+?)\s*\)/g;
  let changed = false;
  const next = line.replace(re, (whole, arg: string) => {
    if (!/^0x[0-9a-f]+$|^\d+$|^[A-Za-z_$][\w$.]*$/i.test(arg.trim())) {
      return whole;
    }
    changed = true;
    return `.lineStyle(2, ${arg.trim()})`;
  });
  return changed ? next : null;
}

/** `a?.b.c = v` is illegal — `a!.b.c = v` keeps the intent with one char. */
function fixOptionalChainAssignment(line: string): string | null {
  const eq = line.indexOf('=');
  if (eq < 0) return null;
  // Skip comparisons / compound tokens that are not plain assignment.
  if (/[=!<>+\-*/%&|^]=/.test(line.slice(Math.max(0, eq - 1), eq + 2))) {
    if (line[eq + 1] === '=' || line[eq - 1] === '=') return null;
  }
  const lhs = line.slice(0, eq);
  if (!lhs.includes('?.')) return null;
  return `${lhs.replace(/\?\./g, '!.')}=${line.slice(eq + 1)}`;
}

/**
 * Inserts `!` after the expression tsc flagged as possibly null/undefined.
 *
 * TS18047/TS18048 quote the offending expression in the message, which is the
 * exact text to bang. TS2531/TS2532 only say "Object is possibly null" and point
 * at the object of a property access, so we take the dotted chain at that column
 * and drop its last segment (the property being read) to recover the object.
 */
function fixPossiblyNull(
  line: string,
  column: number,
  message: string,
): string | null {
  const named = /^'([^']+)' is possibly/.exec(message);
  if (named?.[1]) {
    const target = named[1];
    const at = line.indexOf(target, Math.max(0, column - 1));
    if (at < 0) return null;
    const end = at + target.length;
    if (line[end] === '!') return null;
    return `${line.slice(0, end)}!${line.slice(end)}`;
  }
  const idx = column - 1;
  if (idx < 0 || idx >= line.length) return null;
  const m = /^(?:this|[A-Za-z_$][\w$]*)(?:\.[A-Za-z_$][\w$]*)+/.exec(
    line.slice(idx),
  );
  const chain = m?.[0];
  if (!chain) return null;
  const lastDot = chain.lastIndexOf('.');
  if (lastDot <= 0) return null;
  const end = idx + lastDot;
  if (line[end] === '!') return null;
  return `${line.slice(0, end)}!${line.slice(end)}`;
}

/** `{ y: 10 }` where `Vector2Like` needs both axes → `{ x: 0, y: 10 }`. */
function fixVector2Like(line: string): string | null {
  const re = /\{\s*(x|y)\s*:/;
  const m = re.exec(line);
  if (!m) return null;
  const present = m[1];
  const missing = present === 'x' ? 'y' : 'x';
  if (new RegExp(`\\b${missing}\\s*:`).test(line)) return null;
  const at = m.index + m[0].length - (present!.length + 1);
  return `${line.slice(0, at)}${missing}: 0, ${line.slice(at)}`;
}

function describe(d: TscDiagnostic, what: string): string {
  return `${d.file}:${d.line} ${d.code} — ${what}`;
}

/**
 * Applies every rule we can prove safe, then reports what changed so the caller
 * can re-run typecheck before spending another Agent round.
 */
export async function runDeterministicFix(
  workspace: string,
  typecheckOutput: string,
): Promise<DeterministicFixResult> {
  const diagnostics = parseTscDiagnostics(typecheckOutput);
  const applied: string[] = [];
  const skipped: string[] = [];
  const touched = new Set<string>();
  if (diagnostics.length === 0) {
    return { ok: false, applied, files: [], skipped };
  }

  const byFile = new Map<string, TscDiagnostic[]>();
  for (const d of diagnostics) {
    const rel = d.file.replace(/^\.\//, '');
    if (!rel.startsWith('src/') || !rel.endsWith('.ts')) {
      skipped.push(describe(d, 'outside src/*.ts'));
      continue;
    }
    const list = byFile.get(rel) ?? [];
    list.push(d);
    byFile.set(rel, list);
  }

  for (const [rel, list] of byFile) {
    const full = path.join(workspace, rel);
    if (!fs.existsSync(full)) {
      skipped.push(`${rel} — file missing`);
      continue;
    }
    const original = await fsp.readFile(full, 'utf8');
    const eol = original.includes('\r\n') ? '\r\n' : '\n';
    const lines = original.split(/\r?\n/);
    let fileChanged = false;

    // Right-to-left within a line keeps earlier columns valid.
    const ordered = [...list].sort((a, b) =>
      a.line === b.line ? b.column - a.column : a.line - b.line,
    );
    for (const d of ordered) {
      if (applied.length >= MAX_EDITS) {
        skipped.push(describe(d, 'edit cap reached'));
        continue;
      }
      const idx = d.line - 1;
      const current = lines[idx];
      if (current === undefined) {
        skipped.push(describe(d, 'line out of range'));
        continue;
      }
      let next: string | null = null;
      let what = '';
      if (d.code === 'TS2554' && /lineStyle/.test(current)) {
        next = fixLineStyleArity(current);
        what = 'lineStyle(color) → lineStyle(width, color)';
      } else if (d.code === 'TS2779') {
        next = fixOptionalChainAssignment(current);
        what = 'optional-chain 赋值 → 非空断言';
      } else if (
        d.code === 'TS2531' ||
        d.code === 'TS2532' ||
        d.code === 'TS18047' ||
        d.code === 'TS18048'
      ) {
        next = fixPossiblyNull(current, d.column, d.message);
        what = 'possibly null/undefined → 非空断言';
      } else if (d.code === 'TS2741' && /Vector2Like/.test(d.message)) {
        next = fixVector2Like(current);
        what = 'Vector2Like 补全 x/y';
      }
      if (next === null || next === current) {
        if (what) skipped.push(describe(d, `${what}（无法安全改写）`));
        else skipped.push(describe(d, '无确定性规则'));
        continue;
      }
      lines[idx] = next;
      fileChanged = true;
      applied.push(describe(d, what));
    }

    if (fileChanged) {
      await fsp.writeFile(full, lines.join(eol), 'utf8');
      touched.add(rel);
    }
  }

  return {
    ok: applied.length > 0,
    applied,
    files: [...touched],
    skipped,
  };
}

/** Timeline-friendly one-liner. */
export function formatDeterministicFixSummary(
  result: DeterministicFixResult,
): string {
  if (!result.ok) return '确定性修复：无可用规则，转交 Agent';
  return `确定性修复：${result.applied.length} 处（${result.files.length} 文件），无需 Agent 轮次`;
}
