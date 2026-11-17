/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Public identity + "my works" reads. A published game should show an author
 * with a name, and the author should be able to find their own things again
 * without digging through sessionStorage. Organizations stay the quota ledger
 * underneath and are never surfaced to players.
 */

import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { townPresenceBadge } from '@opengame/platform-shared';
import type { DrizzleDb } from '@opengame/platform-db';
import { loadTownLampsByGames, type TownLamp } from './societyPatrons.js';
import {
  countSocietyWatchersMany,
  type SocietyWatchersRedis,
} from './societyWatchers.js';
import {
  communityGames,
  deployments,
  organizationMembers,
  organizations,
  projectRemixes,
  projects,
  societyEvents,
  subscriptions,
  userPlayHistory,
  users,
  worldAgents,
  worlds,
} from '@opengame/platform-db';

/** 3–20 chars, lowercase letters / digits / underscore. Stable in URLs. */
const HANDLE_RE = /^[a-z0-9_]{3,20}$/;

export function normalizeHandle(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidHandle(raw: string): boolean {
  return HANDLE_RE.test(normalizeHandle(raw));
}

export interface PublicAuthor {
  readonly handle: string | null;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly bio: string | null;
}

/** Never leak the email: fall back to the local part, then to a short id. */
export function publicAuthorOf(row: {
  id: string;
  /** Null for WeChat accounts, which never give us one. */
  email: string | null;
  handle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
}): PublicAuthor {
  const fromEmail = row.email?.split('@')[0] ?? '';
  return {
    handle: row.handle,
    displayName:
      row.displayName?.trim() ||
      row.handle ||
      (fromEmail.length >= 2 ? fromEmail : `player-${row.id.slice(0, 6)}`),
    avatarUrl: row.avatarUrl,
    bio: row.bio,
  };
}

/**
 * Community curation is an env allowlist, not a role column: release one has no
 * operations console, and inventing a permission model for one boolean would
 * cost more than it protects.
 */
export function isPlatformAdmin(
  env: { readonly adminEmails: readonly string[] },
  identity:
    | string
    | null
    | undefined
    | { readonly email?: string | null; readonly phone?: string | null },
): boolean {
  if (env.adminEmails.length === 0) return false;
  const candidates: string[] = [];
  if (typeof identity === 'string') {
    if (identity.trim()) candidates.push(identity.trim().toLowerCase());
  } else if (identity) {
    if (identity.email?.trim()) candidates.push(identity.email.trim().toLowerCase());
    if (identity.phone?.trim()) candidates.push(identity.phone.trim());
  }
  return candidates.some((value) => env.adminEmails.includes(value));
}

/** Organization membership ranks. `admin` is unused in seed data today; treat it as owner-adjacent. */
export type OrgRole = 'owner' | 'admin' | 'editor' | 'member';

const ORG_ROLE_RANK: Record<string, number> = {
  owner: 40,
  admin: 30,
  editor: 20,
  member: 10,
};

export function orgRoleAtLeast(
  role: string | null | undefined,
  min: OrgRole,
): boolean {
  const have = ORG_ROLE_RANK[role ?? ''] ?? 0;
  const need = ORG_ROLE_RANK[min] ?? Number.POSITIVE_INFINITY;
  return have >= need;
}

/** Turns `ada.lovelace+games@x.com` into `ada_lovelace`, or null if nothing usable. */
export function handleCandidateFromEmail(email: string): string | null {
  // A `+tag` is routing, not part of anyone's name.
  const local = (email.split('@')[0] ?? '').split('+')[0] ?? '';
  const cleaned = normalizeHandle(local)
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 20);
  return isValidHandle(cleaned) ? cleaned : null;
}

export interface SessionIdentity {
  readonly userId: string;
  readonly organizationId: string;
  /** True on first sign-in, so callers can say hello differently. */
  readonly created: boolean;
}

/**
 * Every sign-in path (dev token, magic link) lands here so a player always
 * gets the same thing: a user row, a personal org to bill jobs against, a free
 * subscription, and a handle their public page can live at.
 */
export class AccountClosedError extends Error {
  constructor() {
    super('This account has been closed');
    this.name = 'AccountClosedError';
  }
}

function assertAccountOpen(row: { deletedAt: Date | null } | undefined): void {
  if (row?.deletedAt) throw new AccountClosedError();
}

