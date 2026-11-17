/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

export const ASSET_HASH_MANIFEST = '.opengame-asset-hashes.json';

export type AssetHashManifest = {
  readonly version: 1;
  readonly files: Record<string, string>;
};

function hashBuffer(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export async function loadAssetHashManifest(
  workspace: string,
): Promise<AssetHashManifest> {
  const p = path.join(workspace, ASSET_HASH_MANIFEST);
  if (!fs.existsSync(p)) return { version: 1, files: {} };
  try {
    const raw = JSON.parse(await fsp.readFile(p, 'utf8')) as AssetHashManifest;
    if (raw?.version === 1 && raw.files && typeof raw.files === 'object') {
      return raw;
    }
  } catch {
    // corrupt → start fresh
  }
  return { version: 1, files: {} };
}

export async function saveAssetHashManifest(
  workspace: string,
  manifest: AssetHashManifest,
): Promise<void> {
  const p = path.join(workspace, ASSET_HASH_MANIFEST);
  await fsp.writeFile(p, JSON.stringify(manifest, null, 2), 'utf8');
}

/**
 * Walk public/assets and return files whose content hash changed (or are new).
 * Also returns the updated full manifest for persistence.
 */
export async function diffAssetHashes(workspace: string): Promise<{
  readonly changedRelPaths: string[];
  readonly unchangedCount: number;
  readonly nextManifest: AssetHashManifest;
}> {
  const assetsDir = path.join(workspace, 'public', 'assets');
  const prev = await loadAssetHashManifest(workspace);
  const nextFiles: Record<string, string> = {};
  const changed: string[] = [];
  let unchangedCount = 0;

  if (!fs.existsSync(assetsDir)) {
    return {
      changedRelPaths: [],
      unchangedCount: 0,
      nextManifest: { version: 1, files: {} },
    };
  }

  async function walk(dir: string): Promise<void> {
    for (const name of await fsp.readdir(dir)) {
      const full = path.join(dir, name);
      const st = await fsp.stat(full);
      if (st.isDirectory()) {
        await walk(full);
        continue;
      }
      const rel = path
        .relative(path.join(workspace, 'public'), full)
        .replace(/\\/g, '/');
      const buf = await fsp.readFile(full);
      const h = hashBuffer(buf);
      nextFiles[rel] = h;
      if (prev.files[rel] === h) {
        unchangedCount += 1;
      } else {
        changed.push(rel);
      }
    }
  }

  await walk(assetsDir);
  return {
    changedRelPaths: changed,
    unchangedCount,
    nextManifest: { version: 1, files: nextFiles },
  };
}
