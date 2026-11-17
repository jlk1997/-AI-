/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/** Worker 常把可读摘要与 S3 对象键用此后缀拼在 `jobs.log_key` 里。 */
export const JOB_LOG_S3_TAIL_SEPARATOR = '; log:';

/**
 * 从 `jobs.log_key` 得到可用于 S3 GetObject / 公开 URL 的对象键；若无则返回 null。
 * 支持纯键 `projects/.../log.txt` 与 `摘要${JOB_LOG_S3_TAIL_SEPARATOR} projects/.../log.txt`。
 */
export function resolveJobLogS3ObjectKey(logKey: string | null | undefined): string | null {
  if (!logKey?.trim()) return null;
  const trimmed = logKey.trim();
  if (trimmed.startsWith('projects/')) return trimmed;
  const parts = trimmed.split(JOB_LOG_S3_TAIL_SEPARATOR);
  for (let i = parts.length - 1; i >= 1; i--) {
    const tail = parts[i]?.trim() ?? '';
    if (tail.startsWith('projects/')) return tail;
  }
  return null;
}

/** Readable prefix of `jobs.log_key` when the worker appended `; log: projects/...`. */
export function summarizeJobLogKey(logKey: string | null | undefined): string {
  if (!logKey) return '';
  const i = logKey.indexOf(JOB_LOG_S3_TAIL_SEPARATOR);
  return (i >= 0 ? logKey.slice(0, i) : logKey).trim();
}
