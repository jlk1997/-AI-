/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import { communityKindWhere, parseCommunityListSort } from './communityList.js';

describe('communityKindWhere', () => {
  it('always requires public rows', () => {
    expect(communityKindWhere(undefined, undefined)).toBeTruthy();
    expect(communityKindWhere('world', undefined)).toBeTruthy();
    expect(communityKindWhere('game', 'platformer')).toBeTruthy();
  });
});

describe('parseCommunityListSort', () => {
  it('accepts remixed as a first-class viral sort', () => {
    expect(parseCommunityListSort('remixed')).toBe('remixed');
    expect(parseCommunityListSort('popular')).toBe('popular');
    expect(parseCommunityListSort('nope')).toBe('latest');
  });
});
