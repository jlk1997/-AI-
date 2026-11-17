/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { and, count, desc, eq, gte, inArray, sql } from 'drizzle-orm';

import type { DrizzleDb } from '@opengame/platform-db';
import { jobs, ledgerEntries, projectRemixes, projects, subscriptions } from '@opengame/platform-db';

export type InsertedJob = typeof jobs.$inferSelect;

import type { PlatformEnv } from '../env.js';
import {
  creditPoints,
  debitPoints,
  ensureWallet,
  jobPointCost,
  refreshPlanGrant,
} from './wallet.js';

export type QuotaResult =
  | { readonly ok: true; readonly plan: string; readonly cost: number }
  | {
      readonly ok: false;
      readonly reason: string;
      readonly plan: string;
      /** Present when the block was about points rather than rate limits. */
      readonly needPoints?: number;
      readonly balance?: number;
    };

interface ResolvedQuota {
  readonly plan: string;
  readonly dailyJobLimit: number;
  readonly maxConcurrent: number;
}

/**
 * Reads the org's active subscription and derives effective per-day /
 * concurrent limits. Falls back to env defaults when no subscription row
 * exists (free tier).
 */
export async function resolveOrgQuota(
  db: DrizzleDb,
  env: PlatformEnv,
  organizationId: string,
): Promise<ResolvedQuota> {
  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.organizationId, organizationId))
    .limit(1);
  const plan = (sub?.status === 'active' && sub.plan) || 'free';
  const dailyDefault = env.planDailyJobLimits[plan] ?? env.dailyJobLimitPerOrg;
  const concurrentDefault =
    env.planMaxConcurrentJobs[plan] ?? env.maxConcurrentJobsPerOrg;
  return {
    plan,
    dailyJobLimit: sub?.dailyJobLimitOverride ?? dailyDefault,
    maxConcurrent: sub?.maxConcurrentJobsOverride ?? concurrentDefault,
  };
}

/**
 * Rate limits and credit are separate questions and both must pass: an empty
 * wallet cannot queue at all, and a full one still cannot exceed the plan's
 * concurrency. `jobType` decides the price; omitting it checks limits only,
 * which is what the free operations (cancel, retry bookkeeping) want.
 */
export async function assertCanEnqueueJob(
  db: DrizzleDb,
  env: PlatformEnv,
  organizationId: string,
  jobType?: string,
): Promise<QuotaResult> {
  const quota = await resolveOrgQuota(db, env, organizationId);
  const [concurrentRow] = await db
    .select({ value: count() })
    .from(jobs)
    .innerJoin(projects, eq(projects.id, jobs.projectId))
    .where(
      and(
        eq(projects.organizationId, organizationId),
        inArray(jobs.status, ['queued', 'running']),
      ),
    );
  const concurrent = Number(concurrentRow?.value ?? 0);
  const concurrentReason = jobQuotaBlockReason(concurrent, 0, {
    plan: quota.plan,
    maxConcurrent: quota.maxConcurrent,
    dailyJobLimit: Number.POSITIVE_INFINITY,
  });
  if (concurrentReason) {
    return { ok: false, plan: quota.plan, reason: concurrentReason };
  }

  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const [dailyRow] = await db
    .select({ value: count() })
    .from(jobs)
    .innerJoin(projects, eq(projects.id, jobs.projectId))
    .where(
      and(
        eq(projects.organizationId, organizationId),
        gte(jobs.createdAt, start),
      ),
    );
  const daily = Number(dailyRow?.value ?? 0);
  const dailyReason = jobQuotaBlockReason(0, daily, {
    plan: quota.plan,
    maxConcurrent: Number.POSITIVE_INFINITY,
    dailyJobLimit: quota.dailyJobLimit,
  });
  if (dailyReason) {
    return { ok: false, plan: quota.plan, reason: dailyReason };
  }

  const cost = jobType ? jobPointCost(env, jobType) : 0;
  if (cost > 0 && env.billingEnforcePoints) {
    await refreshPlanGrant(db, env, organizationId);
    const wallet = await ensureWallet(db, organizationId);
    if (wallet.balance < cost) {
      return {
        ok: false,
        plan: quota.plan,
        reason: `Not enough points (need ${cost}, have ${wallet.balance})`,
        needPoints: Math.max(0, cost - wallet.balance),
        balance: wallet.balance,
      };
    }
  }

  return { ok: true, plan: quota.plan, cost };
}

export function jobQuotaBlockReason(
  concurrent: number,
  daily: number,
  quota: { readonly plan: string; readonly maxConcurrent: number; readonly dailyJobLimit: number },
): string | null {
  if (concurrent >= quota.maxConcurrent) {
    return `Concurrent job limit reached (plan=${quota.plan}, limit=${quota.maxConcurrent})`;
  }
  if (daily >= quota.dailyJobLimit) {
    return `Daily job limit reached (plan=${quota.plan}, limit=${quota.dailyJobLimit}/UTC day)`;
  }
  return null;
}

/** Serialize enqueue for one org so count + insert cannot race. */
export async function lockOrgJobQuota(db: DrizzleDb, organizationId: string): Promise<void> {
  await db.execute(sql`select pg_advisory_xact_lock(hashtext(${organizationId}))`);
}

/**
 * Charges the queued job to the org's wallet, and pays the parent author a
 * share when the project was forked from someone else's work.
 *
 * The royalty is the point of the whole licence design: an author who lets
 * their game be remixed earns from every remix that gets generated, which is a
 * far better reason to open a work up than any copy protection we could ship.
 *
 * Best-effort by design — a job that is already queued must not be lost to a
 * bookkeeping failure, and `assertCanEnqueueJob` has already verified the
 * balance moments earlier.
 */
