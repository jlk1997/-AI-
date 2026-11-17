/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment jsdom
 */

import { describe, expect, it } from 'vitest';

import { buildShareCard, clipShareDesc, playLink, remixProofLine } from './shareCard.js';

describe('buildShareCard', () => {
  it('shares the play-first landing page', () => {
    expect(playLink('tiny-town', null)).toContain('/play/tiny-town');
    expect(playLink('tiny-town', null)).not.toContain('invite=');
    expect(playLink('tiny-town', 'Ada_01')).toContain('/play/tiny-town?invite=ada_01');
    const card = buildShareCard(
      {
        slug: 'tiny-town',
        title: 'Tiny Town',
        category: 'world',
        authorName: 'ada',
      },
      'zh-CN',
    );
    expect(card.link).toContain('/play/tiny-town');
    expect(card.desc).toContain('@ada');
  });

  it('omits remix proof when nobody has changed a line yet', () => {
    expect(remixProofLine(0)).toBe('');
    expect(remixProofLine(undefined)).toBe('');
    expect(remixProofLine(3, 'zh-CN')).toBe('已被改 3 次');
    expect(remixProofLine(3, 'en')).toBe('remixed 3 times');
    const card = buildShareCard(
      {
        slug: 'tiny-town',
        title: 'Tiny Town',
        remixCount: 3,
      },
      'zh-CN',
    );
    expect(card.desc).toContain('已被改 3 次');
    expect(
      buildShareCard(
        { slug: 'tiny-town', title: 'Tiny Town', category: 'world', authorName: 'ada' },
        'en',
      ).desc,
    ).toMatch(/tonight in China \(UTC\+8\)/i);
    expect(
      clipShareDesc(
        "@ada's town lives — tonight in China (UTC+8) · remixed 99 times",
      ),
    ).toMatch(/tonight in China \(UTC\+8\)/i);
  });
});
