/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  assetTopUpFingerprint,
  assetTopUpIsFresh,
  buildSkipDecision,
  clearWorkspaceBuildCache,
  distFingerprint,
  linkedRuntimeBuildIsFresh,
  readCachedSmoke,
  recordAssetTopUp,
  recordDistUpload,
  recordLinkedRuntimeBuild,
  recordWorkspaceBuild,
  reusableDistUpload,
  smokeCacheKey,
  workspaceBuildKey,
  writeCachedSmoke,
} from './buildCache.js';

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function write(full: string, body: string): void {
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body, 'utf8');
}

/** mtime has ms granularity — bump it explicitly so tests are not flaky. */
function touchLater(full: string): void {
  const future = new Date(Date.now() + 5_000);
  fs.utimesSync(full, future, future);
}

describe('linked runtime build cache', () => {
  it('is stale until recorded, fresh afterwards, stale again after a src edit', () => {
    const linked = tmpDir('og-rt-');
    write(path.join(linked, 'package.json'), '{"name":"@opengame/runtime"}');
    write(path.join(linked, 'src', 'index.ts'), 'export const a = 1;');
    write(path.join(linked, 'dist', 'index.d.ts'), 'export declare const a: 1;');

    expect(linkedRuntimeBuildIsFresh(linked)).toBe(false);
    recordLinkedRuntimeBuild(linked);
    expect(linkedRuntimeBuildIsFresh(linked)).toBe(true);

    write(path.join(linked, 'src', 'index.ts'), 'export const a = 2;');
    touchLater(path.join(linked, 'src', 'index.ts'));
    expect(linkedRuntimeBuildIsFresh(linked)).toBe(false);
  });

  it('is stale when dist types are missing even if a marker exists', () => {
    const linked = tmpDir('og-rt2-');
    write(path.join(linked, 'package.json'), '{}');
    write(path.join(linked, 'dist', 'index.d.ts'), 'x');
    recordLinkedRuntimeBuild(linked);
    fs.rmSync(path.join(linked, 'dist', 'index.d.ts'));
    expect(linkedRuntimeBuildIsFresh(linked)).toBe(false);
  });
});

describe('smoke cache', () => {
  it('keys on dist bytes and gate tier', () => {
    const ws = tmpDir('og-smoke-');
    write(path.join(ws, 'dist', 'index.html'), '<html></html>');
    const baselineKey = smokeCacheKey(ws, 'baseline');
    const qualityKey = smokeCacheKey(ws, 'quality');
    expect(baselineKey).not.toBe(qualityKey);

    writeCachedSmoke(ws, baselineKey, { ok: true, issues: [] });
    expect(readCachedSmoke(ws, baselineKey)?.ok).toBe(true);
    // A different tier must not reuse the baseline verdict.
    expect(readCachedSmoke(ws, qualityKey)).toBeNull();
  });

  it('invalidates when dist changes', () => {
    const ws = tmpDir('og-smoke2-');
    write(path.join(ws, 'dist', 'index.html'), '<html></html>');
    const key = smokeCacheKey(ws, 'baseline');
    writeCachedSmoke(ws, key, { ok: true, issues: [] });

    write(path.join(ws, 'dist', 'app.js'), 'console.log(1)');
    expect(readCachedSmoke(ws, smokeCacheKey(ws, 'baseline'))).toBeNull();
  });

  it('reports a stable missing-dist fingerprint', () => {
    const ws = tmpDir('og-smoke3-');
    expect(distFingerprint(ws)).toBe('missing');
  });
});

describe('dist upload reuse', () => {
  const upload = { jobId: 'job-1', distPrefix: 'p/artifacts/a1/dist', entryKey: 'p/a1/index.html' };

  it('reuses the uploaded bytes when dist is unchanged', () => {
    const ws = tmpDir('og-upload-');
    write(path.join(ws, 'dist', 'index.html'), '<html></html>');
    recordDistUpload(ws, upload);
    expect(reusableDistUpload(ws, 'job-1')?.entryKey).toBe(upload.entryKey);
  });

  it('re-uploads once dist changes', () => {
    const ws = tmpDir('og-upload2-');
    write(path.join(ws, 'dist', 'index.html'), '<html></html>');
    recordDistUpload(ws, upload);

    write(path.join(ws, 'dist', 'app.js'), 'console.log(1)');
    expect(reusableDistUpload(ws, 'job-1')).toBeNull();
  });

  it('never reuses keys uploaded by a different job', () => {
    const ws = tmpDir('og-upload3-');
    write(path.join(ws, 'dist', 'index.html'), '<html></html>');
    recordDistUpload(ws, upload);
    expect(reusableDistUpload(ws, 'job-2')).toBeNull();
  });

  it('does not reuse when there is no dist at all', () => {
    const ws = tmpDir('og-upload4-');
    recordDistUpload(ws, upload);
    expect(reusableDistUpload(ws, 'job-1')).toBeNull();
  });
});

