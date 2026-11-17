/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import { publishListedWorldAction } from './publishWorldFund.js';

describe('publishListedWorldAction', () => {
  it('lets a first publish go to the API', () => {
    expect(
      publishListedWorldAction({
        existingSlug: null,
        kind: 'world',
        isPublic: true,
        townFunded: false,
      }),
    ).toBe('publish');
  });

  it('still asks for a lamp when a listed world goes public unfunded', () => {
    expect(
      publishListedWorldAction({
        existingSlug: 'old-town',
        kind: 'world',
        isPublic: true,
        townFunded: false,
        lampKnown: true,
      }),
    ).toBe('need_fund');
    expect(
      publishListedWorldAction({
        existingSlug: 'old-town',
        kind: 'world',
        isPublic: true,
        townFunded: false,
        lampKnown: false,
      }),
    ).toBe('publish');
  });

  it('skips a funded listed world and any game listing', () => {
    expect(
      publishListedWorldAction({
        existingSlug: 'old-town',
        kind: 'world',
        isPublic: true,
        townFunded: true,
      }),
    ).toBe('already');
    expect(
      publishListedWorldAction({
        existingSlug: 'old-game',
        kind: 'game',
        isPublic: true,
        townFunded: false,
      }),
    ).toBe('already');
  });
});