export async function ensureUserWithPersonalOrg(
  db: DrizzleDb,
  rawEmail: string,
): Promise<SessionIdentity> {
  const email = rawEmail.trim();
  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  assertAccountOpen(existing);
  let userId: string;
  let created = false;
  if (existing) {
    userId = existing.id;
    if (!existing.handle) {
      await claimHandleFromEmail(db, userId, email);
    }
  } else {
    const [row] = await db.insert(users).values({ email }).returning();
    if (!row) throw new Error('failed to create user');
    userId = row.id;
    created = true;
    await claimHandleFromEmail(db, userId, email);
  }

  const [membership] = await db
    .select({ organizationId: organizationMembers.organizationId })
    .from(organizationMembers)
    .where(eq(organizationMembers.userId, userId))
    .limit(1);
  if (membership) {
    return { userId, organizationId: membership.organizationId, created };
  }

  const [org] = await db
    .insert(organizations)
    .values({ name: `Personal (${email})` })
    .returning();
  if (!org) throw new Error('failed to create org');
  await db
    .insert(organizationMembers)
    .values({ organizationId: org.id, userId, role: 'owner' });
  await db.insert(subscriptions).values({
    organizationId: org.id,
    plan: 'free',
    status: 'active',
  });
  return { userId, organizationId: org.id, created };
}

/** Best-effort: a taken handle is not a reason to fail a sign-in. */
async function claimHandleFromEmail(
  db: DrizzleDb,
  userId: string,
  email: string,
): Promise<void> {
  const base = handleCandidateFromEmail(email);
  if (!base) return;
  const candidates = [base];
  for (let i = 0; i < 3; i += 1) {
    const suffix = Math.random().toString(36).slice(2, 6);
    candidates.push(`${base.slice(0, 20 - suffix.length - 1)}_${suffix}`);
  }
  for (const candidate of candidates) {
    if (!isValidHandle(candidate)) continue;
    try {
      const [taken] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.handle, candidate))
        .limit(1);
      if (taken) continue;
      await db.update(users).set({ handle: candidate }).where(eq(users.id, userId));
      return;
    } catch {
      // Unique-violation race: try the next candidate, then give up silently.
    }
  }
}

/**
 * Sign-in for an account that arrived from WeChat.
 *
 * A WeChat user has no email, so openid (or unionid, when the account is on an
 * Open Platform) is the identity. Everything downstream — personal org, free
 * subscription, wallet, handle — is the same as any other sign-in, because the
 * rest of the product must not care how someone got in.
 */
export async function ensureUserWithWeChat(
  db: DrizzleDb,
  profile: {
    readonly openid: string;
    readonly unionid?: string | null;
    readonly nickname?: string | null;
    readonly avatarUrl?: string | null;
  },
): Promise<SessionIdentity> {
  const byUnion = profile.unionid
    ? await db
        .select()
        .from(users)
        .where(eq(users.wechatUnionid, profile.unionid))
        .limit(1)
    : [];
  const [existing] =
    byUnion.length > 0
      ? byUnion
      : await db
          .select()
          .from(users)
          .where(eq(users.wechatOpenid, profile.openid))
          .limit(1);
  assertAccountOpen(existing);

  let userId: string;
  let created = false;
  if (existing) {
    userId = existing.id;
    // Backfill: an account created before we asked for userinfo has no name,
    // and one created before unionid was available has no unionid.
    const patch: Record<string, unknown> = {};
    if (!existing.wechatOpenid) patch['wechatOpenid'] = profile.openid;
    if (profile.unionid && !existing.wechatUnionid) {
      patch['wechatUnionid'] = profile.unionid;
    }
    if (profile.nickname && !existing.displayName) {
      patch['displayName'] = profile.nickname;
    }
    if (profile.avatarUrl && !existing.avatarUrl) {
      patch['avatarUrl'] = profile.avatarUrl;
    }
    if (Object.keys(patch).length > 0) {
      await db.update(users).set(patch).where(eq(users.id, userId));
    }
  } else {
    const [row] = await db
      .insert(users)
      .values({
        wechatOpenid: profile.openid,
        wechatUnionid: profile.unionid ?? null,
        displayName: profile.nickname ?? null,
        avatarUrl: profile.avatarUrl ?? null,
      })
      .returning();
    if (!row) throw new Error('failed to create user');
    userId = row.id;
    created = true;
  }

  if (!existing?.handle) {
    await claimHandleFromSeed(db, userId, `wx_${profile.openid.slice(-8)}`);
  }
  return ensurePersonalOrgFor(db, userId, `WeChat ${profile.openid.slice(-6)}`, created);
}

