/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import type { PlatformEnv } from '../env.js';

export function createS3Client(env: PlatformEnv): S3Client {
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

export async function putObjectText(
  client: S3Client,
  env: PlatformEnv,
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

export async function putObjectBytes(
  client: S3Client,
  env: PlatformEnv,
  key: string,
  body: Buffer | Uint8Array,
  contentType: string,
): Promise<void> {
  await client.send(
    new PutObjectCommand({
      Bucket: env.s3Bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

export async function presignGetObject(
  client: S3Client,
  env: PlatformEnv,
  key: string,
  expiresSeconds: number,
): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: env.s3Bucket, Key: key });
  return getSignedUrl(client, cmd, { expiresIn: expiresSeconds });
}

/** Server-side GetObject so studio can read job logs without S3 CORS. */
export async function getObjectUtf8(
  client: S3Client,
  env: PlatformEnv,
  key: string,
): Promise<string | null> {
  try {
    const out = await client.send(
      new GetObjectCommand({ Bucket: env.s3Bucket, Key: key }),
    );
    if (!out.Body) return null;
    const body = out.Body as {
      transformToString?: (enc?: string) => Promise<string>;
    };
    if (typeof body.transformToString === 'function') {
      return await body.transformToString('utf-8');
    }
    const stream = out.Body as NodeJS.ReadableStream;
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString('utf8');
  } catch (err) {
    const name = (err as { name?: string }).name;
    if (name === 'NoSuchKey' || name === 'NotFound') return null;
    throw err;
  }
}
