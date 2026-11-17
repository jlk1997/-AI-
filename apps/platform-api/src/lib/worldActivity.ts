/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * "Tonight in town" — the community's reason to come back without generating.
 *
 * A published world is only interesting if something actually happened. This
 * module turns recent society events into a short public feed: one readable
 * line per beat, no embeddings, no census recitals.
 */

import { and, desc, eq, inArray } from 'drizzle-orm';
import type { DrizzleDb } from '@opengame/platform-db';
import {
  communityGames,
  deployments,
  projects,
  societyEvents,
  worlds,
} from '@opengame/platform-db';

export type WorldHeadlineKind = 'talk' | 'whisper' | 'rumor';

export interface WorldHeadline {
  readonly kind: WorldHeadlineKind;
  readonly line: string;
  readonly speakerName?: string;
  readonly simTime: number;
}

export interface WorldActivityItem extends WorldHeadline {
  readonly gameId: string;
  readonly slug: string;
  readonly title: string;
  readonly at: string;
  readonly deploymentId: string;
}

export interface RemixParent {
  readonly slug: string;
  readonly title: string;
  readonly category: string;
}

const MAX_FEED = 16;
const MAX_PER_TOWN = 2;
const SCAN_ROWS = 80;

function clipLine(raw: string): string {
  const line = raw.replace(/\s+/g, ' ').trim();
  if (line.length <= 160) return line;
  return `${line.slice(0, 157)}…`;
}

/** Skip empty, census, and degraded beats so the feed is worth reading. */
export function isUsableHeadline(text: string): boolean {
  const line = text.replace(/\s+/g, ' ').trim();
  if (line.length < 4) return false;
  if (/^(位于|在.{0,8}(工作|闲逛|路过)|census|occupancy)/i.test(line)) return false;
  return true;
}

/**
 * Pull one sentence a visitor can read off a society event payload.
 * Dialogue prefers the first spoken turn; a town-wide intervene is a whisper.
 */
export function headlineFromPayload(
  kind: string,
  payload: Record<string, unknown> | null | undefined,
  simTime: number,
): WorldHeadline | null {
  if (!payload || payload['degraded'] === true) return null;
  const rumor = payload['kind'] === 'rumor' || payload['town'] === true;

  if (kind === 'intervene') {
    const text =
      (typeof payload['text'] === 'string' && payload['text']) ||
      (typeof payload['summary'] === 'string' && payload['summary']) ||
      '';
    if (!isUsableHeadline(text)) return null;
    return { kind: 'whisper', line: clipLine(text), simTime };
  }

  if (kind !== 'dialogue') return null;

  const turns = Array.isArray(payload['turns'])
    ? (payload['turns'] as Array<Record<string, unknown>>)
    : [];
  for (const turn of turns) {
    if (typeof turn['text'] !== 'string' || !isUsableHeadline(turn['text'])) continue;
    const speaker =
      typeof turn['speakerName'] === 'string' ? turn['speakerName'].trim() : '';
    return {
      kind: rumor ? 'rumor' : 'talk',
      line: clipLine(turn['text']),
      ...(speaker ? { speakerName: speaker.slice(0, 40) } : {}),
      simTime,
    };
  }

  // Tonight feed is spoken turns only — no stock "passed by" summaries.
  return null;
}

