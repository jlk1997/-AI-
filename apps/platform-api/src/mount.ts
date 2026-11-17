/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import type { S3Client } from '@aws-sdk/client-s3';
import type { Hono } from 'hono';

import type { DrizzleDb } from '@opengame/platform-db';

import type { PlatformEnv } from './env.js';
import { createV1Router, type V1Deps } from './v1.js';
import { createPublicRouter } from './public.js';
import { mountEmbedSdk } from './embedSdk.js';
import { checkReadiness } from './lib/readiness.js';

export function mountPlatformRoutes(
  app: Hono,
  deps: {
    readonly db: DrizzleDb;
    readonly env: PlatformEnv;
    readonly queue: Queue;
    readonly s3: S3Client;
    readonly redis: Redis;
  },
): void {
  const v1deps: V1Deps = {
    db: deps.db,
    env: deps.env,
    queue: deps.queue,
    s3: deps.s3,
    redis: deps.redis,
  };
  app.route('/v1', createV1Router(v1deps));
  app.route('/api/public', createPublicRouter(v1deps));
  mountEmbedSdk(app, deps.env);
  app.get('/readyz', async (c) => {
    const report = await checkReadiness({
      db: deps.db,
      redis: deps.redis,
      queue: deps.queue,
    });
    return c.json(report, report.ok ? 200 : 503);
  });
}
