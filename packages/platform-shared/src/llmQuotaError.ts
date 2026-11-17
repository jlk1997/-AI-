/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { JOB_LOG_S3_TAIL_SEPARATOR } from './jobLog.js';

export interface LlmQuotaErrorInfo {
  readonly provider: string;
  readonly resetAt: string | null;
  readonly snippet: string;
  /** quota = rate/token plan; billing = overdue / insufficient balance */
  readonly kind?: 'quota' | 'billing';
}

/** Human summary + S3 object key, stored in `jobs.log_key`. */
export function composeJobLogKey(summary: string, s3ObjectKey: string): string {
  return `${summary.trim()}${JOB_LOG_S3_TAIL_SEPARATOR} ${s3ObjectKey.trim()}`;
}

function looksLikeBilling(haystack: string): boolean {
  return (
    /overdue balance/i.test(haystack) ||
    /account.*(arrear|overdue|delinquent)/i.test(haystack) ||
    /欠费/.test(haystack) ||
    /余额不足/.test(haystack) ||
    (/\b403\b/.test(haystack) &&
      /balance|billing|payment|account|欠费|余额/i.test(haystack))
  );
}

/** True when a line looks like an API / HTTP error rather than agent-written game code. */
function isApiOrProviderErrorLine(line: string): boolean {
  return (
    /Chat completion failed/i.test(line) ||
    /API\s*Error/i.test(line) ||
    /\bHTTP\s*\d{3}\b/i.test(line) ||
    /status(?:_code)?["\s:=]+\d{3,4}\b/i.test(line) ||
    /base_resp/i.test(line) ||
    /OpenAI|MiniMax|Volcengine|Ark|doubao/i.test(line) ||
    /ProviderError|RateLimitError|InsufficientQuota/i.test(line) ||
    /openai|minimaxi\.com|volces\.com/i.test(line)
  );
}

function lineLooksLikeQuotaOrBilling(line: string): boolean {
  if (looksLikeBilling(line)) return true;
  return (
    /\bHTTP\s*429\b/i.test(line) ||
    /Chat completion failed:\s*429\b/i.test(line) ||
    /:\s*429\s*[-:]/.test(line) ||
    /\bstatus(?:_code)?["\s:=]+429\b/i.test(line) ||
    /\b429\b[^.\n]{0,80}(rate|limit|usage|quota|Token Plan|用量|配额|速率)/i.test(
      line,
    ) ||
    /\b(rate|limit|usage|quota|Token Plan|用量|配额|速率)[^.\n]{0,80}\b429\b/i.test(
      line,
    ) ||
    /\b2056\b/.test(line) ||
    /status\s*2056/i.test(line) ||
    /status_code["\s:=]+2056\b/i.test(line) ||
    /usage limit exceeded/i.test(line) ||
    /rate[- ]?limit(ed| exceed(ed)?)?/i.test(line) ||
    /too many requests/i.test(line) ||
    /Token Plan/i.test(line) ||
    /用量上限/.test(line) ||
    /速率限制/.test(line) ||
    /超过.*(?:用量|配额|频率|速率)/.test(line) ||
    /(?:用量|配额|频率|速率).*(?:超|满|用尽|耗尽)/.test(line) ||
    /\b(quota|rate[_ ]?limit)\b[^.\n]{0,40}\b(exceed|exceeded|exhausted|reached)/i.test(
      line,
    ) ||
    /\b(exceed|exceeded|exhausted|reached)\b[^.\n]{0,40}\b(quota|rate[_ ]?limit)/i.test(
      line,
    )
  );
}

/**
 * Only accept reset timestamps that look like real provider reset times —
 * never capture game-code phrases like "score is only reset in collectCoin".
 */
export function extractQuotaResetAt(text: string): string | null {
  const patterns = [
    /resets?\s+at\s+(\d{4}-\d{2}-\d{2}[T\s]\d{1,2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2})?)/i,
    /resets?\s+at\s+(\d{4}-\d{2}-\d{2})/i,
    /resets?\s+at\s+(\d{1,2}:\d{2}(?::\d{2})?\s*(?:UTC|GMT|[AP]M)?)/i,
    /resets?\s+in\s+(\d+\s*(?:seconds?|minutes?|hours?|days?|秒|分钟|小时|天))/i,
    /(?:重置|恢复).{0,6}(\d{4}-\d{2}-\d{2}[^\s，,]{0,20})/,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    const v = m?.[1]?.trim();
    if (v && v.length <= 64) return v;
  }
  return null;
}

function inferProvider(haystack: string): string {
  if (/minimax/i.test(haystack) || /Token Plan/i.test(haystack)) {
    return 'MiniMax';
  }
  if (/volcengine|ark\.cn-beijing|doubao|overdue balance/i.test(haystack)) {
    return 'Volcengine Ark';
  }
  if (/openai/i.test(haystack)) {
    return 'OpenAI';
  }
  return 'LLM API';
}

/**
 * Detect provider quota / rate-limit / billing failures in CLI or API stderr.
 *
 * Scans **line-by-line** and prefers API/provider error lines. Agent CODE
 * transcripts often contain phrases like "reset at scene start" or "rate
 * limit" in comments — those must NOT hard-fail the job as MiniMax 429.
 */
export function detectLlmQuotaError(text: string): LlmQuotaErrorInfo | null {
  if (!text?.trim()) return null;

  // Real API failures land near the end; earlier chunks are usually agent I/O.
  const haystack = text.length > 16_000 ? text.slice(-16_000) : text;
  const lines = haystack
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const apiHits = lines.filter(
    (l) => isApiOrProviderErrorLine(l) && lineLooksLikeQuotaOrBilling(l),
  );
  const anyHits = lines.filter((l) => lineLooksLikeQuotaOrBilling(l));

  // Prefer API-shaped hits. Fall back to any hit only when the line itself
  // carries a strong signal (429 / 2056 / overdue), not soft "rate limit" alone.
  let hit =
    apiHits[apiHits.length - 1] ??
    [...anyHits]
      .reverse()
      .find(
        (l) =>
          /\b429\b/.test(l) ||
          /\b2056\b/.test(l) ||
          /usage limit exceeded/i.test(l) ||
          /rate[- ]?limit(ed)?\s+exceed/i.test(l) ||
          /too many requests/i.test(l) ||
          /Token Plan/i.test(l) ||
          /用量上限|速率限制|欠费|余额不足|overdue/i.test(l) ||
          looksLikeBilling(l),
      ) ??
    null;

  if (!hit) return null;

  const billing = looksLikeBilling(hit) || looksLikeBilling(haystack);
  const resetAt = extractQuotaResetAt(hit) ?? extractQuotaResetAt(haystack);

  return {
    provider: inferProvider(`${hit}\n${haystack.slice(-800)}`),
    resetAt,
    snippet: hit.slice(0, 280),
    kind: billing ? 'billing' : 'quota',
  };
}

/** True when an Error / string looks like a provider quota or rate-limit failure. */
export function isLlmQuotaErrorLike(err: unknown): boolean {
  if (err == null) return false;
  if (typeof err === 'string') return detectLlmQuotaError(err) != null;
  if (err instanceof Error) {
    const bag = `${err.message}\n${err.name}\n${String((err as { cause?: unknown }).cause ?? '')}`;
    return detectLlmQuotaError(bag) != null;
  }
  return detectLlmQuotaError(String(err)) != null;
}

export interface LlmAuthErrorInfo {
  readonly provider: string;
  readonly snippet: string;
}

/**
 * Detect provider auth / invalid-key failures (e.g. MiniMax status 2049).
 * These are NOT quota — but dual-key pools should still rotate to a spare key.
 */
export function detectLlmAuthError(text: string): LlmAuthErrorInfo | null {
  if (!text?.trim()) return null;
  const haystack = text.length > 8_000 ? text.slice(-8_000) : text;
  const lines = haystack
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const lineLooksAuth = (line: string): boolean =>
    /\b2049\b/.test(line) ||
    /status(?:_code)?["\s:=]+2049\b/i.test(line) ||
    /invalid[_\s-]?api[_\s-]?key/i.test(line) ||
    /api[_\s-]?key.*(invalid|expired|revoked|disabled)/i.test(line) ||
    /(invalid|expired|revoked|disabled).*(api[_\s-]?key|token)/i.test(line) ||
    /\bHTTP\s*401\b/i.test(line) ||
    /unauthorized/i.test(line) ||
    /鉴权失败|密钥无效|登录失效|API\s*Key\s*无效/.test(line);

  const apiHits = lines.filter(
    (l) => isApiOrProviderErrorLine(l) && lineLooksAuth(l),
  );
  const anyHits = lines.filter((l) => lineLooksAuth(l));
  const hit =
    apiHits[apiHits.length - 1] ??
    [...anyHits]
      .reverse()
      .find(
        (l) =>
          /\b2049\b/.test(l) ||
          /invalid[_\s-]?api[_\s-]?key/i.test(l) ||
          /\bHTTP\s*401\b/i.test(l),
      ) ??
    null;
  if (!hit) return null;
  return {
    provider: inferProvider(`${hit}\n${haystack.slice(-800)}`),
    snippet: hit.slice(0, 280),
  };
}

/** True when an Error / string looks like invalid API key / auth failure. */
export function isLlmAuthErrorLike(err: unknown): boolean {
  if (err == null) return false;
  if (typeof err === 'string') return detectLlmAuthError(err) != null;
  if (err instanceof Error) {
    const bag = `${err.message}\n${err.name}\n${String((err as { cause?: unknown }).cause ?? '')}`;
    return detectLlmAuthError(bag) != null;
  }
  return detectLlmAuthError(String(err)) != null;
}

/**
 * Quota/rate/billing OR auth — both should trigger dual-key pool rotation.
 * Auth alone must not be soft-skipped as "额度用尽".
 */
export function isLlmKeyRotateErrorLike(err: unknown): boolean {
  return isLlmQuotaErrorLike(err) || isLlmAuthErrorLike(err);
}

/** Short user-facing summary (Chinese-first for platform UI). */
export function formatLlmQuotaErrorSummary(info: LlmQuotaErrorInfo): string {
  if (info.kind === 'billing') {
    return `${info.provider} 账号欠费或余额不足（403），API 已拒绝请求。请到对应控制台充值/结清后再生成；若已配置第二条 MiniMax Key，确认 Worker 已重启加载 FALLBACK_*。`;
  }
  const reset =
    info.resetAt && extractQuotaResetAt(`resets at ${info.resetAt}`)
      ? `，配额约 ${info.resetAt} 重置`
      : '';
  return `${info.provider} API 配额或速率已用尽（429/额度）${reset}。请稍后再试，或更换 API Key / 升级套餐 / 确认备路 Key（OPENGAME_FALLBACK_*）已生效后再生成。`;
}
