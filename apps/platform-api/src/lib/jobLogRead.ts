/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Studio reads full CLI logs through the API so the browser never depends
 * on S3 CORS / public-object URLs.
 */

export const JOB_LOG_TEXT_MAX = 400_000;

export function clipJobLogText(text: string, max = JOB_LOG_TEXT_MAX): {
  text: string;
  truncated: boolean;
} {
  if (text.length <= max) return { text, truncated: false };
  const omitted = text.length - max;
  return {
    text: `${text.slice(0, max)}\n\n… truncated ${omitted} characters`,
    truncated: true,
  };
}

export function composeJobLogPayload(opts: {
  readonly logKey: string;
  readonly objectText: string | null;
  readonly objectKey: string | null;
}): {
  text: string;
  source: 's3' | 'inline';
  truncated: boolean;
  key: string | null;
} {
  const summary = opts.logKey.includes('; log:')
    ? opts.logKey.slice(0, opts.logKey.indexOf('; log:')).trim()
    : '';
  if (opts.objectText != null) {
    const body = summary && !opts.objectText.startsWith(summary)
      ? `${summary}\n\n---\n\n${opts.objectText}`
      : opts.objectText;
    const clipped = clipJobLogText(body);
    return {
      text: clipped.text,
      source: 's3',
      truncated: clipped.truncated,
      key: opts.objectKey,
    };
  }
  const clipped = clipJobLogText(opts.logKey);
  return {
    text: clipped.text,
    source: 'inline',
    truncated: clipped.truncated,
    key: null,
  };
}
