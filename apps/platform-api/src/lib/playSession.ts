/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import type { S3Client } from '@aws-sdk/client-s3';
import { and, eq } from 'drizzle-orm';

import type { DrizzleDb } from '@opengame/platform-db';
import { artifacts, communityGames, deployments, playSessions } from '@opengame/platform-db';

import type { PlatformEnv } from '../env.js';
import { isPubliclyPlayable } from './communityPlayability.js';
import { authorForDeployment } from './identity.js';
import { derivePlayDslKey } from './playCrypto.js';
import {
  resolveDistPrefix,
  serveDistObject,
  type PlayWatermark,
} from './previewDist.js';

/**
 * Hosted playback.
 *
 * A published work is never handed out as a permanent URL to a static bundle.
 * Every play is a short-lived, signed session that the API mounts at
 * `/v1/play/:token/...`. That does not make the JavaScript unreadable — nothing
 * served to a browser ever is — but it means:
 *
 *   - there is no stable link to hotlink, scrape on a schedule, or mirror;
 *   - the author's workspace and source tree are never in the served prefix;
 *   - every fetch is attributable to a session row we can revoke;
 *   - "change one line" has to go through the authorised fork endpoint, which
 *     is where the licence is checked.
 */

/** Long enough for a real session, short enough that a copied link dies fast. */
export const PLAY_SESSION_TTL_SECONDS = 60 * 60 * 2;

export interface PlaySessionPayload {
  readonly v: 1;
  /** Community row, when this session came from a published work. */
  readonly gid: string | null;
  readonly did: string;
  readonly dp: string;
  /** User-agent fingerprint; see `clientFingerprint`. */
  readonly fp: string;
  readonly exp: number;
  /** `play_sessions.id`, so a session can be revoked. */
  readonly sid: string | null;
}

/**
 * Binds a session to the browser that asked for it.
 *
 * User agent only, deliberately. Mobile clients hand off between cellular and
 * wifi mid-session, so folding the IP into the binding would log real players
 * out of their own game far more often than it would stop anyone. The IP is
 * recorded on the session row instead, where it is useful for forensics without
 * being load-bearing for access.
 */
export function clientFingerprint(userAgent: string | undefined | null): string {
  return createHash('sha256')
    .update((userAgent ?? '').slice(0, 512))
    .digest('base64url')
    .slice(0, 22);
}

export function hashClientIp(ip: string | undefined | null): string {
  return createHash('sha256').update(ip ?? '').digest('hex').slice(0, 32);
}

export function signPlaySession(secret: string, payload: PlaySessionPayload): string {
  const body = JSON.stringify(payload);
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return Buffer.from(JSON.stringify({ body, sig }), 'utf8').toString('base64url');
}

