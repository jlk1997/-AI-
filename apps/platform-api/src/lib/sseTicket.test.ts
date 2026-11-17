/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import { sseTicketRedisKey } from './sseTicket.js';

describe('sseTicketRedisKey', () => {
  it('hashes the raw ticket so Redis never stores the secret in the key', () => {
    const a = sseTicketRedisKey('plain-ticket');
    const b = sseTicketRedisKey('other');
    expect(a.startsWith('sse:ticket:')).toBe(true);
    expect(a).not.toBe(b);
    expect(a).not.toContain('plain-ticket');
  });
});