const CN_PHONE_RE = /^1[3-9]\d{9}$/;

export function normalizePhone(raw: string): string {
  return raw.replace(/\s|-/g, '').replace(/^\+86/, '');
}

export function isValidCnPhone(raw: string): boolean {
  return CN_PHONE_RE.test(normalizePhone(raw));
}

export async function ensureUserWithPhone(
  db: DrizzleDb,
  phone: string,
): Promise<SessionIdentity> {
  const normalized = normalizePhone(phone);
  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.phone, normalized))
    .limit(1);
  assertAccountOpen(existing);
  let userId: string;
  let created = false;
  if (existing) {
    userId = existing.id;
  } else {
    const [row] = await db
      .insert(users)
      .values({ phone: normalized, displayName: `玩家${normalized.slice(-4)}` })
      .returning();
    if (!row) throw new Error('failed to create user');
    userId = row.id;
    created = true;
  }
  if (!existing?.handle) {
    await claimHandleFromSeed(db, userId, `ph_${normalized.slice(-8)}`);
  }
  return ensurePersonalOrgFor(db, userId, `Phone ${normalized.slice(-4)}`, created);
}

/** Shared tail of every sign-in: a personal org with a free subscription. */
async function ensurePersonalOrgFor(
  db: DrizzleDb,
  userId: string,
  orgLabel: string,
  created: boolean,
): Promise<SessionIdentity> {
  const [membership] = await db
    .select({ organizationId: organizationMembers.organizationId })
    .from(organizationMembers)
    .where(eq(organizationMembers.userId, userId))
    .limit(1);
  if (membership) {
    return { userId, organizationId: membership.organizationId, created };
  }
  const [org] = await db
    .insert(organizations)
    .values({ name: `Personal (${orgLabel})` })
    .returning();
  if (!org) throw new Error('failed to create org');
  await db
    .insert(organizationMembers)
    .values({ organizationId: org.id, userId, role: 'owner' });
  await db.insert(subscriptions).values({
    organizationId: org.id,
    plan: 'free',
    status: 'active',
    provider: 'none',
  });
  return { userId, organizationId: org.id, created };
}

/** Best-effort handle claim from an arbitrary seed (WeChat has no email). */
async function claimHandleFromSeed(
  db: DrizzleDb,
  userId: string,
  seed: string,
): Promise<void> {
  const base = normalizeHandle(seed)
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 20);
  if (!isValidHandle(base)) return;
  const candidates = [base];
  for (let i = 0; i < 3; i += 1) {
    const suffix = Math.random().toString(36).slice(2, 6);
    candidates.push(`${base.slice(0, 20 - suffix.length - 1)}_${suffix}`);
  }
  for (const candidate of candidates) {
    if (!isValidHandle(candidate)) continue;
    try {
      const [taken] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.handle, candidate))
        .limit(1);
      if (taken) continue;
      await db.update(users).set({ handle: candidate }).where(eq(users.id, userId));
      return;
    } catch {
      // Unique-violation race: try the next candidate, then give up silently.
    }
  }
}

export async function listUserOrgIds(db: DrizzleDb, userId: string): Promise<string[]> {
  const rows = await db
    .select({ organizationId: organizationMembers.organizationId })
    .from(organizationMembers)
    .where(eq(organizationMembers.userId, userId));
  return rows.map((r) => r.organizationId);
}

export interface WorldStatus {
  /** Sim hours reached by the society clock (null when it never ran). */
  readonly simTime: number | null;
  readonly simDays: number | null;
  readonly residents: number;
  /** Author froze the shared clock. Guests may stay; nothing walks. */
  readonly clockPaused: boolean;
  /** Someone is on the page — the town is walking. */
  readonly living: boolean;
  /** Present and allowed to spend MiniMax (author watch or paid 镇时). */
  readonly speaking: boolean;
  readonly lastAdvancedAt: string | null;
  /** Tabs currently in the Redis watcher set. Zero when Redis was not passed. */
  readonly watcherCount: number;
  readonly lamp: TownLamp | null;
}

