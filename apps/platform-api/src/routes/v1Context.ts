/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import type { S3Client } from '@aws-sdk/client-s3';
import type { Context } from 'hono';

import type { DrizzleDb } from '@opengame/platform-db';

import type { PlatformEnv } from '../env.js';
import type { ResolvedSku } from '../lib/billing.js';
import type { JwtPayload } from '../lib/jwt.js';

export type AuthedVars = { Variables: { jwt: JwtPayload } };

export type V1RouteCtx = {
  readonly db: DrizzleDb;
  readonly env: PlatformEnv;
  readonly queue: Queue;
  readonly s3: S3Client;
  readonly redis: Redis;
  readonly requireOrgAccess: (
    c: Context<AuthedVars>,
  ) => Promise<string | Response>;
  readonly optionalUserId: (c: Context) => Promise<string | null>;
  readonly openProviderCheckout: (params: {
    readonly provider: string;
    readonly channel: string;
    readonly resolved: ResolvedSku;
    readonly outTradeNo: string;
    readonly openid?: string | undefined;
    readonly returnUrl?: string | undefined;
    readonly clientIp: string;
  }) => Promise<Record<string, unknown>>;
};