export type InsertChargedJobValues = {
  readonly projectId: string;
  readonly sessionId?: string | null;
  readonly type: string;
  readonly payload?: unknown;
  readonly traceId?: string | null;
  readonly buildCacheKey?: string | null;
  readonly retryCount?: number;
};

/**
 * Insert the job row and debit points in one transaction. If the wallet
 * cannot cover the job, nothing is queued — no orphan `queued` row and no
 * later 402 after the user already saw a job id.
 */
export async function insertChargedJob(
  db: DrizzleDb,
  env: PlatformEnv,
  values: InsertChargedJobValues,
  charge: {
    readonly organizationId: string;
    readonly projectId: string;
    readonly jobType: string;
  },
): Promise<{ ok: true; job: InsertedJob } | { ok: false; message: string }> {
  try {
    const job = await db.transaction(async (tx) => {
      const scoped = tx as unknown as DrizzleDb;
      await lockOrgJobQuota(scoped, charge.organizationId);
      const quota = await assertCanEnqueueJob(scoped, env, charge.organizationId, charge.jobType);
      if (!quota.ok) throw new Error(quota.reason);
      const [row] = await tx
        .insert(jobs)
        .values({
          projectId: values.projectId,
          sessionId: values.sessionId ?? null,
          type: values.type,
          status: 'queued',
          payload: values.payload ?? {},
          traceId: values.traceId ?? null,
          buildCacheKey: values.buildCacheKey ?? null,
          retryCount: values.retryCount ?? 0,
        })
        .returning();
      if (!row) throw new Error('job insert failed');
      await chargeJobPoints(scoped, env, {
        organizationId: charge.organizationId,
        projectId: charge.projectId,
        jobId: row.id,
        jobType: charge.jobType,
      });
      return row;
    });
    return { ok: true, job };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, message };
  }
}

/**
 * Charges a job that is already in the table. Prefer {@link insertChargedJob}
 * for new work so a failed debit cannot leave a queued row behind.
 */
export async function tryChargeQueuedJob(
  db: DrizzleDb,
  env: PlatformEnv,
  params: {
    readonly organizationId: string;
    readonly projectId: string;
    readonly jobId: string;
    readonly jobType: string;
  },
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await chargeJobPoints(db, env, params);
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(jobs)
      .set({
        status: 'failed',
        logKey: `points_charge_failed: ${message}`.slice(0, 2000),
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, params.jobId));
    return { ok: false, message };
  }
}

export function ledgerRowIsJobSpend(kind: string, points: number): boolean {
  return kind === 'spend' && points < 0;
}

export async function chargeJobPoints(
  db: DrizzleDb,
  env: PlatformEnv,
  params: {
    readonly organizationId: string;
    readonly projectId: string;
    readonly jobId: string;
    readonly jobType: string;
  },
): Promise<void> {
  if (!env.billingEnforcePoints) return;
  const cost = jobPointCost(env, params.jobType);
  if (cost <= 0) return;
  const chargedNow = await db.transaction(async (tx) => {
    const scoped = tx as unknown as DrizzleDb;
    const [locked] = await tx
      .select({ id: jobs.id })
      .from(jobs)
      .where(eq(jobs.id, params.jobId))
      .for('update');
    if (!locked) {
      throw new Error(`job ${params.jobId} missing while charging`);
    }
    const [existing] = await tx
      .select({ kind: ledgerEntries.kind, points: ledgerEntries.points })
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.jobId, params.jobId), eq(ledgerEntries.kind, 'spend')))
      .limit(1);
    if (existing && ledgerRowIsJobSpend(existing.kind, existing.points)) {
      return false;
    }
    const spent = await debitPoints(scoped, params.organizationId, cost, 'spend', {
      jobId: params.jobId,
      note: params.jobType,
    });
    if (!spent.ok) {
      throw new Error(`Failed to charge ${cost} points for ${params.jobType}`);
    }
    return true;
  });
  if (!chargedNow) return;
  try {
    await payRemixRoyalty(db, env, params, cost);
  } catch {
    // Royalty is best-effort; the spend already landed.
  }
}

async function payRemixRoyalty(
  db: DrizzleDb,
  env: PlatformEnv,
  params: {
    readonly organizationId: string;
    readonly projectId: string;
    readonly jobId: string;
  },
  cost: number,
): Promise<void> {
  const rate = env.remixRoyaltyRate;
  if (rate <= 0) return;
  const share = Math.floor(cost * rate);
  if (share <= 0) return;

  const [lineage] = await db
    .select({ parentProjectId: projectRemixes.parentProjectId })
    .from(projectRemixes)
    .where(eq(projectRemixes.childProjectId, params.projectId))
    .orderBy(desc(projectRemixes.createdAt))
    .limit(1);
  if (!lineage) return;

  const [parent] = await db
    .select({ organizationId: projects.organizationId })
    .from(projects)
    .where(eq(projects.id, lineage.parentProjectId))
    .limit(1);
  // Remixing your own work is not income.
  if (!parent || parent.organizationId === params.organizationId) return;

  await creditPoints(db, parent.organizationId, share, 'royalty', {
    jobId: params.jobId,
    sourceOrganizationId: params.organizationId,
    note: `remix royalty ${Math.round(rate * 100)}%`,
  });
}

/** Gives points back when a job could not be created after it was charged. */
export async function refundJobPoints(
  db: DrizzleDb,
  env: PlatformEnv,
  organizationId: string,
  jobType: string,
  jobId?: string,
): Promise<void> {
  if (!env.billingEnforcePoints) return;
  const cost = jobPointCost(env, jobType);
  if (cost <= 0) return;
  await creditPoints(db, organizationId, cost, 'refund', {
    jobId: jobId ?? null,
    note: `refund ${jobType}`,
  }).catch(() => undefined);
}