/**
 * How far a published town has lived. Keyed by deployment so community lists
 * can decorate world cards in one round-trip instead of one query per card.
 */
export async function worldStatusByDeployment(
  db: DrizzleDb,
  deploymentIds: readonly string[],
  redis?: SocietyWatchersRedis | null,
): Promise<Map<string, WorldStatus>> {
  const out = new Map<string, WorldStatus>();
  if (deploymentIds.length === 0) return out;
  const depRows = await db
    .select({ id: deployments.id, projectId: deployments.projectId })
    .from(deployments)
    .where(inArray(deployments.id, [...deploymentIds]));
  if (depRows.length === 0) return out;
  const worldRows = await db
    .select({
      id: worlds.id,
      projectId: worlds.projectId,
      heartbeatEnabled: worlds.heartbeatEnabled,
      heartbeatUntil: worlds.heartbeatUntil,
      townTimeUntil: worlds.townTimeUntil,
      lightUntil: worlds.lightUntil,
      authorWatchUntil: worlds.authorWatchUntil,
      lastHeartbeatAt: worlds.lastHeartbeatAt,
      clockPaused: worlds.clockPaused,
      updatedAt: worlds.updatedAt,
    })
    .from(worlds)
    .where(
      inArray(
        worlds.projectId,
        depRows.map((d) => d.projectId),
      ),
    );
  if (worldRows.length === 0) return out;
  const worldIds = worldRows.map((w) => w.id);
  const clockRows = await db
    .select({
      worldId: societyEvents.worldId,
      simTime: sql<string | null>`MAX(${societyEvents.simTime})`,
    })
    .from(societyEvents)
    .where(inArray(societyEvents.worldId, worldIds))
    .groupBy(societyEvents.worldId);
  const residentRows = await db
    .select({
      worldId: worldAgents.worldId,
      residents: sql<number>`COUNT(*)`,
    })
    .from(worldAgents)
    .where(inArray(worldAgents.worldId, worldIds))
    .groupBy(worldAgents.worldId);
  const clockByWorld = new Map(clockRows.map((r) => [r.worldId, Number(r.simTime ?? 0)]));
  const residentsByWorld = new Map(
    residentRows.map((r) => [r.worldId, Number(r.residents ?? 0)]),
  );
  const worldByProject = new Map(worldRows.map((w) => [w.projectId, w]));
  const gameRows = await db
    .select({
      id: communityGames.id,
      deploymentId: communityGames.deploymentId,
    })
    .from(communityGames)
    .where(inArray(communityGames.deploymentId, depRows.map((d) => d.id)));
  const gameByDeployment = new Map(gameRows.map((g) => [g.deploymentId, g.id]));
  const lampInputs = gameRows.flatMap((g) => {
    const dep = depRows.find((d) => d.id === g.deploymentId);
    const world = dep ? worldByProject.get(dep.projectId) : undefined;
    if (!world) return [];
    return [{ gameId: g.id, townTimeUntil: world.townTimeUntil }];
  });
  const [lamps, watcherCounts] = await Promise.all([
    loadTownLampsByGames(db, lampInputs),
    redis
      ? countSocietyWatchersMany(redis, worldIds).catch(() => new Map<string, number>())
      : Promise.resolve(new Map<string, number>()),
  ]);
  const now = Date.now();
  for (const dep of depRows) {
    const world = worldByProject.get(dep.projectId);
    if (!world) continue;
    const simTime = clockByWorld.get(world.id) ?? null;
    const badge = townPresenceBadge({
      presenceUntil: world.heartbeatUntil,
      authorWatchUntil: world.authorWatchUntil,
      townTimeUntil: world.townTimeUntil,
      litUntil: world.lightUntil,
      now,
    });
    const gameId = gameByDeployment.get(dep.id);
    out.set(dep.id, {
      simTime,
      simDays: simTime == null ? null : Math.max(1, Math.floor(simTime / 24) + 1),
      residents: residentsByWorld.get(world.id) ?? 0,
      clockPaused: Boolean(world.clockPaused),
      living: world.clockPaused ? false : badge.living,
      speaking: world.clockPaused ? false : badge.speaking,
      lastAdvancedAt: (world.lastHeartbeatAt ?? world.updatedAt)?.toISOString() ?? null,
      watcherCount: watcherCounts.get(world.id) ?? 0,
      lamp: gameId ? lamps.get(gameId) ?? null : null,
    });
  }
  return out;
}

