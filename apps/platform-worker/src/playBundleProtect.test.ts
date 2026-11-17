/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import {
  embedPngAuthorText,
  jsLiteralsUnclosed,
  obfuscatePlayJs,
  protectDestroyedBundle,
  protectPlayJs,
  stripComments,
} from './playBundleProtect.js';
import { playBundlePrefix, resolveWorkspaceArchivePrefix } from './storageLayout.js';

describe('storageLayout', () => {
  it('keeps compiled builds out of the workspace prefix', () => {
    expect(playBundlePrefix('p1', 'a1')).toBe('play-bundles/p1/a1');
    expect(resolveWorkspaceArchivePrefix('true')).toBe('workspaces');
    expect(resolveWorkspaceArchivePrefix('')).toBe('workspaces');
    expect(resolveWorkspaceArchivePrefix('false')).toBeNull();
    expect(resolveWorkspaceArchivePrefix('tenant-a')).toBe('tenant-a');
  });
});

describe('obfuscatePlayJs', () => {
  it('drops comments and leaves reserved names alone', () => {
    const src = `
      // hello
      function scoreKeeper(scoreKeeperInner) {
        return scoreKeeperInner + Phaser;
      }
      scoreKeeper(scoreKeeper);
    `;
    const out = obfuscatePlayJs(src);
    expect(out).not.toContain('hello');
    expect(out).toContain('Phaser');
    expect(stripComments('a/*x*/b')).toBe('ab');
  });
});

describe('stripComments (minified Vite bundles)', () => {
  it('does not eat protocol-relative URLs inside strings', () => {
    const src = 'function e(){return"//cdn.example.com/x"}console.log(1);';
    expect(stripComments(src)).toBe(src);
    // The old regex `([^:\\])//[^\n]*` turned this into `function e(){return"` —
    // which is exactly `Invalid or unexpected token` on a one-line bundle.
    const naive = src.replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');
    expect(naive.length).toBeLessThan(src.length);
    expect(protectDestroyedBundle(src, naive)).toBe(true);
  });

  it('keeps // inside strings that are not URLs', () => {
    const src = 'const a="foo//bar",b=1;//gone\nconst c=2;';
    const out = stripComments(src);
    expect(out).toContain('"foo//bar"');
    expect(out).toContain('const c=2;');
    expect(out).not.toContain('gone');
  });

  it('keeps https:// (colon-protected) and regex literals', () => {
    const src = 'fetch("https://api.example.com");return/\\/\\//.test(s);x/=2;';
    expect(stripComments(src)).toBe(src);
  });

  it('protectPlayJs falls back to the original when a transform would unclose a string', () => {
    const src = 'function e(){return"//cdn"}';
    expect(protectPlayJs(src, false)).toBe(src);
    expect(jsLiteralsUnclosed('function e(){return"')).toBe(true);
    expect(jsLiteralsUnclosed(src)).toBe(false);
  });
});

describe('embedPngAuthorText', () => {
  it('leaves non-png bytes alone', () => {
    const raw = Buffer.from('not a png');
    expect(embedPngAuthorText(raw, 'ada')).toBe(raw);
  });

  it('inserts an OpenGame tEXt chunk before IEND', () => {
    // Minimal valid PNG: signature + empty IHDR-sized header is not required
    // for the insert test — we only need the 8-byte magic and an IEND trailer.
    const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const iend = Buffer.alloc(12);
    iend.writeUInt32BE(0, 0);
    iend.write('IEND', 4);
    iend.writeUInt32BE(0xae426082, 8);
    const png = Buffer.concat([sig, iend]);
    const out = embedPngAuthorText(png, 'ada');
    expect(out.toString('latin1')).toContain('tEXtOpenGame');
    expect(out.toString('latin1')).toContain('ada');
    expect(out.subarray(-8, -4).toString()).toBe('IEND');
  });
});
