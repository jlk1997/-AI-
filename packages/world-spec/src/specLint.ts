/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * 批次 11：world spec 静态检查（重复 n-gram + 模板腔检测）。
 *
 * 动机：planner 出来的 spec 偶尔会出现：
 *   - meta.summary / presentation.openingRumor / region.description 字面大量重复；
 *   - 整段都是模板腔词（"神秘的森林"、"古老的村庄"）拼出来的；
 * 这两类问题严重影响"可读性"（plan 1.0 诊断的核心痛点），必须能在写库之前拦住。
 *
 * 设计：
 *   - 纯字符串 + 数组，不依赖 DOM / Node；
 *   - 返回 lint issues 而非抛错，planner / quality gate 可决定是否触发二次润色；
 *   - 支持中英文：分词时按 unicode 字符 + 简单停用词过滤。
 */

export type SpecLintSeverity = 'info' | 'warn' | 'error';

export type SpecLintIssue = {
  readonly severity: SpecLintSeverity;
  readonly code:
    | 'duplicate_ngram'
    | 'template_cliche'
    | 'too_short'
    | 'identical_fields';
  readonly path: string; // 例：`meta.summary`
  readonly detail: string;
  /** 命中的 n-gram 或词（用于前端 hover 展示） */
  readonly hit?: string;
};

export type SpecLintOptions = {
  /** n-gram 长度，默认 3 字符（中文 3 字）；英文按 token。 */
  readonly ngramSize?: number;
  /** 触发重复告警的阈值（n-gram 出现次数 >= 该值）。 */
  readonly repeatThreshold?: number;
  /** 最小字符串长度，少于则不再检测重复。 */
  readonly minFieldLength?: number;
  /** 模板腔词典（命中即记录）。 */
  readonly cliches?: readonly string[];
};

const DEFAULT_CLICHES: readonly string[] = [
  // 中文模板腔
  '神秘的森林',
  '古老的村庄',
  '一个神秘的',
  '一个古老的',
  '传说中的',
  '充满神秘的',
  '充满魅力',
  '没有人知道',
  '据说很久以前',
  '一座神秘',
  '万籁俱寂',
  '夜色降临',
  '命运的齿轮',
  // 英文模板腔
  'a mysterious',
  'an ancient',
  'once upon a time',
  'in a far away land',
  'a long time ago',
  'mysterious forest',
  'ancient village',
];

const STOPWORDS_ZH = new Set([
  '的',
  '了',
  '在',
  '是',
  '我',
  '你',
  '他',
  '她',
  '它',
  '们',
  '和',
  '与',
  '或',
  '也',
  '都',
  '就',
  '那',
  '这',
  '一个',
  '一些',
  '我们',
  '你们',
  '他们',
  '这那',
  '那么',
  '所以',
  '因为',
  '但是',
  '不过',
  '而是',
]);

const STOPWORDS_EN = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'but',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'of',
  'in',
  'on',
  'at',
  'to',
  'for',
  'with',
  'as',
  'by',
  'this',
  'that',
  'these',
  'those',
  'it',
  'its',
  'he',
  'she',
  'his',
  'her',
  'they',
  'them',
  'their',
  'i',
  'we',
  'you',
  'my',
  'your',
]);

function tokenize(text: string): readonly string[] {
  const lower = text.toLowerCase();
  // 英文：按 \W+ 切，2字以上才算 token
  const enTokens = lower
    .replace(/[\u4e00-\u9fa5]/g, ' ')
    .split(/[^a-z0-9']+/)
    .filter((w) => w.length >= 2 && !STOPWORDS_EN.has(w));
  // 中文：按 2-gram 切（粗略，但足够稳定）
  const zhText = lower.replace(/[^\u4e00-\u9fa5]+/g, ' ');
  const zhChars = zhText.split(/\s+/).filter(Boolean).join('');
  const zhTokens: string[] = [];
  for (let i = 0; i + 2 <= zhChars.length; i++) {
    const tri = zhChars.slice(i, i + 2);
    if (tri.includes('的')) continue;
    zhTokens.push(tri);
  }
  // 注意：不去重！n-gram 计算依赖 token 出现次数
  return [...enTokens, ...zhTokens];
}

function ngrams(tokens: readonly string[], n: number): readonly string[] {
  if (tokens.length < n) return [];
  const out: string[] = [];
  for (let i = 0; i + n <= tokens.length; i++) {
    out.push(tokens.slice(i, i + n).join(' '));
  }
  return out;
}

function findRepeat(
  field: string,
  tokens: readonly string[],
  n: number,
  threshold: number,
): SpecLintIssue | null {
  const grams = ngrams(tokens, n);
  if (!grams.length) return null;
  const counts = new Map<string, number>();
  for (const g of grams) {
    counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  let worst: { hit: string; count: number } | null = null;
  for (const [g, c] of counts) {
    if (c < threshold) continue;
    if (!worst || c > worst.count) worst = { hit: g, count: c };
  }
  if (!worst) return null;
  return {
    severity: 'warn',
    code: 'duplicate_ngram',
    path: field,
    detail: `"${worst.hit}" 出现了 ${worst.count} 次`,
    hit: worst.hit,
  };
}

function findCliche(field: string, text: string, cliches: readonly string[]): SpecLintIssue[] {
  const lower = text.toLowerCase();
  const issues: SpecLintIssue[] = [];
  for (const c of cliches) {
    if (lower.includes(c.toLowerCase())) {
      issues.push({
        severity: 'warn',
        code: 'template_cliche',
        path: field,
        detail: `含模板腔：${c}`,
        hit: c,
      });
    }
  }
  return issues;
}

/**
 * 检查单个字段。返回 issues 数组（可能为空）。
 */
export function lintSpecField(
  fieldPath: string,
  text: string | null | undefined,
  options?: SpecLintOptions,
): readonly SpecLintIssue[] {
  const opts = options ?? {};
  const ngramSize = opts.ngramSize ?? 3;
  const repeatThreshold = opts.repeatThreshold ?? 3;
  const minLen = opts.minFieldLength ?? 12;
  const cliches = opts.cliches ?? DEFAULT_CLICHES;

  if (!text) return [];
  const issues: SpecLintIssue[] = [];
  if (text.length < minLen) {
    issues.push({
      severity: 'info',
      code: 'too_short',
      path: fieldPath,
      detail: `长度仅 ${text.length} 字符，少于 ${minLen}`,
    });
    return issues;
  }
  issues.push(...findCliche(fieldPath, text, cliches));
  const tokens = tokenize(text);
  const dup = findRepeat(fieldPath, tokens, ngramSize, repeatThreshold);
  if (dup) issues.push(dup);
  return issues;
}

export type SpecField = {
  readonly path: string;
  readonly text: string | null | undefined;
};

/**
 * 检查多个字段；同时检测跨字段完全相同（identical_fields）。
 */
export function lintSpecFields(
  fields: readonly SpecField[],
  options?: SpecLintOptions,
): readonly SpecLintIssue[] {
  const issues: SpecLintIssue[] = [];
  const seen = new Map<string, string[]>();
  for (const f of fields) {
    issues.push(...lintSpecField(f.path, f.text, options));
    const norm = (f.text ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (norm.length < 8) continue;
    if (!seen.has(norm)) seen.set(norm, []);
    seen.get(norm)!.push(f.path);
  }
  for (const [text, paths] of seen) {
    if (paths.length < 2) continue;
    issues.push({
      severity: 'error',
      code: 'identical_fields',
      path: paths.join(' / '),
      detail: `多个字段文案完全相同：${text.slice(0, 32)}…`,
      hit: text.slice(0, 48),
    });
  }
  return issues;
}