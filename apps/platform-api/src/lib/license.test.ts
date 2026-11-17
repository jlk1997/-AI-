/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import {
  isOriginAllowed,
  isRemixAllowed,
  normalizeLicense,
  requiresCredit,
  resolveEmbedOrigins,
} from './license.js';

describe('normalizeLicense', () => {
  it('keeps the three known values', () => {
    expect(normalizeLicense('remix-ok')).toBe('remix-ok');
    expect(normalizeLicense('remix-credit')).toBe('remix-credit');
    expect(normalizeLicense('no-remix')).toBe('no-remix');
  });

  it('falls back to the open default for anything unrecognised', () => {
    // Rows published before licences existed have no value at all; they were
    // published under an open loop and must keep behaving that way.
    expect(normalizeLicense(null)).toBe('remix-ok');
    expect(normalizeLicense(undefined)).toBe('remix-ok');
    expect(normalizeLicense('cc-by-sa')).toBe('remix-ok');
  });

  it('is case and whitespace insensitive', () => {
    expect(normalizeLicense('  NO-REMIX ')).toBe('no-remix');
  });
});

describe('remix gating', () => {
  it('only blocks forks under no-remix', () => {
    expect(isRemixAllowed('remix-ok')).toBe(true);
    expect(isRemixAllowed('remix-credit')).toBe(true);
    expect(isRemixAllowed('no-remix')).toBe(false);
  });

  it('flags the licence that demands attribution', () => {
    expect(requiresCredit('remix-credit')).toBe(true);
    expect(requiresCredit('remix-ok')).toBe(false);
  });
});

describe('resolveEmbedOrigins', () => {
  it('always includes our own origins', () => {
    const origins = resolveEmbedOrigins(null, ['https://opengame.example']);
    expect(origins).toEqual(['https://opengame.example']);
  });

  it('adds author-declared origins and drops malformed ones', () => {
    const origins = resolveEmbedOrigins(
      ['https://partner.example/games', 'not a url', 42],
      ['https://opengame.example'],
    );
    expect(origins).toContain('https://partner.example');
    expect(origins).toHaveLength(2);
  });

  it('normalises to origin so a path cannot widen the allowlist', () => {
    const origins = resolveEmbedOrigins(['https://partner.example/a/b?c=1'], []);
    expect(origins).toEqual(['https://partner.example']);
  });
});

describe('isOriginAllowed', () => {
  it('rejects a missing origin rather than defaulting to allow', () => {
    expect(isOriginAllowed(null, ['https://opengame.example'])).toBe(false);
    expect(isOriginAllowed(undefined, ['https://opengame.example'])).toBe(false);
  });

  it('does not match on prefix', () => {
    expect(
      isOriginAllowed('https://opengame.example.attacker.test', ['https://opengame.example']),
    ).toBe(false);
  });
});
