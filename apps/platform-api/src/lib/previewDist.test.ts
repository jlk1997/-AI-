/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import {
  buildPreviewObjectKey,
  inferDistPrefixFromPreviewUrl,
  previewBrokenModuleStub,
  previewDistMountPath,
  previewJsLooksCorrupt,
  resolveDistPrefix,
  rewritePreviewBundledJs,
  rewritePreviewHtml,
  signPreviewDistToken,
  verifyPreviewDistToken,
} from './previewDist.js';

const secret = 'x'.repeat(32);

describe('previewDist token', () => {
  it('signs and verifies', () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const token = signPreviewDistToken(secret, {
      v: 1,
      deploymentId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      exp,
      distPrefix: 'projects/p1/artifacts/a1/dist',
    });
    const p = verifyPreviewDistToken(secret, token);
    expect(p?.deploymentId).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    expect(p?.distPrefix).toBe('projects/p1/artifacts/a1/dist');
  });

  it('rejects tampered token', () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const token = signPreviewDistToken(secret, {
      v: 1,
      deploymentId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      exp,
      distPrefix: 'projects/p1/artifacts/a1/dist',
    });
    const tampered = token.slice(0, -4) + 'zzzz';
    expect(verifyPreviewDistToken(secret, tampered)).toBeNull();
  });

  it('rejects expired token', () => {
    const exp = Math.floor(Date.now() / 1000) - 10;
    const token = signPreviewDistToken(secret, {
      v: 1,
      deploymentId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      exp,
      distPrefix: 'projects/p1/artifacts/a1/dist',
    });
    expect(verifyPreviewDistToken(secret, token)).toBeNull();
  });
});

describe('previewDist paths', () => {
  it('infers dist prefix from preview url', () => {
    expect(inferDistPrefixFromPreviewUrl('projects/x/artifacts/y/dist/index.html')).toBe(
      'projects/x/artifacts/y/dist',
    );
  });

  it('prefers manifest distPrefix', () => {
    expect(
      resolveDistPrefix('projects/wrong/dist/index.html', {
        distPrefix: 'projects/right/artifacts/z/dist',
      }),
    ).toBe('projects/right/artifacts/z/dist');
  });

  it('falls back to storagePrefix for legacy /preview/{id}/ urls', () => {
    expect(
      resolveDistPrefix(
        '/preview/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/',
        {},
        'projects/p/artifacts/a/dist',
      ),
    ).toBe('projects/p/artifacts/a/dist');
  });

  it('buildPreviewObjectKey rejects traversal', () => {
    expect(buildPreviewObjectKey('projects/p/dist', '../secret')).toBeNull();
  });
});

describe('previewDist rewrite for nested mount', () => {
  const mount = previewDistMountPath(
    'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    'tok.part',
  );

  it('rewrites vite root-relative assets in html', () => {
    const html =
      '<script type="module" crossorigin src="/assets/index-abc.js"></script><link rel="stylesheet" href="/assets/index-def.css">';
    const out = rewritePreviewHtml(html, mount);
    expect(out).toContain(`${mount}/assets/index-abc.js`);
    expect(out).toContain(`${mount}/assets/index-def.css`);
    expect(out).not.toContain('src="/assets/');
  });

  it('rewrites absolute json paths in html', () => {
    const html = '<script>fetch("/game.json")</script>';
    const out = rewritePreviewHtml(html, mount);
    expect(out).toContain(`fetch("${mount}/game.json")`);
  });

  it('rewrites chunk paths in bundled js', () => {
    const js = 'import{o}from"/assets/foo.js";fetch("/game.json")';
    const out = rewritePreviewBundledJs(js, mount);
    expect(out).toContain(`from"${mount}/assets/foo.js"`);
    expect(out).toContain(`fetch("${mount}/game.json")`);
  });

  it('rewrites template-literal game.json path in bundled js', () => {
    const js = 'bootstrap({source:`/game.json`})';
    const out = rewritePreviewBundledJs(js, mount);
    expect(out).toContain(`source:\`${mount}/game.json\``);
  });
});

describe('previewJsLooksCorrupt', () => {
  it('flags HTML served as JS and mid-string leftovers', () => {
    expect(previewJsLooksCorrupt('<!DOCTYPE html>')).toBe(true);
    expect(previewJsLooksCorrupt('function e(){return"')).toBe(true);
    expect(previewJsLooksCorrupt('function e(){return"//cdn"}console.log(1);')).toBe(
      false,
    );
    expect(previewJsLooksCorrupt('return/^"/.test(s);const n=1;')).toBe(false);
    expect(previewBrokenModuleStub('syntax')).toContain('opengame-preview-broken');
  });
});