/** Keep the feed mixed: at most two beats from the same town. */
export function pickActivityFeed(
  items: readonly WorldActivityItem[],
  limit = MAX_FEED,
): WorldActivityItem[] {
  const out: WorldActivityItem[] = [];
  const perTown = new Map<string, number>();
  for (const item of items) {
    const n = perTown.get(item.slug) ?? 0;
    if (n >= MAX_PER_TOWN) continue;
    perTown.set(item.slug, n + 1);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Recent readable beats from published, public worlds. Pass `deploymentIds` to
 * narrow it to the towns one reader follows — same query, personal feed.
 */
export async function listWorldActivity(
  db: DrizzleDb,
  options?: {
    readonly limit?: number;
    readonly deploymentIds?: readonly string[];
  },
): Promise<WorldActivityItem[]> {
  const limit = Math.max(1, Math.min(MAX_FEED, options?.limit ?? MAX_FEED));
  const scope = options?.deploymentIds;
  // An explicit empty scope means "nothing followed yet", not "everything".
  if (scope && scope.length === 0) return [];
  const rows = await db
    .select({
      gameId: communityGames.id,
      slug: communityGames.slug,
      title: communityGames.title,
      deploymentId: communityGames.deploymentId,
      kind: societyEvents.kind,
      simTime: societyEvents.simTime,
      payload: societyEvents.payloadJson,
      createdAt: societyEvents.createdAt,
      eventKey: societyEvents.eventKey,
    })
    .from(societyEvents)
    .innerJoin(worlds, eq(societyEvents.worldId, worlds.id))
    .innerJoin(deployments, eq(deployments.projectId, worlds.projectId))
    .innerJoin(communityGames, eq(communityGames.deploymentId, deployments.id))
    .where(
      and(
        eq(communityGames.isPublic, true),
        eq(communityGames.category, 'world'),
        eq(societyEvents.invalidated, 0),
        inArray(societyEvents.kind, ['dialogue', 'intervene']),
        ...(scope ? [inArray(communityGames.deploymentId, [...scope])] : []),
      ),
    )
    .orderBy(desc(societyEvents.createdAt))
    .limit(SCAN_ROWS);

  const seen = new Set<string>();
  const items: WorldActivityItem[] = [];
  for (const row of rows) {
    const key = `${row.gameId}:${row.eventKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const headline = headlineFromPayload(
      row.kind,
      (row.payload ?? {}) as Record<string, unknown>,
      Number(row.simTime),
    );
    if (!headline) continue;
    items.push({
      ...headline,
      gameId: row.gameId,
      slug: row.slug,
      title: row.title,
      at: row.createdAt.toISOString(),
      deploymentId: row.deploymentId,
    });
  }
  return pickActivityFeed(items, limit);
}

/** The latest readable beat on one published town, or null if it has been quiet. */
export async function latestHeadlineForDeployment(
  db: DrizzleDb,
  deploymentId: string,
): Promise<WorldHeadline | null> {
  const [dep] = await db
    .select({ projectId: deployments.projectId })
    .from(deployments)
    .where(eq(deployments.id, deploymentId))
    .limit(1);
  if (!dep) return null;
  const [world] = await db
    .select({ id: worlds.id })
    .from(worlds)
    .where(eq(worlds.projectId, dep.projectId))
    .limit(1);
  if (!world) return null;
  const rows = await db
    .select({
      kind: societyEvents.kind,
      simTime: societyEvents.simTime,
      payload: societyEvents.payloadJson,
    })
    .from(societyEvents)
    .where(
      and(
        eq(societyEvents.worldId, world.id),
        eq(societyEvents.invalidated, 0),
        inArray(societyEvents.kind, ['dialogue', 'intervene']),
      ),
    )
    .orderBy(desc(societyEvents.simTime))
    .limit(24);
  for (const row of rows) {
    const hit = headlineFromPayload(
      row.kind,
      (row.payload ?? {}) as Record<string, unknown>,
      Number(row.simTime),
    );
    if (hit) return hit;
  }
  return null;
}

/**
 * The published work this one was forked from, if that parent is still public.
 * Remix lineage is how the dual loop stays visible after publish.
 */
export async function remixParentByDeployment(
  db: DrizzleDb,
  deploymentId: string,
): Promise<RemixParent | null> {
  const [dep] = await db
    .select({ projectId: deployments.projectId })
    .from(deployments)
    .where(eq(deployments.id, deploymentId))
    .limit(1);
  if (!dep) return null;
  const [proj] = await db
    .select({ parentProjectId: projects.parentProjectId })
    .from(projects)
    .where(eq(projects.id, dep.projectId))
    .limit(1);
  if (!proj?.parentProjectId) return null;
  const parentDeps = await db
    .select({ id: deployments.id })
    .from(deployments)
    .where(eq(deployments.projectId, proj.parentProjectId));
  if (parentDeps.length === 0) return null;
  const [parent] = await db
    .select({
      slug: communityGames.slug,
      title: communityGames.title,
      category: communityGames.category,
    })
    .from(communityGames)
    .where(
      and(
        eq(communityGames.isPublic, true),
        inArray(
          communityGames.deploymentId,
          parentDeps.map((d) => d.id),
        ),
      ),
    )
    .orderBy(desc(communityGames.publishedAt))
    .limit(1);
  return parent ?? null;
}
