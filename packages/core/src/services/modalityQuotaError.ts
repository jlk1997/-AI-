/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Lightweight quota/rate-limit detection for Core (kept in-package to avoid
 * a hard dependency cycle on @opengame/platform-shared). Keep rules aligned
 * with packages/platform-shared/src/llmQuotaError.ts.
 *
 * IMPORTANT: do NOT match bare `/quota/` or `/配额/` — MiniMax / Ark error
 * bodies often mention "quota" in help text even when the real failure is
 * 401/400/safety, which previously caused false failovers to Volcengine.
 */

function errText(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err instanceof Error) {
    return `${err.message}\n${err.name}\n${String((err as { cause?: unknown }).cause ?? '')}`;
  }
  return String(err ?? '');
}

/**
 * True only for clear rate-limit / Token-Plan / usage-cap failures that should
 * rotate the provider pool. Non-quota API errors must return false.
 */
export function isModalityQuotaError(err: unknown): boolean {
  const text = errText(err);
  if (!text.trim()) return false;

  // Strong HTTP / provider status signals.
  if (
    /\bHTTP\s*429\b/i.test(text) ||
    /Chat completion failed:\s*429\b/i.test(text) ||
    /:\s*429\s*[-:]/.test(text) ||
    /\bstatus(?:_code)?["\s:=]+429\b/i.test(text) ||
    /\b429\b[^.\n]{0,80}(rate|limit|usage|quota|Token Plan|用量|配额|速率)/i.test(
      text,
    ) ||
    /\b(rate|limit|usage|quota|Token Plan|用量|配额|速率)[^.\n]{0,80}\b429\b/i.test(
      text,
    )
  ) {
    return true;
  }

  // MiniMax Token Plan cap (documented as status 2056).
  if (
    /\b2056\b/.test(text) ||
    /status\s*2056/i.test(text) ||
    /status_code["\s:=]+2056\b/i.test(text)
  ) {
    return true;
  }

  // Explicit usage / rate language (require a verb-ish phrase, not the bare word).
  if (
    /usage limit exceeded/i.test(text) ||
    /rate limit(ed| exceed)?/i.test(text) ||
    /too many requests/i.test(text) ||
    /Token Plan/i.test(text) ||
    /用量上限/.test(text) ||
    /速率限制/.test(text) ||
    /超过.*(?:用量|配额|频率|速率)/.test(text) ||
    /(?:用量|配额|频率|速率).*(?:超|满|用尽|耗尽)/.test(text) ||
    /\b(quota|rate[_ ]?limit)\b[^.\n]{0,40}\b(exceed|exceeded|exhausted|reached)/i.test(
      text,
    ) ||
    /\b(exceed|exceeded|exhausted|reached)\b[^.\n]{0,40}\b(quota|rate[_ ]?limit)/i.test(
      text,
    )
  ) {
    return true;
  }

  return false;
}