export interface WorkRow {
  readonly id: string;
  readonly takenDownAt: string | null;
  readonly slug: string;
  readonly title: string;
  readonly description: string | null;
  readonly category: string;
  readonly isPublic: boolean;
  readonly playCount: number;
  readonly publishedAt: string;
  readonly deploymentId: string;
  readonly projectId: string;
  readonly world?: WorldStatus;
}

export interface MyWorks {
  readonly games: WorkRow[];
  readonly worlds: WorkRow[];
  readonly drafts: Array<{
    readonly projectId: string;
    readonly name: string;
    readonly createdAt: string;
    readonly hasWorld: boolean;
    readonly hasPreview: boolean;
  }>;
  readonly remixes: Array<{
    readonly projectId: string;
    readonly name: string;
    readonly parentProjectId: string;
    readonly note: string | null;
    readonly createdAt: string;
  }>;
}

/** Published games / published worlds / unpublished projects / my remixes. */
export async function listMyWorks(db: DrizzleDb, userId: string): Promise<MyWorks> {
  const orgIds = await listUserOrgIds(db, userId);
  if (orgIds.length === 0) {
    return { games: [], worlds: [], drafts: [], remixes: [] };
  }
  const myProjects = await db
    .select({
      id: projects.id,
      name: projects.name,
      createdAt: projects.createdAt,
      parentProjectId: projects.parentProjectId,
    })
    .from(projects)
    .where(inArray(projects.organizationId, orgIds))
    .orderBy(desc(projects.createdAt));
  if (myProjects.length === 0) {
    return { games: [], worlds: [], drafts: [], remixes: [] };
  }
  const projectIds = myProjects.map((p) => p.id);
  const myDeployments = await db
    .select({ id: deployments.id, projectId: deployments.projectId })
    .from(deployments)
    .where(inArray(deployments.projectId, projectIds));
  const worldProjectIds = new Set(
    (
      await db
        .select({ projectId: worlds.projectId })
        .from(worlds)
        .where(inArray(worlds.projectId, projectIds))
    ).map((w) => w.projectId),
  );
  const published =
    myDeployments.length > 0
      ? await db
          .select()
          .from(communityGames)
          .where(
            inArray(
              communityGames.deploymentId,
              myDeployments.map((d) => d.id),
            ),
          )
          .orderBy(desc(communityGames.publishedAt))
      : [];
  const projectByDeployment = new Map(myDeployments.map((d) => [d.id, d.projectId]));
  const worldStatus = await worldStatusByDeployment(
    db,
    published.filter((g) => g.category === 'world').map((g) => g.deploymentId),
  );
  const toWork = (row: (typeof published)[number]): WorkRow => {
    const status = worldStatus.get(row.deploymentId);
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      description: row.description,
      category: row.category,
      isPublic: row.isPublic,
      takenDownAt: row.takenDownAt?.toISOString() ?? null,
      playCount: row.playCount,
      publishedAt: row.publishedAt.toISOString(),
      deploymentId: row.deploymentId,
      projectId: projectByDeployment.get(row.deploymentId) ?? '',
      ...(status ? { world: status } : {}),
    };
  };
  const publishedProjectIds = new Set(
    published.map((g) => projectByDeployment.get(g.deploymentId)).filter(Boolean) as string[],
  );
  const deployedProjectIds = new Set(myDeployments.map((d) => d.projectId));
  const remixRows = await db
    .select()
    .from(projectRemixes)
    .where(eq(projectRemixes.forkedByUserId, userId))
    .orderBy(desc(projectRemixes.createdAt))
    .limit(50);
  const nameByProject = new Map(myProjects.map((p) => [p.id, p.name]));
  return {
    games: published.filter((g) => g.category !== 'world').map(toWork),
    worlds: published.filter((g) => g.category === 'world').map(toWork),
    drafts: myProjects
      .filter((p) => !publishedProjectIds.has(p.id))
      .slice(0, 30)
      .map((p) => ({
        projectId: p.id,
        name: p.name,
        createdAt: p.createdAt.toISOString(),
        hasWorld: worldProjectIds.has(p.id),
        hasPreview: deployedProjectIds.has(p.id),
      })),
    remixes: remixRows.map((r) => ({
      projectId: r.childProjectId,
      name: nameByProject.get(r.childProjectId) ?? r.childProjectId.slice(0, 8),
      parentProjectId: r.parentProjectId,
      note: r.note,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}

/** Public works of an author, resolved by handle. Returns null when unknown. */
export async function publicProfileByHandle(
  db: DrizzleDb,
  handleRaw: string,
): Promise<{
  /** Needed by callers that resolve follow state; never rendered. */
  userId: string;
  author: PublicAuthor;
  joinedAt: string;
  works: WorkRow[];
} | null> {
  const handle = normalizeHandle(handleRaw);
  if (!isValidHandle(handle)) return null;
  const [row] = await db
    .select()
    .from(users)
    .where(and(eq(users.handle, handle), isNull(users.deletedAt)))
    .limit(1);
  if (!row) return null;
  const works = await listMyWorks(db, row.id);
  return {
    userId: row.id,
    author: publicAuthorOf(row),
    joinedAt: row.createdAt.toISOString(),
    works: [...works.games, ...works.worlds].filter((w) => w.isPublic),
  };
}

/**
 * Who to credit for a published work. Projects belong to an organization, and
 * for personal orgs (the default) the owner member is the author.
 */
export async function authorForDeployment(
  db: DrizzleDb,
  deploymentId: string,
): Promise<PublicAuthor | null> {
  const [dep] = await db
    .select({ projectId: deployments.projectId })
    .from(deployments)
    .where(eq(deployments.id, deploymentId))
    .limit(1);
  if (!dep) return null;
  const [proj] = await db
    .select({ organizationId: projects.organizationId })
    .from(projects)
    .where(eq(projects.id, dep.projectId))
    .limit(1);
  if (!proj) return null;
  const members = await db
    .select({
      id: users.id,
      email: users.email,
      handle: users.handle,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      bio: users.bio,
      role: organizationMembers.role,
    })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(eq(organizationMembers.organizationId, proj.organizationId))
    .limit(20);
  const author = members.find((m) => m.role === 'owner') ?? members[0];
  return author ? publicAuthorOf(author) : null;
}

/**
 * Whether this user belongs to the organization that owns a deployment — the
 * question behind "may I change the licence on this work".
 */
export async function isDeploymentMember(
  db: DrizzleDb,
  deploymentId: string,
  userId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: organizationMembers.userId })
    .from(deployments)
    .innerJoin(projects, eq(projects.id, deployments.projectId))
    .innerJoin(
      organizationMembers,
      and(
        eq(organizationMembers.organizationId, projects.organizationId),
        eq(organizationMembers.userId, userId),
      ),
    )
    .where(eq(deployments.id, deploymentId))
    .limit(1);
  return Boolean(row);
}

/** Upsert "I opened this" so the profile can show a real play history. */
export async function recordPlay(
  db: DrizzleDb,
  userId: string,
  deploymentId: string,
): Promise<void> {
  await db
    .insert(userPlayHistory)
    .values({ userId, deploymentId })
    .onConflictDoUpdate({
      target: [userPlayHistory.userId, userPlayHistory.deploymentId],
      set: {
        playCount: sql`${userPlayHistory.playCount} + 1`,
        lastPlayedAt: new Date(),
      },
    });
}

export interface PlayHistoryRow {
  readonly slug: string | null;
  readonly title: string | null;
  readonly category: string | null;
  readonly deploymentId: string;
  readonly playCount: number;
  readonly lastPlayedAt: string;
}

export async function listPlayHistory(
  db: DrizzleDb,
  userId: string,
  limit = 20,
): Promise<PlayHistoryRow[]> {
  const rows = await db
    .select({
      deploymentId: userPlayHistory.deploymentId,
      playCount: userPlayHistory.playCount,
      lastPlayedAt: userPlayHistory.lastPlayedAt,
      slug: communityGames.slug,
      title: communityGames.title,
      category: communityGames.category,
    })
    .from(userPlayHistory)
    .leftJoin(communityGames, eq(communityGames.deploymentId, userPlayHistory.deploymentId))
    .where(eq(userPlayHistory.userId, userId))
    .orderBy(desc(userPlayHistory.lastPlayedAt))
    .limit(limit);
  return rows.map((r) => ({
    slug: r.slug,
    title: r.title,
    category: r.category,
    deploymentId: r.deploymentId,
    playCount: r.playCount,
    lastPlayedAt: r.lastPlayedAt.toISOString(),
  }));
}
