/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * project_templates already records an apply. The worker must honor that pin
 * on an empty workspace instead of only copying PLATFORM_GAME_TEMPLATE_DIR.
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { GetObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { desc, eq } from 'drizzle-orm';
import type { DrizzleDb } from '@opengame/platform-db';
import { projectTemplates, templatePackages } from '@opengame/platform-db';

import type { WorkerEnv } from './env.js';
import { runShellCommand } from './runProcess.js';

export type PinnedTemplate = {
  readonly slug: string;
  readonly version: string;
  readonly storageKey: string;
  readonly official: boolean;
};

export async function loadPinnedTemplate(
  db: DrizzleDb,
  projectId: string,
): Promise<PinnedTemplate | null> {
  const [row] = await db
    .select({
      slug: templatePackages.slug,
      version: templatePackages.version,
      storageKey: templatePackages.storageKey,
      organizationId: templatePackages.organizationId,
    })
    .from(projectTemplates)
    .innerJoin(templatePackages, eq(projectTemplates.templateId, templatePackages.id))
    .where(eq(projectTemplates.projectId, projectId))
    .orderBy(desc(projectTemplates.createdAt))
    .limit(1);
  if (!row) return null;
  return {
    slug: row.slug,
    version: row.version,
    storageKey: row.storageKey,
    official: row.organizationId == null,
  };
}

export function resolveOfficialTemplateDir(
  storageKey: string,
  gameTemplateDir: string,
  skeletonDir?: string,
): string | null {
  const key = storageKey.trim();
  if (key.startsWith('official://')) {
    const kind = key.slice('official://'.length).replace(/\/+$/, '') || 'core';
    if (kind === 'core' || kind === 'legacy') return gameTemplateDir;
    if (kind === 'skeleton' && skeletonDir) return skeletonDir;
    return gameTemplateDir;
  }
  if (key.startsWith('file:')) {
    try {
      const dir = fileURLToPath(key);
      return fs.existsSync(dir) && fs.statSync(dir).isDirectory() ? dir : null;
    } catch {
      return null;
    }
  }
  if ((key.startsWith('/') || /^[A-Za-z]:[\\/]/.test(key)) && fs.existsSync(key)) {
    return fs.statSync(key).isDirectory() ? key : null;
  }
  return null;
}

async function readS3Buffer(
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

export async function applyPinnedTemplateToWorkspace(params: {
  readonly db: DrizzleDb;
  readonly s3: S3Client;
  readonly env: WorkerEnv;
  readonly projectId: string;
  readonly workspaceDir: string;
  readonly gameTemplateDir: string;
  readonly skeletonDir?: string;
}): Promise<
  | { readonly applied: false; readonly reason: string }
  | {
      readonly applied: true;
      readonly slug: string;
      readonly version: string;
      readonly source: 'local-dir' | 's3-tarball';
      readonly official: boolean;
    }
> {
  const pkgPath = path.join(params.workspaceDir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    return { applied: false, reason: 'workspace already has package.json' };
  }
  const pin = await loadPinnedTemplate(params.db, params.projectId);
  if (!pin) {
    return { applied: false, reason: 'no project_templates pin' };
  }
  const localDir = resolveOfficialTemplateDir(
    pin.storageKey,
    params.gameTemplateDir,
    params.skeletonDir,
  );
  if (localDir) {
    await fsp.mkdir(params.workspaceDir, { recursive: true });
    await fsp.cp(localDir, params.workspaceDir, { recursive: true, force: true });
    return {
      applied: true,
      slug: pin.slug,
      version: pin.version,
      source: 'local-dir',
      official: pin.official,
    };
  }
  const buf = await readS3Buffer(params.s3, params.env, pin.storageKey);
  if (!buf) {
    return {
      applied: false,
      reason: `template blob missing at ${pin.storageKey}`,
    };
  }
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'og-tpl-'));
  const tarball = path.join(tmp, 'package.tgz');
  try {
    await fsp.writeFile(tarball, buf);
    await fsp.mkdir(params.workspaceDir, { recursive: true });
    const extracted = await runShellCommand(`tar -xzf "${tarball}" -C "${params.workspaceDir}"`, {
      cwd: tmp,
      env: process.env,
    });
    if (extracted.exitCode !== 0) {
      return {
        applied: false,
        reason: `tar extract failed (exit ${extracted.exitCode}): ${extracted.stderr.slice(0, 240)}`,
      };
    }
    const nestedPkg = path.join(params.workspaceDir, 'package', 'package.json');
    if (!fs.existsSync(pkgPath) && fs.existsSync(nestedPkg)) {
      const nested = path.join(params.workspaceDir, 'package');
      for (const name of await fsp.readdir(nested)) {
        await fsp.rename(path.join(nested, name), path.join(params.workspaceDir, name));
      }
      await fsp.rm(nested, { recursive: true, force: true });
    }
    return {
      applied: true,
      slug: pin.slug,
      version: pin.version,
      source: 's3-tarball',
      official: pin.official,
    };
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
}
