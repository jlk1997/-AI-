/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import {
  isValidCnPhone,
  isValidHandle,
  normalizeHandle,
  normalizePhone,
  orgRoleAtLeast,
  publicAuthorOf,
} from './identity.js';

describe('handles', () => {
  it('accepts lowercase names and folds case', () => {
    expect(isValidHandle('pixel_smith')).toBe(true);
    expect(isValidHandle('PixelSmith')).toBe(true);
    expect(normalizeHandle('  PixelSmith ')).toBe('pixelsmith');
  });

  it('rejects names that would break a URL or read as an id', () => {
    expect(isValidHandle('ab')).toBe(false);
    expect(isValidHandle('a'.repeat(21))).toBe(false);
    expect(isValidHandle('has space')).toBe(false);
    expect(isValidHandle('slash/es')).toBe(false);
    expect(isValidHandle('émile')).toBe(false);
  });
});

describe('publicAuthorOf', () => {
  const base = {
    id: '11111111-2222-3333-4444-555555555555',
    email: 'ada@example.com',
    handle: null,
    displayName: null,
    avatarUrl: null,
    bio: null,
  };

  it('never leaks the email address', () => {
    const author = publicAuthorOf(base);
    expect(author.displayName).toBe('ada');
    expect(JSON.stringify(author)).not.toContain('example.com');
  });

  it('prefers display name, then handle, then the email local part', () => {
    expect(publicAuthorOf({ ...base, displayName: 'Ada L.' }).displayName).toBe('Ada L.');
    expect(publicAuthorOf({ ...base, handle: 'ada_l' }).displayName).toBe('ada_l');
  });

  it('falls back to a short id when the local part is too short to be a name', () => {
    const author = publicAuthorOf({ ...base, email: 'a@example.com' });
    expect(author.displayName).toBe('player-111111');
  });
});

describe('orgRoleAtLeast', () => {
  it('treats owner and admin as the sensitive-ops floor', () => {
    expect(orgRoleAtLeast('owner', 'admin')).toBe(true);
    expect(orgRoleAtLeast('admin', 'admin')).toBe(true);
    expect(orgRoleAtLeast('editor', 'admin')).toBe(false);
    expect(orgRoleAtLeast('member', 'admin')).toBe(false);
    expect(orgRoleAtLeast(null, 'admin')).toBe(false);
    expect(orgRoleAtLeast('member', 'member')).toBe(true);
  });
});

describe('phone numbers', () => {
  it('accepts a mainland mobile and strips +86', () => {
    expect(normalizePhone('+86 138-0013-8000')).toBe('13800138000');
    expect(isValidCnPhone('+8613800138000')).toBe(true);
    expect(isValidCnPhone('12345')).toBe(false);
  });
});
