/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Same 60s settle as the API. Empty towns still close when nobody is GET-ing.
 * Tries API dist first in production, then src (tsx / monorepo watch).
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type { DrizzleDb } from '@opengame/platform-db';

type CourseBoardMod = {
  startCourseSettleLoop: (db: DrizzleDb, intervalMs?: number) => () => void;
  bindCoursePulseRedis: (
    redis: { publish(channel: string, message: string): Promise<unknown> } | null,
  ) => void;
};

type CoursePulseRedis = {
  publish(channel: string, message: string): Promise<unknown>;
};

export function courseBoardModuleHrefs(hereDir = path.dirname(fileURLToPath(import.meta.url))): string[] {
  const apiRoot = path.resolve(hereDir, '..', '..', 'platform-api');
  const distFile = path.join(apiRoot, 'dist', 'lib', 'courseBoard.js');
  const srcFile = path.join(apiRoot, 'src', 'lib', 'courseBoard.ts');
  const fromSrc = hereDir.replace(/\\/g, '/').endsWith('/src');
  const ordered = fromSrc ? [srcFile, distFile] : [distFile, srcFile];
  return ordered.filter((file) => existsSync(file)).map((file) => pathToFileURL(file).href);
}

async function loadCourseBoard(): Promise<CourseBoardMod> {
  const hrefs = courseBoardModuleHrefs();
  let last: unknown;
  for (const href of hrefs) {
    try {
      return (await import(href)) as CourseBoardMod;
    } catch (err) {
      last = err;
    }
  }
  throw last instanceof Error
    ? last
    : new Error('course board module not found next to the worker');
}

export function startWorkerCourseSettle(
  db: DrizzleDb,
  redis: CoursePulseRedis,
): () => void {
  let stopped = false;
  let innerStop: (() => void) | null = null;
  void loadCourseBoard()
    .then((mod) => {
      if (stopped) return;
      mod.bindCoursePulseRedis(redis);
      innerStop = mod.startCourseSettleLoop(db);
      console.info('[course] worker settle loop bound');
    })
    .catch((err: unknown) => {
      console.error('[course] worker settle bind failed', err);
    });
  return () => {
    stopped = true;
    innerStop?.();
  };
}
