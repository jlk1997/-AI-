/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { and, desc, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { cors } from 'hono/cors';

import {
  benchRuns,
  communityGames,
  deployments,
  gameLeaderboards,
  gameRatings,
  pluginPackages,
  pluginVersions,
  projects,
} from '@opengame/platform-db';

import type { V1Deps } from './v1.js';
import {
  consumeRateLimit,
  resolveApiKey,
  touchApiKeyAsync,
  type ResolvedApiKey,
} from './lib/apiKey.js';
import { apiError, ErrorCode } from './lib/errorCodes.js';
import { cacheJson } from './lib/responseCache.js';
import { assertHourlyCap, HOURLY_CAPS } from './lib/actionGate.js';
import { isPubliclyPlayable } from './lib/communityPlayability.js';
import { isOriginAllowed, resolveEmbedOrigins } from './lib/license.js';
import { issuePlaySession, PLAY_SESSION_TTL_SECONDS } from './lib/playSession.js';
import { publicWorldEmbed } from './lib/publicWorldEmbed.js';

type PublicVars = { apiKey: ResolvedApiKey | null };

const SCOPE_EMBED = 'embed:read';
const SCOPE_LEADERBOARD_WRITE = 'leaderboard:write';
const SCOPE_PLUGINS = 'plugins:read';
const SCOPE_BENCH = 'bench:read';

/**
 * Hosts the **public ecosystem API** under `/api/public/*`.
 *
 * Design notes:
 *
 * - All routes are CORS-open (`*`) because the entire purpose is for third-party
 *   sites to embed games via `<iframe>` or call the leaderboard from their own
 *   pages. Sensitive write routes are gated on API key scopes.
 *
 * - Auth is "API key OR anonymous". Anonymous reads on community/bench data
 *   are still allowed (those are public on the website anyway), but every
 *   request is rate-limited — anonymous traffic shares a single bucket per
 *   client IP, key traffic gets its own bucket and a higher allowance.
 *
 * - Everything returns small, stable JSON shapes. No HTML, no presigned S3
 *   URLs that would leak per-org keys, and no internal identifiers beyond
 *   `slug` / `version` / `id`.
 */
export function createPublicRouter(deps: V1Deps): Hono<{ Variables: PublicVars }> {
  const { db, env, redis } = deps;
  const app = new Hono<{ Variables: PublicVars }>();

  app.use(
    '*',
    cors({
      origin: '*',
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Authorization', 'X-API-Key', 'Content-Type'],
      maxAge: 86400,
    }),
  );

  // ----- Key + rate limit middleware -------------------------------------
  app.use('*', async (c, next) => {
    const rawKey =
      c.req.header('x-api-key') ??
      c.req.header('authorization')?.replace(/^Bearer\s+/i, '') ??
      null;

    let key: ResolvedApiKey | null = null;
    if (rawKey) {
      key = await resolveApiKey(db, rawKey);
      if (!key) {
        return c.json(apiError(ErrorCode.FORBIDDEN, 'invalid API key'), 401);
      }
      touchApiKeyAsync(db, key.id);
    }
    c.set('apiKey', key);

    const bucketKey = key
      ? `key:${key.id}`
      : `ip:${c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? c.req.header('cf-connecting-ip') ?? 'unknown'}`;
    const limit = key?.rateLimitPerMinute ?? 30; // anonymous = 30 / min

    const rl = await consumeRateLimit(redis, bucketKey, limit);
    c.header('X-RateLimit-Limit', String(rl.limit));
    c.header('X-RateLimit-Remaining', String(rl.remaining));
    c.header('X-RateLimit-Reset', String(rl.resetSeconds));
    if (!rl.ok) {
      return c.json(
        apiError(ErrorCode.RATE_LIMITED, 'rate limit exceeded', {
          limit: rl.limit,
          resetSeconds: rl.resetSeconds,
        }),
        429,
      );
    }
    await next();
    return;
  });

  function requireScope(scope: string) {
    return async (
      c: Parameters<Parameters<typeof app.use>[1]>[0],
      next: () => Promise<void>,
    ) => {
      const key = c.get('apiKey' as never) as
        | { scopes?: string[] }
        | undefined;
      if (!key) {
        return c.json(
          apiError(ErrorCode.FORBIDDEN, `API key required (scope=${scope})`),
          401,
        );
      }
      const scopes = key.scopes ?? [];
      if (!scopes.includes('*') && !scopes.includes(scope)) {
        return c.json(
          apiError(ErrorCode.FORBIDDEN, `missing scope: ${scope}`),
          403,
        );
      }
      await next();
      return;
    };
  }

  // ----- Community read API (anonymous OK) ------------------------------
  app.get('/games', async (c) => {
    const page = Math.max(1, Number(c.req.query('page') ?? '1'));
    const pageSize = Math.min(100, Math.max(1, Number(c.req.query('pageSize') ?? '20')));
    const offset = (page - 1) * pageSize;

    const data = await cacheJson({
      redis,
      key: `public:games:${page}:${pageSize}`,
      ttlSeconds: 60,
      producer: async () => {
        const rows = await db
          .select({
            slug: communityGames.slug,
            title: communityGames.title,
            description: communityGames.description,
            thumbnail: communityGames.thumbnail,
            category: communityGames.category,
            publishedAt: communityGames.publishedAt,
            playCount: communityGames.playCount,
          })
          .from(communityGames)
          .where(eq(communityGames.isPublic, true))
          .orderBy(desc(communityGames.publishedAt))
          .limit(pageSize)
          .offset(offset);
        return { page, pageSize, games: rows };
      },
    });
    c.header('Cache-Control', 'public, max-age=30, s-maxage=120');
    return c.json(data);
  });

  /** Stable embed payload — third-party sites use this to render an `<iframe>`. */
  app.get('/games/:slug/embed', async (c) => {
    const slug = c.req.param('slug');
    const [game] = await db
      .select()
      .from(communityGames)
      .where(eq(communityGames.slug, slug))
      .limit(1);
    if (!isPubliclyPlayable(game)) return c.json({ error: 'not found' }, 404);
    const allowedOrigins = resolveEmbedOrigins(game.embedOrigins, [
      ...(env.publicBaseUrl ? [env.publicBaseUrl] : []),
      ...(env.webBaseUrl ? [env.webBaseUrl] : []),
    ]);
    const requestOrigin = (() => {
      const raw = c.req.header('origin') ?? c.req.header('referer');
      if (!raw) return null;
      try {
        return new URL(raw).origin;
      } catch {
        return null;
      }
    })();
    const worldEmbed = publicWorldEmbed({
      category: game.category,
      slug: game.slug,
      webBaseUrl: env.webBaseUrl ?? env.publicBaseUrl,
    });
    const sandbox = 'allow-scripts allow-same-origin allow-pointer-lock';
    if (worldEmbed) {
      c.header('Cache-Control', 'no-store');
      return c.json({
        slug: game.slug,
        title: game.title,
        thumbnail: game.thumbnail,
        iframeUrl: worldEmbed.embedUrl,
        embedUrl: worldEmbed.embedUrl,
        embedDenied: worldEmbed.embedDenied,
        allowedOrigins,
        width: 800,
        height: 600,
        iframeSandbox: sandbox,
      });
    }
    const [dep] = await db
      .select()
      .from(deployments)
      .where(eq(deployments.id, game.deploymentId))
      .limit(1);
    if (!dep) return c.json({ error: 'deployment not found' }, 404);

    let iframeUrl: string | null = null;
    let embedDenied: string | null = null;
    if (env.allowPublicPlayUrls && dep.cdnUrl && dep.customDomainVerified) {
      iframeUrl = `${dep.cdnUrl}${dep.cdnUrl.includes('?') ? '&' : '?'}embed=1`;
    } else if (requestOrigin && !isOriginAllowed(requestOrigin, allowedOrigins)) {
      embedDenied = 'origin_not_allowed';
    } else {
      const embedVisitor =
        c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
        c.req.header('cf-connecting-ip') ??
        'anon';
      if (
        !(await assertHourlyCap(
          redis,
          `play-session:${embedVisitor}`,
          HOURLY_CAPS.playSession,
        ))
      ) {
        return c.json(
          apiError(ErrorCode.RATE_LIMITED, 'too many play sessions this hour'),
          429,
        );
      }
      const issued = await issuePlaySession({
        db,
        env,
        deploymentId: dep.id,
        communityGameId: game.id,
        userId: null,
        userAgent: c.req.header('user-agent'),
        clientIp: embedVisitor,
        refererOrigin: requestOrigin,
        ttlSeconds: PLAY_SESSION_TTL_SECONDS,
      });
      if (issued) {
        iframeUrl = `${issued.url}${issued.url.includes('?') ? '&' : '?'}embed=1`;
      }
    }
    c.header('Cache-Control', 'no-store');
    return c.json({
      slug: game.slug,
      title: game.title,
      thumbnail: game.thumbnail,
      iframeUrl,
      embedUrl: iframeUrl,
      embedDenied,
      allowedOrigins,
      width: 800,
      height: 600,
      iframeSandbox: sandbox,
    });
  });

  app.get('/games/:slug/leaderboard', async (c) => {
    const slug = c.req.param('slug');
    const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') ?? '20')));
    const [game] = await db
      .select()
      .from(communityGames)
      .where(eq(communityGames.slug, slug))
      .limit(1);
    if (!game) return c.json({ error: 'not found' }, 404);

    const rows = await db
      .select({
        rank: sql<number>`ROW_NUMBER() OVER (ORDER BY ${gameLeaderboards.score} DESC, ${gameLeaderboards.achievedAt} ASC)`,
        playerName: gameLeaderboards.playerName,
        score: gameLeaderboards.score,
        achievedAt: gameLeaderboards.achievedAt,
      })
      .from(gameLeaderboards)
      .where(eq(gameLeaderboards.deploymentId, game.deploymentId))
      .orderBy(desc(gameLeaderboards.score))
      .limit(limit);

    return c.json({ slug, leaderboard: rows });
  });

  /** Anonymous third-party leaderboard submission. Requires API key + scope. */
  app.post('/games/:slug/leaderboard', requireScope(SCOPE_LEADERBOARD_WRITE), async (c) => {
    const slug = c.req.param('slug');
    const body = (await c.req.json().catch(() => ({}))) as {
      playerName?: string;
      score?: number;
      metadata?: Record<string, unknown>;
    };
    if (!body.playerName || typeof body.score !== 'number') {
      return c.json({ error: 'playerName + numeric score required' }, 400);
    }
    const [game] = await db
      .select()
      .from(communityGames)
      .where(eq(communityGames.slug, slug))
      .limit(1);
    if (!game) return c.json({ error: 'not found' }, 404);

    const [row] = await db
      .insert(gameLeaderboards)
      .values({
        deploymentId: game.deploymentId,
        playerName: body.playerName.slice(0, 40),
        score: body.score,
        metadata: body.metadata ?? {},
      })
      .returning();
    return c.json({ ok: true, id: row?.id });
  });

  // ----- Plugin marketplace read API ------------------------------------
  app.get('/plugins', async (c) => {
    const q = c.req.query('q')?.trim().toLowerCase();
    const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') ?? '50')));
    const rows = await cacheJson({
      redis,
      key: `public:plugins:${limit}`,
      ttlSeconds: 60,
      producer: () =>
        db
          .select({
            slug: pluginPackages.slug,
            name: pluginPackages.name,
            description: pluginPackages.description,
            latestVersion: pluginPackages.latestVersion,
            installCount: pluginPackages.installCount,
            tags: pluginPackages.tags,
          })
          .from(pluginPackages)
          .where(eq(pluginPackages.isPublic, true))
          .orderBy(desc(pluginPackages.installCount))
          .limit(limit),
    });
    void requireScope; void SCOPE_PLUGINS; // anonymous browse is fine
    c.header('Cache-Control', 'public, max-age=30, s-maxage=120');
    return c.json({
      plugins: q
        ? rows.filter((r) =>
            (r.name + ' ' + (r.description ?? '') + ' ' + r.slug)
              .toLowerCase()
              .includes(q),
          )
        : rows,
    });
  });

  app.get('/plugins/:slug', async (c) => {
    const slug = c.req.param('slug');
    const [pkg] = await db
      .select()
      .from(pluginPackages)
      .where(and(eq(pluginPackages.slug, slug), eq(pluginPackages.isPublic, true)))
      .limit(1);
    if (!pkg) return c.json({ error: 'not found' }, 404);

    const versions = await db
      .select({
        version: pluginVersions.version,
        publishedAt: pluginVersions.publishedAt,
        sha256: pluginVersions.sha256,
        runtimePeerRange: pluginVersions.runtimePeerRange,
        manifest: pluginVersions.manifest,
      })
      .from(pluginVersions)
      .where(eq(pluginVersions.pluginId, pkg.id))
      .orderBy(desc(pluginVersions.publishedAt))
      .limit(50);

    return c.json({
      slug: pkg.slug,
      name: pkg.name,
      description: pkg.description,
      latestVersion: pkg.latestVersion,
      tags: pkg.tags,
      installCount: pkg.installCount,
      versions,
    });
  });

  // ----- Public bench leaderboard ---------------------------------------
  app.get('/bench/leaderboard', async (c) => {
    void SCOPE_BENCH;
    const limit = Math.min(200, Math.max(1, Number(c.req.query('limit') ?? '50')));
    const data = await cacheJson({
      redis,
      key: `public:bench:${limit}`,
      ttlSeconds: 60,
      producer: async () => {
        const rows = await db
          .select({
            id: benchRuns.id,
            label: benchRuns.publicLabel,
            scores: benchRuns.scores,
            status: benchRuns.status,
            createdAt: benchRuns.createdAt,
            projectId: benchRuns.projectId,
          })
          .from(benchRuns)
          .where(and(eq(benchRuns.isPublic, true), eq(benchRuns.status, 'succeeded')))
          .orderBy(desc(benchRuns.createdAt))
          .limit(limit);
        return { runs: rows };
      },
    });
    c.header('Cache-Control', 'public, max-age=30, s-maxage=120');
    return c.json(data);
  });

  app.get('/bench/runs/:id', async (c) => {
    const id = c.req.param('id');
    const [row] = await db
      .select()
      .from(benchRuns)
      .where(and(eq(benchRuns.id, id), eq(benchRuns.isPublic, true)))
      .limit(1);
    if (!row) return c.json({ error: 'not found' }, 404);
    const [proj] = await db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(eq(projects.id, row.projectId))
      .limit(1);
    return c.json({
      id: row.id,
      label: row.publicLabel,
      status: row.status,
      scores: row.scores,
      project: proj ?? null,
      createdAt: row.createdAt,
    });
  });

  // Discovery: public ratings histogram for a game (powers stars on partner sites).
  app.get('/games/:slug/ratings', async (c) => {
    const slug = c.req.param('slug');
    const [game] = await db
      .select()
      .from(communityGames)
      .where(eq(communityGames.slug, slug))
      .limit(1);
    if (!game) return c.json({ error: 'not found' }, 404);
    const rows = await db
      .select({
        rating: gameRatings.rating,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(gameRatings)
      .where(eq(gameRatings.deploymentId, game.deploymentId))
      .groupBy(gameRatings.rating);
    return c.json({ slug, histogram: rows });
  });

  // Diagnostics endpoint: lets partners check what their key can do.
  app.get('/whoami', (c) => {
    const key = c.get('apiKey');
    if (!key) {
      return c.json({ anonymous: true });
    }
    return c.json({
      organizationId: key.organizationId,
      scopes: key.scopes,
      keyPrefix: key.keyPrefix,
      rateLimitPerMinute: key.rateLimitPerMinute,
    });
  });

  void SCOPE_EMBED; // reserved for future, gating render-time payloads

  return app;
}
