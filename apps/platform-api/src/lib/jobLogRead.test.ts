/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import { clipJobLogText, composeJobLogPayload } from './jobLogRead.js';

describe('clipJobLogText', () => {
  it('leaves short logs alone', () => {
    expect(clipJobLogText('ok', 10)).toEqual({ text: 'ok', truncated: false });
  });

  it('marks oversize logs', () => {
    const clipped = clipJobLogText('abcdefghij', 4);
    expect(clipped.truncated).toBe(true);
    expect(clipped.text.startsWith('abcd')).toBe(true);
    expect(clipped.text).toContain('truncated 6');
  });
});

describe('composeJobLogPayload', () => {
  it('prefers the S3 body and prefixes the worker summary', () => {
    const payload = composeJobLogPayload({
      logKey: 'CLI failed; log: projects/p/jobs/j/log.txt',
      objectText: 'stdout here',
      objectKey: 'projects/p/jobs/j/log.txt',
    });
    expect(payload.source).toBe('s3');
    expect(payload.text).toContain('CLI failed');
    expect(payload.text).toContain('stdout here');
    expect(payload.key).toBe('projects/p/jobs/j/log.txt');
  });

  it('falls back to the inline logKey when no object was fetched', () => {
    const payload = composeJobLogPayload({
      logKey: 'missing_project',
      objectText: null,
      objectKey: null,
    });
    expect(payload).toMatchObject({
      text: 'missing_project',
      source: 'inline',
      truncated: false,
      key: null,
    });
  });
});
