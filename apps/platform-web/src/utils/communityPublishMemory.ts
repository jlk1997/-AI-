/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Remember deploymentId → community slug so the IDE can show "already shared".
 */

const STORAGE_KEY = 'opengame_community_published_v1';

function readMap(): Record<string, string> {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as Record<string, string>;
  } catch {
    return {};
  }
}

function writeMap(map: Record<string, string>): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* ignore quota */
  }
}

export function getPublishedSlug(deploymentId: string | null | undefined): string | null {
  if (!deploymentId) return null;
  return readMap()[deploymentId] ?? null;
}

export function rememberPublishedSlug(
  deploymentId: string,
  slug: string,
): void {
  const map = readMap();
  map[deploymentId] = slug;
  writeMap(map);
}
