/**
 * One-shot split of the Wave-1 god files. Safe to re-run: skips if targets exist
 * and the source no longer contains the extracted function.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
}

function write(rel, body) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body.endsWith('\n') ? body : `${body}\n`);
  console.log('wrote', rel, body.split('\n').length, 'lines');
}

function lineIndex(lines, pred, from = 0) {
  const i = lines.findIndex((l, idx) => idx >= from && pred(l));
  if (i < 0) throw new Error(`marker not found: ${pred}`);
  return i;
}

function exportTopLevel(src) {
  return src
    .replace(/^async function /gm, 'export async function ')
    .replace(/^function /gm, 'export function ')
    .replace(/^interface /gm, 'export interface ')
    .replace(/^type /gm, 'export type ')
    .replace(/^class /gm, 'export class ')
    .replace(/^export export /g, 'export ');
}

// ---------------------------------------------------------------------------
// processJob.ts
// ---------------------------------------------------------------------------
{
  const rel = 'apps/platform-worker/src/processJob.ts';
  const src = read(rel);
  if (!src.includes('async function runGenerateFsm(')) {
    console.log('processJob already split');
  } else {
    const lines = src.split('\n');
    const helperStart = lineIndex(lines, (l) =>
      l.startsWith('function readMaxFixIterations'),
    );
    const processStart = lineIndex(lines, (l) =>
      l.startsWith('export async function processPlatformJob'),
    );
    const publishStart = lineIndex(lines, (l) =>
      l.startsWith('interface PublishedPreview'),
    );
    const fsmStart = lineIndex(lines, (l) =>
      l.startsWith('async function runGenerateFsm'),
    );
    const buildStart = lineIndex(lines, (l) =>
      l.startsWith('async function runStandaloneBuild'),
    );

    const header = lines.slice(0, helperStart).join('\n');
    const helpers = exportTopLevel(lines.slice(helperStart, processStart).join('\n'));
    const dispatcher = lines.slice(processStart, publishStart).join('\n');
    const publish = exportTopLevel(lines.slice(publishStart, fsmStart).join('\n'));
    const fsm = exportTopLevel(lines.slice(fsmStart, buildStart).join('\n'));
    const standalone = exportTopLevel(lines.slice(buildStart).join('\n'));

    write(
      'apps/platform-worker/src/processJobHelpers.ts',
      `${header}

${helpers}
`,
    );

    write(
      'apps/platform-worker/src/publishDist.ts',
      `${header}

import {
  uploadJobLog,
  validateBuild,
  type ValidateBuildResult,
} from './processJobHelpers.js';
import { parseCodeChangesFromOutput } from './parseCodeChanges.js';

${publish}
`,
    );

    write(
      'apps/platform-worker/src/generateFsm.ts',
      `${header}

import {
  JobCancelledError,
  assertJobNotCancelled,
  assertWorkspacePersistenceConfigured,
  assetPhaseParallelWithCodeEnabled,
  earlySkeletonPreviewEnabled,
  ensureLinkedOpenGameRuntimeBuilt,
  ensureScaffold,
  envOff,
  failGenerateWithLog,
  invokeOpenGameCli,
  logJobStep,
  mergeChildEnv,
  readCliApprovalMode,
  readMaxFixIterations,
  startJobHeartbeat,
  throwIfCliQuotaFailure,
  uploadJobLog,
  validateBuild,
  withProgressHeartbeat,
  writeWorkerTsconfigOverlay,
} from './processJobHelpers.js';
import {
  publishGeneratedDist,
  publishSkeletonPreview,
} from './publishDist.js';
import { emitJobMetric } from './jobMetrics.js';

${fsm}
`,
    );

    write(
      'apps/platform-worker/src/standaloneBuild.ts',
      `${header}

import {
  mergeChildEnv,
  runGameWorkspaceTypecheck,
  runGameWorkspaceViteBuild,
  uploadJobLog,
} from './processJobHelpers.js';

${standalone}
`,
    );

    write(
      rel,
      `${header}

import { JobCancelledError, logJobStep, mergeChildEnv, parseBenchScores, readJobStatus, startJobCancelWatch, uploadJobLog } from './processJobHelpers.js';
import { runGenerateFsm } from './generateFsm.js';
import { runStandaloneBuild } from './standaloneBuild.js';
import { emitJobMetric } from './jobMetrics.js';

export { JobCancelledError, type ProcessJobOptions } from './processJobHelpers.js';

${dispatcher.replace(
  'export async function processPlatformJob(',
  `export async function processPlatformJob(`,
)}
`,
    );
  }
}

// ---------------------------------------------------------------------------
// workspace scene stubs
// ---------------------------------------------------------------------------
{
  const rel = 'apps/platform-worker/src/workspace.ts';
  const src = read(rel);
  if (!src.includes('function renderSceneStub(')) {
    console.log('workspace renderSceneStub already split');
  } else {
    const lines = src.split('\n');
    const renderEnd = lineIndex(lines, (l) =>
      l.startsWith('async function writeEngineGameJson'),
    );
    const start = lineIndex(lines, (l) => l.startsWith('function inferSceneRole'));
    const chunk = lines.slice(start, renderEnd).join('\n');
    const header = `/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Playable scene kernels used by engine scaffold. Archetype is a lens, not a SKU.
 */

