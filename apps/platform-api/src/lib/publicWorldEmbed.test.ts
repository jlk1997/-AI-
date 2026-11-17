/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import { publicWorldEmbed } from './publicWorldEmbed.js';

describe('publicWorldEmbed', () => {
  it('does not rewrite arcade embeds', () => {
    expect(
      publicWorldEmbed({
        category: 'arcade',
        slug: 'chess',
        webBaseUrl: 'https://play.example',
      }),
    ).toBeNull();
  });

  it('sends a world to /play so the stage can ping presence', () => {
    expect(
      publicWorldEmbed({
        category: 'world',
        slug: 'night-market',
        webBaseUrl: 'https://play.example/',
      }),
    ).toEqual({
      embedUrl: 'https://play.example/play/night-market',
      embedDenied: null,
      requiresStage: true,
    });
  });

  it('refuses a frozen preview-dist when the web origin is missing', () => {
    expect(
      publicWorldEmbed({ category: 'world', slug: 'night-market' }),
    ).toEqual({
      embedUrl: null,
      embedDenied: 'world_requires_stage',
      requiresStage: true,
    });
  });
});
