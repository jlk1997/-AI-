/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

import { GetObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';

import type { WorkerEnv } from './env.js';

/**
 * Workspace externalization for worker pooling.
 *
 * To support pool deployment (where job N+1 may land on a different worker than
 * job N), every project workspace is persisted as a **manifest of content-addressed
 * S3 objects** under `s3://${bucket}/${prefix}/projects/${projectId}/`.
 *
 * The trade-off vs. a single tarball:
 *
 *   - Per-file uploads give us free dedup (node_modules layers reuse hashes).
 *   - The manifest is plain JSON which is trivial to diff/inspect.
 *   - No native `tar` dep required (works on all worker platforms).
 *   - Round-trip cost = N PUTs/GETs. We exclude `node_modules` to keep N small.
 *
 * The S3 layout is:
 *
 * ```
 * ${prefix}/projects/${projectId}/manifest.json
 * ${prefix}/projects/${projectId}/blobs/${sha256}
 * ```
 *
 * Manifest schema (v1):
 *
 * ```jsonc
 * {
 *   "version": 1,
 *   "savedAt": "2026-05-13T05:30:00Z",
 *   "files": {
 *     "package.json":  { "sha256": "...", "size": 1234, "mode": 33188 },
 *     "src/main.ts":   { "sha256": "...", "size":  890, "mode": 33188 }
 *   }
 * }
 * ```
 */

interface ManifestFile {
  readonly sha256: string;
  readonly size: number;
  readonly mode: number;
}

interface Manifest {
  readonly version: 1;
  readonly savedAt: string;
  readonly files: Record<string, ManifestFile>;
}

const MANIFEST_VERSION = 1;

const ALWAYS_EXCLUDED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  '.cache',
  '.turbo',
  // Build/smoke fingerprints are machine-local; restoring them on another
  // worker would let a stale verdict skip a real check.
  '.opengame-cache',
]);

function archiveKeyPrefix(env: WorkerEnv, projectId: string): string | null {
  const root = env.workspaceArchiveKeyPrefix;
  if (!root) return null;
  return `${root.replace(/\/+$/, '')}/projects/${projectId}`;
}

function manifestKey(env: WorkerEnv, projectId: string): string | null {
  const root = archiveKeyPrefix(env, projectId);
  return root ? `${root}/manifest.json` : null;
}

function blobKey(env: WorkerEnv, projectId: string, sha256: string): string | null {
  const root = archiveKeyPrefix(env, projectId);
  return root ? `${root}/blobs/${sha256}` : null;
}

async function* walkFiles(dir: string, base = dir): AsyncGenerator<{ abs: string; rel: string }> {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (ALWAYS_EXCLUDED_DIRS.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    const rel = path.relative(base, abs).split(path.sep).join('/');
    if (entry.isDirectory()) {
      yield* walkFiles(abs, base);
      continue;
    }
    if (entry.isFile()) {
      yield { abs, rel };
    }
  }
}

async function sha256File(filePath: string): Promise<{ sha256: string; size: number }> {
  const buf = await fsp.readFile(filePath);
  const hash = createHash('sha256').update(buf).digest('hex');
  return { sha256: hash, size: buf.length };
}

async function objectExists(
  s3: S3Client,
  env: WorkerEnv,
  key: string,
): Promise<boolean> {
  try {
    await s3.send(
      new GetObjectCommand({
        Bucket: env.s3Bucket,
        Key: key,
        Range: 'bytes=0-0',
      }),
    );
    return true;
  } catch (err) {
    if ((err as { name?: string }).name === 'NoSuchKey') return false;
    // Some S3-compatible stores throw 404 differently; treat any error as "absent" here.
    return false;
  }
}

/**
 * Snapshot a workspace into the configured S3 prefix. Returns `null` when
 * archive mode is disabled (no `PLATFORM_WORKSPACE_ARCHIVE_PREFIX` set).
 */
