/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { serve } from '@hono/node-server';

import { createDrizzle, createPostgresClient } from '@opengame/platform-db';

import { createHonoApp } from './shell.js';
import { mountPlatformRoutes } from './mount.js';
import { readPlatformEnv } from './env.js';
import { createJobQueue } from './lib/queue.js';
import { createS3Client } from './lib/s3.js';
import { bindCoursePulseRedis, startCourseSettleLoop } from './lib/courseBoard.js';
import { setSocietyLockRedis } from './lib/societyLive.js';

const env = readPlatformEnv();
const sql = createPostgresClient(env.databaseUrl);
const db = createDrizzle(sql);
const s3 = createS3Client(env);
const { queue, redis, close: closeQueue } = createJobQueue(env.redisUrl);

// Society ticks must be serialized across the API and the worker heartbeat, not
// just within this process.
setSocietyLockRedis(redis);
bindCoursePulseRedis(redis);

const app = createHonoApp();
mountPlatformRoutes(app, { db, env, queue, s3, redis });

const stopCourseSettle = startCourseSettleLoop(db);

const server = serve(
  {
    fetch: app.fetch,
    hostname: '127.0.0.1',
    port: env.port,
  },
  (info) => {
    console.log(`platform-api listening on http://127.0.0.1:${info.port}`);
  },
);

async function shutdown(): Promise<void> {
  stopCourseSettle();
  await closeQueue();
  await sql.end({ timeout: 5 });
  server.close();
}

process.on('SIGINT', () => {
  void shutdown().then(() => process.exit(0));
});
process.on('SIGTERM', () => {
  void shutdown().then(() => process.exit(0));
});

/** Surface crashes that otherwise only show up later as Vite ECONNREFUSED on :3847. */
process.on('uncaughtException', (err) => {
  console.error('[platform-api] uncaughtException — process will exit', err);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('[platform-api] unhandledRejection — process will exit', reason);
  process.exit(1);
});
