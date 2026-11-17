/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import { isExcludedFromPlayBundle, stripSourcemapRefs } from './uploadDirectory.js';

describe('isExcludedFromPlayBundle', () => {
  it('keeps the compiled bundle a player needs', () => {
    expect(isExcludedFromPlayBundle('index.html')).toBe(false);
    expect(isExcludedFromPlayBundle('assets/index-a1b2c3.js')).toBe(false);
    expect(isExcludedFromPlayBundle('assets/hero.png')).toBe(false);
    expect(isExcludedFromPlayBundle('game.json')).toBe(false);
  });

  it('drops everything that would hand over the author’s source', () => {
    // A source map reconstructs the original TypeScript from the minified
    // bundle, which is the one thing hosted playback exists to prevent.
    expect(isExcludedFromPlayBundle('assets/index-a1b2c3.js.map')).toBe(true);
    expect(isExcludedFromPlayBundle('src/Scene.ts')).toBe(true);
    expect(isExcludedFromPlayBundle('src/Scene.tsx')).toBe(true);
    expect(isExcludedFromPlayBundle('.env')).toBe(true);
    expect(isExcludedFromPlayBundle('nested/.env.production')).toBe(true);
    expect(isExcludedFromPlayBundle('node_modules/phaser/index.js')).toBe(true);
    expect(isExcludedFromPlayBundle('build.log')).toBe(true);
  });
});

describe('stripSourcemapRefs', () => {
  it('removes the pointer left behind when maps are not shipped', () => {
    const out = stripSourcemapRefs(
      'console.log(1);\n//# sourceMappingURL=index.js.map\n',
    );
    expect(out).not.toContain('sourceMappingURL');
    expect(out).toContain('console.log(1);');
  });

  it('handles the css block-comment form', () => {
    const out = stripSourcemapRefs('.a{color:red}\n/*# sourceMappingURL=a.css.map */\n');
    expect(out).not.toContain('sourceMappingURL');
  });

  it('leaves code that merely mentions the word alone', () => {
    const src = 'const note = "sourceMappingURL is stripped";\n';
    expect(stripSourcemapRefs(src)).toBe(src);
  });
});