export function verifyPlaySession(secret: string, token: string): PlaySessionPayload | null {
  let parsed: { body: string; sig: string };
  try {
    parsed = JSON.parse(Buffer.from(token, 'base64url').toString('utf8')) as {
      body: string;
      sig: string;
    };
  } catch {
    return null;
  }
  const expected = createHmac('sha256', secret).update(parsed.body).digest('base64url');
  try {
    const a = Buffer.from(parsed.sig, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  let payload: PlaySessionPayload;
  try {
    payload = JSON.parse(parsed.body) as PlaySessionPayload;
  } catch {
    return null;
  }
  if (payload.v !== 1) return null;
  if (typeof payload.did !== 'string' || typeof payload.dp !== 'string') return null;
  if (!payload.dp || payload.dp.includes('..')) return null;
  if (typeof payload.exp !== 'number' || Math.floor(Date.now() / 1000) > payload.exp) return null;
  if (typeof payload.fp !== 'string') return null;
  return payload;
}

export function playMountPath(token: string): string {
  return `/v1/play/${encodeURIComponent(token)}`;
}

export function buildPlayUrl(env: PlatformEnv, token: string): string {
  const tail = `${playMountPath(token)}/index.html`;
  const base = env.publicBaseUrl?.trim();
  return base ? `${base.replace(/\/$/, '')}${tail}` : tail;
}

export interface IssuePlaySessionInput {
  readonly db: DrizzleDb;
  readonly env: PlatformEnv;
  readonly deploymentId: string;
  readonly communityGameId: string | null;
  readonly userId: string | null;
  readonly userAgent: string | undefined;
  readonly clientIp: string | undefined;
  readonly refererOrigin: string | null;
  readonly ttlSeconds?: number;
}

export interface IssuedPlaySession {
  readonly url: string;
  readonly token: string;
  readonly expiresIn: number;
}

export async function issuePlaySession(
  input: IssuePlaySessionInput,
): Promise<IssuedPlaySession | null> {
  const { db, env } = input;
  const [dep] = await db
    .select()
    .from(deployments)
    .where(eq(deployments.id, input.deploymentId))
    .limit(1);
  if (!dep?.previewUrl) return null;

  let manifest: unknown;
  let storagePrefix: string | null = null;
  if (dep.artifactId) {
    const [art] = await db
      .select()
      .from(artifacts)
      .where(eq(artifacts.id, dep.artifactId))
      .limit(1);
    manifest = art?.manifest;
    storagePrefix = art?.storagePrefix ?? null;
  }
  const distPrefix = resolveDistPrefix(dep.previewUrl, manifest, storagePrefix);
  if (!distPrefix) return null;

  const ttl = input.ttlSeconds ?? PLAY_SESSION_TTL_SECONDS;
  const expiresAt = new Date(Date.now() + ttl * 1000);
  const fingerprint = clientFingerprint(input.userAgent);

  const [row] = await db
    .insert(playSessions)
    .values({
      communityGameId: input.communityGameId,
      deploymentId: dep.id,
      userId: input.userId,
      clientFingerprint: fingerprint,
      refererOrigin: input.refererOrigin,
      expiresAt,
    })
    .returning({ id: playSessions.id });

  const token = signPlaySession(env.jwtSecret, {
    v: 1,
    gid: input.communityGameId,
    did: dep.id,
    dp: distPrefix,
    fp: fingerprint,
    exp: Math.floor(expiresAt.getTime() / 1000),
    sid: row?.id ?? null,
  });

  return { url: buildPlayUrl(env, token), token, expiresIn: ttl };
}

function isEntryDocument(relPath: string): boolean {
  const norm = relPath.replace(/^\/+/, '');
  return norm === '' || norm === 'index.html' || norm.endsWith('/index.html');
}

export interface ServePlayAssetInput {
  readonly db: DrizzleDb;
  readonly s3: S3Client;
  readonly env: PlatformEnv;
  readonly token: string;
  readonly relPath: string;
  readonly userAgent: string | undefined;
}

export async function servePlaySessionAsset(input: ServePlayAssetInput): Promise<Response> {
  const { db, s3, env } = input;
  const payload = verifyPlaySession(env.jwtSecret, input.token);
  if (!payload) {
    return new Response('Forbidden', { status: 403 });
  }
  if (payload.fp !== clientFingerprint(input.userAgent)) {
    return new Response('Forbidden', { status: 403 });
  }

  /*
   * Revocation and unpublish are checked on the entry document only. Hitting
   * the database for every sprite and audio clip would cost more than it
   * protects: the assets are already behind a signature that expires, and a
   * revoked session cannot reload the game.
   */
  let watermark: PlayWatermark | null = null;
  if (isEntryDocument(input.relPath)) {
    if (payload.sid) {
      const [row] = await db
        .select({ revoked: playSessions.revoked })
        .from(playSessions)
        .where(eq(playSessions.id, payload.sid))
        .limit(1);
      if (row?.revoked) return new Response('Gone', { status: 410 });
    }
    if (payload.gid) {
      const [game] = await db
        .select({
          isPublic: communityGames.isPublic,
          takenDownAt: communityGames.takenDownAt,
          watermark: communityGames.watermark,
          title: communityGames.title,
          deploymentId: communityGames.deploymentId,
        })
        .from(communityGames)
        .where(and(eq(communityGames.id, payload.gid)))
        .limit(1);
      if (!game || !isPubliclyPlayable(game)) {
        return new Response('Gone', { status: 410 });
      }
      if (game.watermark) {
        const author = await authorForDeployment(db, game.deploymentId);
        watermark = {
          author: author?.handle ? `@${author.handle}` : (author?.displayName ?? 'OpenGame'),
          title: game.title,
        };
      }
    }
  }

  const relPath = input.relPath.replace(/^\/+/, '') || 'index.html';
  return serveDistObject(s3, env, payload.dp, playMountPath(input.token), relPath, {
    watermark,
    playDslKey: derivePlayDslKey(env.jwtSecret, input.token),
  });
}
