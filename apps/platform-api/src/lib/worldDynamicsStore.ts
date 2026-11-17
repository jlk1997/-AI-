/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Persist / load HybridWorldModel weights under PLATFORM_WORK_ROOT
 * (same layout as platform-worker: projects/<id>/repo/public/dynamics.json).
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

export type DynamicsFile = {
  format: string;
  finalLoss?: number;
  losses?: number[];
  weights: unknown;
  steps?: number;
  trainedAt?: string;
  source?: string;
};

function workRoot(): string | null {
  const root = process.env['PLATFORM_WORK_ROOT']?.trim();
  return root || null;
}

export function dynamicsFilePath(projectId: string): string | null {
  const root = workRoot();
  if (!root) return null;
  return path.join(
    root,
    'projects',
    projectId,
    'repo',
    'public',
    'dynamics.json',
  );
}

export async function loadDynamicsWeights(
  projectId: string,
): Promise<DynamicsFile | null> {
  const file = dynamicsFilePath(projectId);
  if (!file || !fs.existsSync(file)) return null;
  try {
    const raw = JSON.parse(await fsp.readFile(file, 'utf8')) as DynamicsFile;
    if (!raw?.weights) return null;
    return raw;
  } catch {
    return null;
  }
}

export async function saveDynamicsWeights(
  projectId: string,
  data: DynamicsFile,
): Promise<string | null> {
  const file = dynamicsFilePath(projectId);
  if (!file) return null;
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, JSON.stringify(data, null, 2), 'utf8');
  return file;
}