import type { GameArchetype } from '../workspace.js';

type SceneStub = {
  readonly file: string;
  readonly className: string;
  readonly sceneKey: string;
  readonly hint: string;
};

`;
    write(
      'apps/platform-worker/src/kernels/sceneStubs.ts',
      `${header}
${exportTopLevel(chunk).replace(/^export export /gm, 'export ')}
`,
    );

    const before = lines.slice(0, start).join('\n');
    const after = lines.slice(renderEnd).join('\n');
    const importLine =
      "import { pickTitleNextScene, renderSceneStub } from './kernels/sceneStubs.js';\n";
    const withImport = before.includes("from './kernels/sceneStubs.js'")
      ? before
      : before.replace(
          "import { fileURLToPath, pathToFileURL } from 'node:url';\n",
          "import { fileURLToPath, pathToFileURL } from 'node:url';\n" + importLine,
        );
    write(
      rel,
      `${withImport}

export { pickTitleNextScene } from './kernels/sceneStubs.js';

${after}
`,
    );
  }
}

// ---------------------------------------------------------------------------
// i18n dictionaries
// ---------------------------------------------------------------------------
{
  const rel = 'apps/platform-web/src/services/i18n.ts';
  const src = read(rel);
  if (!src.includes('const en: Dictionary = {')) {
    console.log('i18n already split');
  } else {
    const lines = src.split('\n');
    const enStart = lineIndex(lines, (l) => l.startsWith('const en: Dictionary'));
    const zhStart = lineIndex(lines, (l) => l.startsWith('const zhCN: Dictionary'));
    const dictMap = lineIndex(lines, (l) => l.startsWith('const DICTIONARIES'));
    const enBody = lines.slice(enStart, zhStart).join('\n').replace(
      'const en: Dictionary = {',
      'export const en: Dictionary = {',
    );
    const zhBody = lines.slice(zhStart, dictMap).join('\n').replace(
      'const zhCN: Dictionary = {',
      'export const zhCN: Dictionary = {',
    );
    const localeHeader = `/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

export type Dictionary = Record<string, string>;

`;
    write('apps/platform-web/src/services/locales/en.ts', localeHeader + enBody);
    write(
      'apps/platform-web/src/services/locales/zh-CN.ts',
      localeHeader + zhBody,
    );
    const prelude = lines.slice(0, enStart).join('\n');
    const runtime = lines.slice(dictMap).join('\n');
    write(
      rel,
      `${prelude}

import { en } from './locales/en';
import { zhCN } from './locales/zh-CN';

${runtime}
`,
    );
  }
}

// ---------------------------------------------------------------------------
// v1.ts route groups
// ---------------------------------------------------------------------------
{
  const rel = 'apps/platform-api/src/v1.ts';
  const src = read(rel);
  if (!src.includes("authed.get('/projects/:projectId/world'")) {
    console.log('v1 world routes already split');
  } else {
    const lines = src.split('\n');
    const exportFn = lineIndex(lines, (l) =>
      l.startsWith('export function createV1Router'),
    );
    const header = lines.slice(0, exportFn).join('\n');

    const find = (needle) =>
      lineIndex(lines, (l) => l.includes(needle));

    const worldStart = find("/** GET project world tip");
    const chatStart = find("authed.get('/projects/:projectId/chat-sessions'");
    const jobsStart = find("authed.post('/projects/:projectId/jobs/:jobId/retry'");
    const heartbeatStart = find(
      "authed.post('/projects/:projectId/world/society/heartbeat'",
    );
    const deployStart = find("authed.get('/projects/:projectId/deployments'");
    const communityPublish = find("authed.post('/community/games/publish'");
    const publicBench = find("v1.get('/public/bench'");
    const previewStart = find("v1.get('/preview-dist/");
    const billingStart = find("authed.get('/billing/wallet'");
    const orgsStart = find("authed.post('/orgs'");
    const usageStart = find("authed.get('/usage'");
    const templatesStart = find("authed.get('/templates'");
    const authDev = find("v1.post('/auth/dev-token'");
    const authedNew = find('const authed = new Hono');
    const sseTickets = find("authed.post('/sse-tickets'");
    const meStart = find("authed.get('/me'");

    const ctxHeader = `${header}

import type { Context, Hono } from 'hono';
import type { V1RouteCtx, AuthedVars } from './v1Context.js';

`;

    function wrap(name, start, end) {
      const body = lines.slice(start, end).join('\n');
      return `/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

${header}

import type { Hono } from 'hono';
import type { V1RouteCtx } from './v1Context.js';

