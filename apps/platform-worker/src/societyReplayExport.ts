/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Export society_replay.json into presenter public/ + S3 dist for Stanford-town stage.
 */

import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

import {
  loadSocietyReplayBundle,
  type DrizzleDb,
} from '@opengame/platform-db';
import type { S3Client } from '@aws-sdk/client-s3';

import type { WorkerEnv } from './env.js';
import { putObjectUtf8 } from './s3.js';

export async function writeSocietyReplayArtifact(input: {
  readonly db: DrizzleDb;
  readonly worldId: string;
  readonly projectId: string;
  readonly workspace?: string;
  readonly s3?: S3Client;
  readonly env?: WorkerEnv;
  /** e.g. projects/{projectId}/artifacts/{id}/dist */
  readonly distPrefix?: string;
}): Promise<{ readonly bytes: number; readonly eventCount: number }> {
  const bundle = await loadSocietyReplayBundle(input.db, input.worldId);
  const payload = {
    version: 1 as const,
    worldId: input.worldId,
    projectId: input.projectId,
    simTime: bundle.simTime,
    agents: bundle.agents,
    events: bundle.events,
    report: bundle.report,
  };
  const body = JSON.stringify(payload);
  const bytes = Buffer.byteLength(body, 'utf8');

  if (input.workspace) {
    const publicDir = path.join(input.workspace, 'public');
    await fsp.mkdir(publicDir, { recursive: true });
    await fsp.writeFile(
      path.join(publicDir, 'society_replay.json'),
      body,
      'utf8',
    );
    // Also drop into dist if already built
    const distDir = path.join(input.workspace, 'dist');
    try {
      await fsp.access(distDir);
      await fsp.writeFile(
        path.join(distDir, 'society_replay.json'),
        body,
        'utf8',
      );
    } catch {
      // dist may not exist yet
    }
  }

  if (input.s3 && input.env && input.distPrefix) {
    const key = `${input.distPrefix.replace(/\/$/, '')}/society_replay.json`;
    await putObjectUtf8(
      input.s3,
      input.env,
      key,
      body,
      'application/json; charset=utf-8',
    );
  }

  return { bytes, eventCount: bundle.events.length };
}
