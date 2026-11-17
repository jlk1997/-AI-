/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import type { S3Client } from '@aws-sdk/client-s3';
import type { DrizzleDb } from '@opengame/platform-db';
import { assets } from '@opengame/platform-db';

import type { WorkerEnv } from './env.js';
import { uploadDirectoryToS3 } from './uploadDirectory.js';
import {
  diffAssetHashes,
  saveAssetHashManifest,
} from './assetHashCache.js';

const ASSET_EXT_MODALITY: Record<string, string> = {
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.webp': 'image',
  '.gif': 'image',
  '.mp3': 'audio',
  '.wav': 'audio',
  '.ogg': 'audio',
  '.webm': 'video',
  '.mp4': 'video',
};

function guessModality(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return ASSET_EXT_MODALITY[ext] ?? 'image';
}

/**
 * Scans workspace public/assets and registers rows + optional S3 mirror.
 * Content-hash dedup: unchanged files are skipped (no new DB rows / no re-upload).
 */
export async function syncWorkspaceAssetsToDb(options: {
  readonly db: DrizzleDb;
  readonly s3: S3Client;
  readonly env: WorkerEnv;
  readonly projectId: string;
  readonly jobId: string;
  readonly workspace: string;
}): Promise<number> {
  const assetsDir = path.join(options.workspace, 'public', 'assets');
  if (!fs.existsSync(assetsDir)) return 0;

  const { changedRelPaths, nextManifest } = await diffAssetHashes(
    options.workspace,
  );
  await saveAssetHashManifest(options.workspace, nextManifest);

  if (changedRelPaths.length === 0) {
    return 0;
  }

  let count = 0;
  for (const relFromPublic of changedRelPaths) {
    const full = path.join(options.workspace, 'public', relFromPublic);
    if (!fs.existsSync(full)) continue;
    const st = fs.statSync(full);
    const modality = guessModality(full);
    const storageKey = `projects/${options.projectId}/assets/${options.jobId}/${relFromPublic}`;
    await options.db.insert(assets).values({
      projectId: options.projectId,
      jobId: options.jobId,
      modality,
      storageKey,
      prompt: null,
      meta: {
        localPath: relFromPublic,
        sizeBytes: st.size,
        contentHash: nextManifest.files[relFromPublic] ?? null,
        deduped: false,
      },
    });
    count += 1;
  }

  if (options.env.workspaceArchiveKeyPrefix && count > 0) {
    try {
      await uploadDirectoryToS3(
        options.s3,
        options.env,
        `projects/${options.projectId}/assets/${options.jobId}`,
        assetsDir,
      );
    } catch {
      // DB rows still useful for gallery metadata
    }
  }

  return count;
}