export function ${name}(
  v1: Hono<{ Variables: { jwt: import('../lib/jwt.js').JwtPayload } }>,
  authed: Hono<{ Variables: { jwt: import('../lib/jwt.js').JwtPayload } }>,
  ctx: V1RouteCtx,
): void {
  const { db, env, queue, s3 } = ctx;
  const deps = { redis: ctx.redis };
  const requireOrgAccess = ctx.requireOrgAccess;
  const optionalUserId = ctx.optionalUserId;
  const openProviderCheckout = ctx.openProviderCheckout;

${body}
}
`;
    }

    write(
      'apps/platform-api/src/routes/v1Context.ts',
      `${header}

import type { Context, Hono } from 'hono';
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import type { S3Client } from '@aws-sdk/client-s3';
import type { DrizzleDb } from '@opengame/platform-db';
import type { PlatformEnv } from '../env.js';
import type { JwtPayload } from '../lib/jwt.js';
import type { ResolvedSku } from '../lib/billing.js';

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

`,
    );

    write('apps/platform-api/src/routes/auth.ts', wrap('registerAuthRoutes', authDev, authedNew));
    // auth also needs sse + me — append by writing a combined file
    const authExtra = lines.slice(sseTickets, billingStart).join('\n');
    const authFile = read('apps/platform-api/src/routes/auth.ts').replace(
      /\n\}\n$/,
      `\n${authExtra}\n}\n`,
    );
    write('apps/platform-api/src/routes/auth.ts', authFile);

    write(
      'apps/platform-api/src/routes/billing.ts',
      wrap('registerBillingRoutes', billingStart, orgsStart) +
        '\n' +
        // second billing chunk (usage/plans) registered in same function by appending before close
        '',
    );
    const billingUsage = lines.slice(usageStart, templatesStart).join('\n');
    write(
      'apps/platform-api/src/routes/billing.ts',
      read('apps/platform-api/src/routes/billing.ts').replace(
        /\n\}\n$/,
        `\n${billingUsage}\n}\n`,
      ),
    );

    write(
      'apps/platform-api/src/routes/world.ts',
      wrap('registerWorldRoutes', worldStart, chatStart),
    );
    const worldHb = lines.slice(heartbeatStart, deployStart).join('\n');
    write(
      'apps/platform-api/src/routes/world.ts',
      read('apps/platform-api/src/routes/world.ts').replace(
        /\n\}\n$/,
        `\n${worldHb}\n}\n`,
      ),
    );

    write(
      'apps/platform-api/src/routes/jobs.ts',
      wrap('registerJobRoutes', jobsStart, heartbeatStart),
    );

    write(
      'apps/platform-api/src/routes/community.ts',
      wrap('registerCommunityRoutes', communityPublish, publicBench),
    );

    write(
      'apps/platform-api/src/routes/public.ts',
      wrap('registerPublicRoutes', publicBench, previewStart),
    );

    write(
      'apps/platform-api/src/routes/projects.ts',
      wrap('registerProjectRoutes', orgsStart, worldStart),
    );
    const chatChunk = lines.slice(chatStart, jobsStart).join('\n');
    const deployChunk = lines.slice(deployStart, usageStart).join('\n');
    const restProjects = lines.slice(templatesStart, communityPublish).join('\n');
    write(
      'apps/platform-api/src/routes/projects.ts',
      read('apps/platform-api/src/routes/projects.ts').replace(
        /\n\}\n$/,
        `\n${chatChunk}\n${deployChunk}\n${restProjects}\n}\n`,
      ),
    );

    // Slim assembler: keep cors, checkout, jwt middleware, helpers, register*, preview, kai
    const beforeAuth = lines.slice(exportFn, authDev).join('\n');
    const middleware = lines.slice(authedNew, sseTickets).join('\n');
    const optionalHelpers = lines.slice(
      lineIndex(lines, (l) => l.includes('async function optionalUserId')),
      meStart,
    ).join('\n');
    const tail = lines.slice(previewStart).join('\n');

    write(
      rel,
      `${header}

import { registerAuthRoutes } from './routes/auth.js';
import { registerBillingRoutes } from './routes/billing.js';
import { registerCommunityRoutes } from './routes/community.js';
import { registerJobRoutes } from './routes/jobs.js';
import { registerProjectRoutes } from './routes/projects.js';
import { registerPublicRoutes } from './routes/public.js';
import { registerWorldRoutes } from './routes/world.js';
import type { V1RouteCtx } from './routes/v1Context.js';

${beforeAuth}

${middleware}

${optionalHelpers}

  const ctx: V1RouteCtx = {
    db,
    env,
    queue,
    s3,
    redis: deps.redis,
    requireOrgAccess,
    optionalUserId,
    openProviderCheckout,
  };

  registerAuthRoutes(v1, authed, ctx);
  registerBillingRoutes(v1, authed, ctx);
  registerProjectRoutes(v1, authed, ctx);
  registerWorldRoutes(v1, authed, ctx);
  registerJobRoutes(v1, authed, ctx);
  registerCommunityRoutes(v1, authed, ctx);
  registerPublicRoutes(v1, authed, ctx);

${tail}
`,
    );
  }
}

console.log('extract-god-files done');
