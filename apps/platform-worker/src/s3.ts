/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

import type { WorkerEnv } from './env.js';

export function createS3Client(env: WorkerEnv): S3Client {
  return new S3Client({
    region: env.s3Region,
    endpoint: env.s3Endpoint,
    credentials: {
      accessKeyId: env.s3AccessKey,
      secretAccessKey: env.s3SecretKey,
    },
    forcePathStyle: env.s3ForcePathStyle,
  });
}

export async function putObjectUtf8(
  client: S3Client,
  env: WorkerEnv,
  key: string,
  body: string,
  contentType: string,
): Promise<void> {
  const base = key.split('/').pop()?.toLowerCase() ?? '';
  const cacheControl =
    base === 'society_replay.json' ||
    base === 'world.json' ||
    base === 'index.html'
      ? 'no-store, no-cache, must-revalidate'
      : undefined;
  await client.send(
    new PutObjectCommand({
      Bucket: env.s3Bucket,
      Key: key,
      Body: Buffer.from(body, 'utf8'),
      ContentType: contentType,
      ...(cacheControl ? { CacheControl: cacheControl } : {}),
    }),
  );
}
