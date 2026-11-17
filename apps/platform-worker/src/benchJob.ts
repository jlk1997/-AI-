/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Standalone quality job. Default command is the workspace test:ci / test
 * script. PLATFORM_BENCH_COMMAND still wins when the operator set one.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { eq } from 'drizzle-orm';
import type { S3Client } from '@aws-sdk/client-s3';
import type { DrizzleDb } from '@opengame/platform-db';
import { benchRuns, jobs, usageEvents } from '@opengame/platform-db';

import type { AgentEventStream } from './agentEvents.js';
import type { WorkerEnv } from './env.js';
import { readOptionalGameDocEnv, readWorkRoot } from './generationEnv.js';
import { resolveBenchCommand } from './resolveBenchCommand.js';
import { mergeChildEnv, parseBenchScores, uploadJobLog } from './processJobHelpers.js';
import { runShellCommand } from './runProcess.js';
import { appendSessionTimeline } from './sessionTimeline.js';
import { restoreWorkspaceFromS3 } from './workspaceArchive.js';
import { projectWorkspaceRoot } from './workspace.js';

export async function runBenchJob(
  db: DrizzleDb,
  s3: S3Client,
  env: WorkerEnv,
  job: {
    id: string;
    sessionId: string | null;
    payload: unknown;
  },
  organizationId: string,
  projectId: string,
  jobId: string,
  stream: AgentEventStream,
): Promise<void> {
  const workRoot = readWorkRoot();
  const workspace = projectWorkspaceRoot(workRoot, projectId);
  const pkg = path.join(workspace, 'package.json');
  if (!fs.existsSync(pkg) && env.workspaceArchiveKeyPrefix) {
    try {
      await restoreWorkspaceFromS3(s3, env, projectId, workspace);
    } catch {
      /* resolveBenchCommand reports the missing workspace honestly */
    }
  }

  const resolved = resolveBenchCommand(workspace, process.env['PLATFORM_BENCH_COMMAND']);
  if (!resolved.ok) {
    throw new Error(resolved.reason);
  }

  const docEnv = readOptionalGameDocEnv();
  const childEnv = docEnv
    ? mergeChildEnv(process.env, docEnv.gameTemplatesParentDir, docEnv.gameDocsDir)
    : { ...process.env, GEMINI_SANDBOX: process.env['GEMINI_SANDBOX'] ?? 'false' };
  const benchStart = Date.now();
  await stream.emit('qa', 'QA', {
    tool: resolved.command,
    summary: `执行 Bench（${resolved.source}）`,
  });
  const result = await runShellCommand(resolved.command, { cwd: workspace, env: childEnv });
  const elapsedMs = Date.now() - benchStart;
  const logKey = await uploadJobLog(
    s3,
    env,
    projectId,
    jobId,
    `command=${resolved.command}\nsource=${resolved.source}\nexit=${result.exitCode}\nelapsedMs=${elapsedMs}\n${result.stdout}\n${result.stderr}`,
  );
  await db.update(jobs).set({ logKey, updatedAt: new Date() }).where(eq(jobs.id, jobId));
  if (result.exitCode !== 0) {
    throw new Error(`Bench command failed (exit ${result.exitCode}); log: ${logKey}`);
  }
  const benchPayload = job.payload as {
    publish?: boolean;
    label?: string;
    seed?: number | string;
  } | null;
  const parsedScores = parseBenchScores(result.stdout);
  const finalScores = {
    ...parsedScores,
    command: resolved.command,
    commandSource: resolved.source,
    elapsedMs,
    exitCode: result.exitCode,
    stdoutChars: result.stdout.length,
    stderrChars: result.stderr.length,
    ...(benchPayload?.seed != null ? { seed: benchPayload.seed } : {}),
  };
  await db.insert(benchRuns).values({
    projectId,
    jobId,
    status: 'succeeded',
    scores: finalScores,
    isPublic: Boolean(benchPayload?.publish),
    publicLabel: benchPayload?.label ?? null,
  });
  await db
    .update(jobs)
    .set({ status: 'succeeded', updatedAt: new Date() })
    .where(eq(jobs.id, jobId));
  await db.insert(usageEvents).values({
    organizationId,
    jobId,
    modality: 'bench',
    units: '1',
    meta: {
      jobType: 'bench',
      ms: elapsedMs,
      exitCode: result.exitCode,
      commandSource: resolved.source,
    },
  });
  await appendSessionTimeline(
    db,
    job.sessionId,
    `Bench finished via ${resolved.source} (${resolved.command}). See job log for output.`,
  );
  await stream.emit('system', 'DONE', {
    summary: `Bench 通过（${resolved.source}）`,
    details: { command: resolved.command, elapsedMs },
  });
}
