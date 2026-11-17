/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import {
  maskEmailForPeer,
  resolveInviteOrgRole,
  wantsAllMembershipProjects,
} from './orgAccess.js';

describe('wantsAllMembershipProjects', () => {
  it('treats missing, blank, and all as a union list', () => {
    expect(wantsAllMembershipProjects(undefined)).toBe(true);
    expect(wantsAllMembershipProjects(null)).toBe(true);
    expect(wantsAllMembershipProjects('')).toBe(true);
    expect(wantsAllMembershipProjects('  all  ')).toBe(true);
    expect(wantsAllMembershipProjects('ALL')).toBe(true);
  });

  it('keeps a real organization id as a filter', () => {
    expect(wantsAllMembershipProjects('11111111-2222-3333-4444-555555555555')).toBe(
      false,
    );
  });
});

describe('maskEmailForPeer', () => {
  it('reveals or masks, and ignores empty', () => {
    expect(maskEmailForPeer('ada@example.com', true)).toBe('ada@example.com');
    expect(maskEmailForPeer('ada@example.com', false)).toBe('ad***@example.com');
    expect(maskEmailForPeer('a@x.io', false)).toBe('a***@x.io');
    expect(maskEmailForPeer(null, false)).toBeNull();
    expect(maskEmailForPeer('  ', true)).toBeNull();
  });
});

describe('resolveInviteOrgRole', () => {
  it('never promotes to owner through the invite body', () => {
    expect(resolveInviteOrgRole('owner')).toBe('member');
    expect(resolveInviteOrgRole('admin')).toBe('admin');
    expect(resolveInviteOrgRole(undefined)).toBe('member');
  });
});
