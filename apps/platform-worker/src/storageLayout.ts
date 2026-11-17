/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Two S3 domains, one bucket.
 *
 * Author source lives under `workspaces/` and is only read by the worker.
 * What a player is served lives under `play-bundles/` and is only the compiled
 * (and optionally obfuscated) build. Mixing the two prefixes is how a preview
 * URL accidentally becomes a source dump; keeping them apart is the cheapest
 * half of hosted playback.
 */
export const WORKSPACES_ROOT = 'workspaces';
export const PLAY_BUNDLES_ROOT = 'play-bundles';

export function playBundlePrefix(projectId: string, artifactId: string): string {
  return `${PLAY_BUNDLES_ROOT}/${projectId}/${artifactId}`;
}

/**
 * `1` / `true` means "use the default private prefix". Any other non-empty
 * value is taken as a custom root so a self-hoster can isolate tenants.
 */
export function resolveWorkspaceArchivePrefix(raw: string | undefined): string | null {
  const value = raw?.trim() ?? '';
  if (value === '0' || value.toLowerCase() === 'false' || value.toLowerCase() === 'off') {
    return null;
  }
  if (!value || value === '1' || value.toLowerCase() === 'true') return WORKSPACES_ROOT;
  return value.replace(/\/+$/, '');
}
