/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Honor `projects.rescaffold_requested_at`: archive local source, replace
 * it with the pinned template. Deployments on S3 are never deleted.
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

import type { S3Client } from '@aws-sdk/client-s3';
import { eq } from 'drizzle-orm';
import type { DrizzleDb } from '@opengame/platform-db';
import { projects } from '@opengame/platform-db';

import type { AgentEventStream } from './agentEvents.js';
import type { WorkerEnv } from './env.js';
import { applyPinnedTemplateToWorkspace } from './templatePackageApply.js';
import { restoreWorkspaceFromS3, saveWorkspaceToS3 } from './workspaceArchive.js';

export async function clearWorkspaceContents(dir: string): Promise<number> {
  await fsp.mkdir(dir, { recursive: true });
  const names = await fsp.readdir(dir);
  for (const name of names) {
    await fsp.rm(path.join(dir, name), { recursive: true, force: true });
  }
  return names.length;
}

export async function honorRescaffoldRequest(params: {
  readonly db: DrizzleDb;
  readonly s3: S3Client;
  readonly env: WorkerEnv;
  readonly projectId: string;
  readonly workspaceDir: string;
  readonly gameTemplateDir: string;
  readonly skeletonDir?: string;
  readonly stream: AgentEventStream;
}): Promise<{
  readonly attempted: boolean;
  readonly applied: boolean;
  readonly restored: boolean;
  readonly archived: boolean;
  readonly reason?: string;
}> {
  const [proj] = await params.db
    .select({ rescaffoldRequestedAt: projects.rescaffoldRequestedAt })
    .from(projects)
    .where(eq(projects.id, params.projectId))
    .limit(1);
  if (!proj?.rescaffoldRequestedAt) {
    return { attempted: false, applied: false, restored: false, archived: false };
  }

  const pkgPath = path.join(params.workspaceDir, 'package.json');
  let archived = false;
  if (fs.existsSync(pkgPath) && params.env.workspaceArchiveKeyPrefix) {
    const saved = await saveWorkspaceToS3(
      params.s3,
      params.env,
      params.projectId,
      params.workspaceDir,
    );
    archived = Boolean(saved);
  }

  await clearWorkspaceContents(params.workspaceDir);

  const pinned = await applyPinnedTemplateToWorkspace({
    db: params.db,
    s3: params.s3,
    env: params.env,
    projectId: params.projectId,
    workspaceDir: params.workspaceDir,
    gameTemplateDir: params.gameTemplateDir,
    skeletonDir: params.skeletonDir,
  });

  let restored = false;
  if (!pinned.applied && params.env.workspaceArchiveKeyPrefix) {
    const r = await restoreWorkspaceFromS3(
      params.s3,
      params.env,
      params.projectId,
      params.workspaceDir,
    );
    restored = Boolean(r);
  }

  await params.db
    .update(projects)
    .set({ rescaffoldRequestedAt: null })
    .where(eq(projects.id, params.projectId));

  if (pinned.applied) {
    await params.stream.emit('system', 'PLAN', {
      summary: `已按钉重建工作区 ${pinned.slug}@${pinned.version}（预览未删）`,
      details: {
        rescaffold: true,
        slug: pinned.slug,
        version: pinned.version,
        source: pinned.source,
        archived,
        previewPreserved: true,
      },
    });
    return { attempted: true, applied: true, restored: false, archived };
  }

  await params.stream.emit('system', 'PLAN', {
    summary: restored
      ? '按钉重建失败，已从 S3 快照恢复源码'
      : '按钉重建失败，回退到环境脚手架',
    details: {
      rescaffold: true,
      archived,
      restored,
      reason: pinned.reason,
      previewPreserved: true,
    },
  });
  return {
    attempted: true,
    applied: false,
    restored,
    archived,
    reason: pinned.reason,
  };
}