export async function saveWorkspaceToS3(
  s3: S3Client,
  env: WorkerEnv,
  projectId: string,
  workspaceDir: string,
): Promise<{ manifestKey: string; fileCount: number; bytesUploaded: number } | null> {
  if (!env.workspaceArchiveKeyPrefix) return null;
  if (!fs.existsSync(workspaceDir)) return null;

  const files: Record<string, ManifestFile> = {};
  let bytesUploaded = 0;
  for await (const { abs, rel } of walkFiles(workspaceDir)) {
    const stat = await fsp.stat(abs);
    const { sha256, size } = await sha256File(abs);
    files[rel] = { sha256, size, mode: stat.mode };

    const key = blobKey(env, projectId, sha256);
    if (!key) continue;

    // Skip upload if the blob already exists (content-addressed → idempotent).
    if (await objectExists(s3, env, key)) continue;
    const body = await fsp.readFile(abs);
    await s3.send(
      new PutObjectCommand({
        Bucket: env.s3Bucket,
        Key: key,
        Body: body,
      }),
    );
    bytesUploaded += size;
  }

  const manifest: Manifest = {
    version: MANIFEST_VERSION,
    savedAt: new Date().toISOString(),
    files,
  };
  const mkey = manifestKey(env, projectId);
  if (!mkey) return null;
  await s3.send(
    new PutObjectCommand({
      Bucket: env.s3Bucket,
      Key: mkey,
      Body: Buffer.from(JSON.stringify(manifest), 'utf8'),
      ContentType: 'application/json',
    }),
  );
  return { manifestKey: mkey, fileCount: Object.keys(files).length, bytesUploaded };
}

async function readObjectAsBuffer(
  s3: S3Client,
  env: WorkerEnv,
  key: string,
): Promise<Buffer | null> {
  try {
    const out = await s3.send(new GetObjectCommand({ Bucket: env.s3Bucket, Key: key }));
    if (!out.Body) return null;
    const stream = out.Body as NodeJS.ReadableStream;
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  } catch (err) {
    if ((err as { name?: string }).name === 'NoSuchKey') return null;
    throw err;
  }
}

/**
 * Restore a workspace into `workspaceDir`. Returns `null` if no archive exists
 * or archive mode is disabled. Caller can fall back to fresh scaffolding.
 */
export async function restoreWorkspaceFromS3(
  s3: S3Client,
  env: WorkerEnv,
  projectId: string,
  workspaceDir: string,
): Promise<{ manifestKey: string; fileCount: number; restored: number } | null> {
  if (!env.workspaceArchiveKeyPrefix) return null;
  const mkey = manifestKey(env, projectId);
  if (!mkey) return null;
  const manifestBuf = await readObjectAsBuffer(s3, env, mkey);
  if (!manifestBuf) return null;

  const manifest = JSON.parse(manifestBuf.toString('utf8')) as Manifest;
  if (manifest.version !== MANIFEST_VERSION) {
    throw new Error(`unsupported workspace manifest version: ${manifest.version}`);
  }
  await fsp.mkdir(workspaceDir, { recursive: true });

  let restored = 0;
  for (const [rel, info] of Object.entries(manifest.files)) {
    const dst = path.join(workspaceDir, rel);
    await fsp.mkdir(path.dirname(dst), { recursive: true });
    // Already-present + matching hash? Skip.
    if (fs.existsSync(dst)) {
      const { sha256 } = await sha256File(dst);
      if (sha256 === info.sha256) continue;
    }
    const bkey = blobKey(env, projectId, info.sha256);
    if (!bkey) continue;
    const buf = await readObjectAsBuffer(s3, env, bkey);
    if (!buf) {
      throw new Error(`workspace blob missing for ${rel} (sha256=${info.sha256})`);
    }
    await fsp.writeFile(dst, buf);
    try {
      await fsp.chmod(dst, info.mode & 0o777);
    } catch {
      // Ignore mode errors on Windows.
    }
    restored += 1;
  }

  return {
    manifestKey: mkey,
    fileCount: Object.keys(manifest.files).length,
    restored,
  };
}
