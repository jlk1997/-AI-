/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import { communityWorldOpenHref } from './communityWorldOpen.js';

describe('communityWorldOpenHref', () => {
  it('sends the author to their observatory', () => {
    expect(
      communityWorldOpenHref({
        viewerIsAuthor: true,
        authorProjectId: 'proj-1',
        slug: 'my-town',
      }),
    ).toEqual({ href: '/observatory/proj-1', kind: 'author' });
  });

  it('never sends a guest to /observatory', () => {
    expect(
      communityWorldOpenHref({
        viewerIsAuthor: false,
        authorProjectId: 'proj-1',
        slug: 'my-town',
        gameId: 'g1',
      }),
    ).toEqual({ href: '/play/my-town', kind: 'guest' });
  });

  it('falls back to the game id when the slug is missing', () => {
    expect(
      communityWorldOpenHref({
        viewerIsAuthor: false,
        gameId: 'g1',
      }),
    ).toEqual({ href: '/play/g1', kind: 'guest' });
  });
});
