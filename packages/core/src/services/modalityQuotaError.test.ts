/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { isModalityQuotaError } from './modalityQuotaError.js';

describe('isModalityQuotaError', () => {
  it('matches real MiniMax / OpenAI quota signals', () => {
    expect(
      isModalityQuotaError(new Error('Chat completion failed: 429 - usage limit')),
    ).toBe(true);
    expect(
      isModalityQuotaError(new Error('MiniMax image status 2056 Token Plan')),
    ).toBe(true);
    expect(
      isModalityQuotaError(new Error('HTTP 429 rate limit exceeded')),
    ).toBe(true);
    expect(isModalityQuotaError(new Error('用量上限已到达'))).toBe(true);
  });

  it('does NOT false-positive on bare "quota" help text or unrelated errors', () => {
    expect(
      isModalityQuotaError(
        new Error('Model API error: see quota page for remaining balance'),
      ),
    ).toBe(false);
    expect(
      isModalityQuotaError(new Error('MiniMax image HTTP 401: invalid api key')),
    ).toBe(false);
    expect(
      isModalityQuotaError(new Error('MiniMax image HTTP 400: bad aspect_ratio')),
    ).toBe(false);
    expect(
      isModalityQuotaError(new Error('Download image failed HTTP 403')),
    ).toBe(false);
    expect(
      isModalityQuotaError(new Error('MiniMax image status 1026 prompt unsafe')),
    ).toBe(false);
    expect(isModalityQuotaError(new Error('TS2554 Expected 2 arguments'))).toBe(
      false,
    );
  });
});
