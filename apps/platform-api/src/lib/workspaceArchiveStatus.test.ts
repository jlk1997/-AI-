/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import {
  parseWorkspaceManifest,
  readBuildCacheHit,
  resolveWorkspaceArchivePrefix,
  workspaceArchiveManifestKey,
} from './workspaceArchiveStatus.js';

describe('resolveWorkspaceArchivePrefix', () => {
  it('defaults on and honors an explicit off', () => {
    expect(resolveWorkspaceArchivePrefix(undefined)).toBe('workspaces');
    expect(resolveWorkspaceArchivePrefix('')).toBe('workspaces');
    expect(resolveWorkspaceArchivePrefix('true')).toBe('workspaces');
    expect(resolveWorkspaceArchivePrefix('false')).toBeNull();
    expect(resolveWorkspaceArchivePrefix('tenant-a')).toBe('tenant-a');
  });
});

describe('workspaceArchiveManifestKey', () => {
  it('builds the worker layout key', () => {
    expect(workspaceArchiveManifestKey('workspaces', 'p1')).toBe(
      'workspaces/projects/p1/manifest.json',
    );
    expect(workspaceArchiveManifestKey(null, 'p1')).toBeNull();
  });
});

describe('parseWorkspaceManifest', () => {
  it('reads savedAt and file count', () => {
    expect(
      parseWorkspaceManifest(
        JSON.stringify({
          version: 1,
          savedAt: '2026-08-19T00:00:00.000Z',
          files: { 'package.json': { sha256: 'a', size: 1 } },
        }),
      ),
    ).toEqual({
      savedAt: '2026-08-19T00:00:00.000Z',
      fileCount: 1,
      version: 1,
    });
    expect(parseWorkspaceManifest('not-json')).toEqual({
      savedAt: null,
      fileCount: 0,
      version: null,
    });
  });
});

describe('readBuildCacheHit', () => {
  it('only treats an explicit cacheHit flag as a hit', () => {
    expect(readBuildCacheHit({ cacheHit: true })).toBe(true);
    expect(readBuildCacheHit({ contentHash: 'abc' })).toBe(false);
    expect(readBuildCacheHit(null)).toBe(false);
  });
});