describe('workspace build cache', () => {
  function seedWorkspace(prefix: string): string {
    const ws = tmpDir(prefix);
    write(path.join(ws, 'package.json'), '{"name":"g"}');
    write(path.join(ws, 'src', 'main.ts'), 'export const a = 1;');
    write(path.join(ws, 'public', 'game.json'), '{"scenes":[]}');
    write(path.join(ws, 'dist', 'index.html'), '<html></html>');
    return ws;
  }

  it('skips both steps only after a recorded green build', () => {
    const ws = seedWorkspace('og-build-');
    expect(buildSkipDecision(ws, workspaceBuildKey(ws))).toEqual({
      skipTypecheck: false,
      skipBuild: false,
    });

    recordWorkspaceBuild(ws, workspaceBuildKey(ws));
    expect(buildSkipDecision(ws, workspaceBuildKey(ws))).toEqual({
      skipTypecheck: true,
      skipBuild: true,
    });
  });

  it('rebuilds but keeps the typecheck skip when only public/ moves', () => {
    const ws = seedWorkspace('og-build2-');
    recordWorkspaceBuild(ws, workspaceBuildKey(ws));

    write(path.join(ws, 'public', 'game.json'), '{"scenes":[{"id":"a"}]}');
    touchLater(path.join(ws, 'public', 'game.json'));
    expect(buildSkipDecision(ws, workspaceBuildKey(ws))).toEqual({
      skipTypecheck: true,
      skipBuild: false,
    });
  });

  it('runs everything again after a src edit', () => {
    const ws = seedWorkspace('og-build3-');
    recordWorkspaceBuild(ws, workspaceBuildKey(ws));

    write(path.join(ws, 'src', 'main.ts'), 'export const a = 2;');
    touchLater(path.join(ws, 'src', 'main.ts'));
    expect(buildSkipDecision(ws, workspaceBuildKey(ws))).toEqual({
      skipTypecheck: false,
      skipBuild: false,
    });
  });

  it('cannot skip the build when dist/ is gone', () => {
    const ws = seedWorkspace('og-build4-');
    recordWorkspaceBuild(ws, workspaceBuildKey(ws));
    fs.rmSync(path.join(ws, 'dist'), { recursive: true, force: true });
    expect(buildSkipDecision(ws, workspaceBuildKey(ws))).toEqual({
      skipTypecheck: true,
      skipBuild: false,
    });
  });

  it('forgets the entry when cleared after a failure', () => {
    const ws = seedWorkspace('og-build5-');
    recordWorkspaceBuild(ws, workspaceBuildKey(ws));
    clearWorkspaceBuildCache(ws);
    expect(buildSkipDecision(ws, workspaceBuildKey(ws)).skipTypecheck).toBe(false);
  });

  it('honours PLATFORM_BUILD_CACHE=false', () => {
    const ws = seedWorkspace('og-build6-');
    recordWorkspaceBuild(ws, workspaceBuildKey(ws));
    const prev = process.env['PLATFORM_BUILD_CACHE'];
    process.env['PLATFORM_BUILD_CACHE'] = 'false';
    try {
      expect(buildSkipDecision(ws, workspaceBuildKey(ws))).toEqual({
        skipTypecheck: false,
        skipBuild: false,
      });
    } finally {
      if (prev === undefined) delete process.env['PLATFORM_BUILD_CACHE'];
      else process.env['PLATFORM_BUILD_CACHE'] = prev;
    }
  });
});

describe('asset top-up cache', () => {
  it('goes stale when an asset or game.json moves', () => {
    const ws = tmpDir('og-asset-');
    write(path.join(ws, 'public', 'assets', 'player.png'), 'png-bytes');
    write(path.join(ws, 'public', 'game.json'), '{"scenes":[]}');

    const key = assetTopUpFingerprint(ws);
    expect(assetTopUpIsFresh(ws, key)).toBe(false);
    recordAssetTopUp(ws);
    expect(assetTopUpIsFresh(ws, assetTopUpFingerprint(ws))).toBe(true);

    write(path.join(ws, 'public', 'game.json'), '{"scenes":[{"id":"a"}]}');
    touchLater(path.join(ws, 'public', 'game.json'));
    expect(assetTopUpIsFresh(ws, assetTopUpFingerprint(ws))).toBe(false);
  });
});
