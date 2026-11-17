/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import {
  buildShareMeta,
  ogMetaTags,
  renderShareCardHtml,
  shareCardLocaleFromRequest,
} from './shareCard.js';
import { workFingerprint } from './fingerprint.js';

describe('buildShareMeta', () => {
  it('points the card at the play-first landing page', () => {
    const meta = buildShareMeta(
      {
        slug: 'tiny-town',
        title: 'Tiny Town',
        category: 'world',
        authorName: 'ada',
      },
      'https://play.example',
    );
    expect(meta.link).toBe('https://play.example/play/tiny-town');
    expect(meta.desc).toContain('@ada');
    expect(meta.title).toBe('Tiny Town');
    expect(
      buildShareMeta(
        { slug: 'tiny-town', title: 'Tiny Town', remixCount: 4 },
        'https://play.example',
      ).desc,
    ).toContain('已被改 4 次');
  });

  it('escapes markup in the crawler HTML', () => {
    const html = renderShareCardHtml({
      title: '"><script>alert(1)</script>',
      desc: 'ok',
      link: 'https://play.example/play/x',
      imgUrl: 'https://play.example/i.png',
    });
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&quot;');
    expect(ogMetaTags({
      title: 'A',
      desc: 'B',
      link: 'https://play.example/play/a',
      imgUrl: 'https://play.example/i.png',
    })).toContain('og:title');
  });

  it('marks overseas cards in English without renaming the work', () => {
    expect(shareCardLocaleFromRequest('en-US,en;q=0.9', null)).toBe('en');
    expect(shareCardLocaleFromRequest('zh-CN,zh;q=0.9', 'en')).toBe('en');
    expect(shareCardLocaleFromRequest(undefined, undefined)).toBe('zh-CN');
    const meta = buildShareMeta(
      { slug: 'tiny-town', title: 'Tiny Town', category: 'world', authorName: 'ada' },
      'https://play.example',
      'en',
    );
    expect(meta.desc).toMatch(/tonight in China \(UTC\+8\)/i);
    expect(meta.desc).not.toMatch(/OpenGame/);
    expect(renderShareCardHtml(meta, 'en')).toContain('lang="en"');
  });

  it('puts a settled canon line on the crawler card', () => {
    const meta = buildShareMeta(
      {
        slug: 'tiny-town',
        title: 'Tiny Town',
        category: 'world',
        authorName: 'ada',
        description: 'A quiet street',
        canon: '今夜哪件事会成为正史：失火成了',
      },
      'https://play.example',
    );
    expect(meta.desc).toContain('失火成了');
    expect(meta.desc).not.toContain('A quiet street');
  });

  it('never ships the research-tool name on a player card', () => {
    const html = renderShareCardHtml({
      title: 'River Town',
      desc: 'A living street',
      link: 'https://play.example/play/river',
      imgUrl: 'https://play.example/i.png',
    });
    expect(html).not.toMatch(/OpenGame/);
    expect(html).toContain('River Town');
  });
});

describe('workFingerprint', () => {
  it('is stable for the same work and changes when the title does', () => {
    const a = workFingerprint({
      title: '  Tiny Town  ',
      description: 'Hello',
      category: 'world',
      license: 'remix-ok',
    });
    const b = workFingerprint({
      title: 'tiny town',
      description: 'Hello',
      category: 'world',
      license: 'remix-ok',
    });
    const c = workFingerprint({
      title: 'Other Town',
      description: 'Hello',
      category: 'world',
      license: 'remix-ok',
    });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toHaveLength(32);
  });
});
