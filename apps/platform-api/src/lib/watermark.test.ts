/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import { watermarkHtml } from './previewDist.js';

describe('watermarkHtml', () => {
  it('credits the author by handle', () => {
    const html = watermarkHtml({ author: '@ada', title: 'Tiny Town' });
    expect(html).toContain('OpenGame · @ada');
    expect(html).toContain('id="og-watermark"');
  });

  it('escapes a title or handle that contains markup', () => {
    // Titles are author-supplied and end up inside an attribute, so a quote or
    // a bracket must not be able to close it and inject a tag.
    const html = watermarkHtml({
      author: '"><script>alert(1)</script>',
      title: '<img src=x onerror=1>',
    });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
  });

  it('does not intercept taps: the game is still playable under it', () => {
    expect(watermarkHtml({ author: '@ada', title: 'T' })).toContain(
      'pointer-events:none',
    );
  });
});
