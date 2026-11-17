/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  JOB_LOG_S3_TAIL_SEPARATOR,
  detectLlmQuotaError,
  formatLlmQuotaErrorSummary,
  resolveJobLogS3ObjectKey,
} from '@opengame/platform-shared';

/** Worker 常把可读摘要与 S3 路径用 `; log:` 拼在 `jobs.log_key` 里，气泡里只展示摘要更清楚。 */
export function summarizeJobLogKey(logKey: string | null | undefined): string {
  if (!logKey) return '';
  const i = logKey.indexOf(JOB_LOG_S3_TAIL_SEPARATOR);
  const summary = (i >= 0 ? logKey.slice(0, i) : logKey).trim();
  const quota = detectLlmQuotaError(summary) ?? detectLlmQuotaError(logKey);
  if (quota) {
    return formatLlmQuotaErrorSummary(quota);
  }
  if (/Generate FSM exhausted/i.test(summary)) {
    return '生成失败：代码多次自愈仍无法通过编译或构建。可展开日志查看 TypeScript 错误；若日志含 429，说明 API 配额已用尽，需等配额重置或换 Key。';
  }
  if (/ChangePlan 未落地/.test(summary)) {
    // Prefer worker multi-line recovery block (userSummary + 建议下一句)
    const lines = summary
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const keep = lines.slice(0, 8);
    if (keep.length >= 2) {
      return keep.join('\n');
    }
    return '改口需求连续自愈后仍未落地（已停止空转）。可按日志里的「建议下一句」重试，或先说「重做」再生成。';
  }
  if (/RECOVERY\.json|opengame-job-recovery/i.test(summary)) {
    return summary.slice(0, 600);
  }
  return summary;
}

/**
 * Extract numbered recovery prompts from ChangePlan abort blocks or FAIL tips.
 * Matches 「建议下一句」and product copy used when suggestions are inlined into chat.
 */
export function parseRecoverySuggestedPrompts(
  logOrMessage: string | null | undefined,
): string[] {
  if (!logOrMessage) return [];
  const text = logOrMessage.replace(/\r\n/g, '\n');
  const idx = text.search(
    /建议下一句[:：]|一键填入恢复建议[:：]|Fill chat with a recovery suggestion[:：]|useSuggestionHint/i,
  );
  if (idx < 0) return [];
  const tail = text.slice(idx);
  const prompts: string[] = [];
  for (const line of tail.split('\n')) {
    const m = line.match(/^\s*\d+\.\s*(.+)\s*$/);
    if (m?.[1]) {
      const p = m[1].trim();
      if (p.length >= 4) prompts.push(p.slice(0, 240));
    }
    if (prompts.length >= 4) break;
    if (prompts.length > 0 && /^门禁摘要/.test(line.trim())) break;
  }
  return prompts;
}

export function jobHasS3LogTail(logKey: string | null | undefined): boolean {
  return Boolean(logKey?.includes(JOB_LOG_S3_TAIL_SEPARATOR) && resolveJobLogS3ObjectKey(logKey));
}
