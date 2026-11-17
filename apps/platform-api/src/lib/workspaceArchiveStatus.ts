/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Keep prefix rules aligned with platform-worker `storageLayout.ts`.
 * Default ON (`workspaces/`); `false`/`0`/`off` disables.
 */

export function resolveWorkspaceArchivePrefix(raw: string | undefined): string | null {
  const value = raw?.trim() ?? '';
  if (value === '0' || value.toLowerCase() === 'false' || value.toLowerCase() === 'off') {
    return null;
  }
  if (!value || value === '1' || value.toLowerCase() === 'true') return 'workspaces';
  return value.replace(/\/+$/, '');
}

export function workspaceArchiveManifestKey(
  prefix: string | null,
  projectId: string,
): string | null {
  if (!prefix) return null;
  return `${prefix.replace(/\/+$/, '')}/projects/${projectId}/manifest.json`;
}

export function parseWorkspaceManifest(raw: string): {
  savedAt: string | null;
  fileCount: number;
  version: number | null;
} {
  try {
    const parsed = JSON.parse(raw) as {
      savedAt?: unknown;
      version?: unknown;
      files?: unknown;
    };
    const files =
      parsed.files && typeof parsed.files === 'object' && !Array.isArray(parsed.files)
        ? Object.keys(parsed.files as Record<string, unknown>).length
        : 0;
    return {
      savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : null,
      fileCount: files,
      version: typeof parsed.version === 'number' ? parsed.version : null,
    };
  } catch {
    return { savedAt: null, fileCount: 0, version: null };
  }
}

export function readBuildCacheHit(result: unknown): boolean {
  return Boolean(
    result &&
      typeof result === 'object' &&
      (result as { cacheHit?: unknown }).cacheHit === true,
  );
}
