/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import { peekOptionalJwt, signSessionJwt } from './jwt.js';

const SECRET = 'test-jwt-secret-that-is-long-enough-32';

describe('peekOptionalJwt', () => {
  it('reads a bearer token and ignores a missing or bad header', async () => {
    const token = await signSessionJwt(
      SECRET,
      { sub: 'u1', email: 'a@b.c', organizationId: 'o1' },
      60,
    );
    const ok = await peekOptionalJwt(SECRET, `Bearer ${token}`);
    expect(ok?.organizationId).toBe('o1');
    expect(await peekOptionalJwt(SECRET, undefined)).toBeNull();
    expect(await peekOptionalJwt(SECRET, 'Bearer not-a-token')).toBeNull();
  });
});
