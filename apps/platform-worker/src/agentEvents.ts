/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { eq, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';

import type { DrizzleDb } from '@opengame/platform-db';
import { agentEvents } from '@opengame/platform-db';

export type AgentRole = 'planner' | 'coder' | 'artist' | 'qa' | 'fixer' | 'system';

export type AgentPhase =
  | 'PLAN'
  | 'INTENT'
  /** World Spec compiled into the game's scenes / entities / quests. */
  | 'WORLD'
  | 'CODE'
  | 'ITERATE'
  | 'ASSET'
  | 'BUILD'
  | 'QA'
  | 'FIX'
  /** Early playable delivery — preview deployed before the job finished. */
  | 'PREVIEW'
  | 'CURATE'
  | 'DONE'
  | 'FAIL'
  /** 批次 4：world narrative 偏模板化时推的"自愈"信号。 */
  | 'HEAL';

export interface AgentEventInput {
  readonly role: AgentRole;
  readonly phase: AgentPhase;
  readonly seq: number;
  readonly tool?: string;
  readonly summary?: string;
  readonly details?: Record<string, unknown>;
  readonly elapsedMs?: number;
}

export interface AgentEventContext {
  readonly db: DrizzleDb;
  readonly publisher: Redis | null;
  readonly jobId: string;
  readonly projectId: string;
  readonly sessionId: string | null;
}

/** Raised when agent_events.job_id is missing from jobs (orphan BullMQ / deleted row). */
export class AgentEventJobMissingError extends Error {
  readonly code = 'AGENT_EVENT_JOB_MISSING';

  constructor(
    readonly jobId: string,
    options?: { cause?: unknown },
  ) {
    super(
      `agent_events insert failed: job_id=${jobId} is not present in table jobs`,
    );
    this.name = 'AgentEventJobMissingError';
    if (options?.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

function counterKey(role: string, phase: string): string {
  return `${role}:${phase}`;
}

function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: string }).code;
  if (code === '23505') return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /agent_events_job_seq_uq|duplicate key/i.test(msg);
}

function isJobForeignKeyViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: string }).code;
  const constraint = (err as { constraint_name?: string; constraint?: string })
    .constraint_name
    ?? (err as { constraint?: string }).constraint;
  if (code === '23503') {
    if (!constraint) return true;
    return /agent_events_job_id_fkey|job_id/i.test(constraint);
  }
  const msg = err instanceof Error ? err.message : String(err);
  return (
    /agent_events_job_id_fkey/i.test(msg) ||
    (/violates foreign key constraint/i.test(msg) && /job_id/i.test(msg))
  );
}

/**
 * Seed per-(role,phase) counters from rows already stored for this job.
 * Required when BullMQ re-runs a stalled job — otherwise seq restarts at 1 and
 * every insert hits `agent_events_job_seq_uq`.
 */
export async function loadAgentEventCounters(
  db: DrizzleDb,
  jobId: string,
): Promise<Map<string, number>> {
  const counters = new Map<string, number>();
  try {
    const rows = await db
      .select({
        role: agentEvents.role,
        phase: agentEvents.phase,
        maxSeq: sql<number>`coalesce(max(${agentEvents.seq}), 0)`.mapWith(Number),
      })
      .from(agentEvents)
      .where(eq(agentEvents.jobId, jobId))
      .groupBy(agentEvents.role, agentEvents.phase);
    for (const row of rows) {
      if (!row.role || !row.phase) continue;
      const maxSeq = Number(row.maxSeq) || 0;
      if (maxSeq > 0) counters.set(counterKey(row.role, row.phase), maxSeq);
    }
  } catch (err) {
    console.warn('[agentEvents] failed to hydrate seq counters', err);
  }
  return counters;
}

/**
 * Writes one structured event to `agent_events` and publishes it on Redis
 * channel `job:{projectId}:updates` so the BFF's SSE endpoint can stream it
 * to the IDE in real time. Both operations are best-effort; we never let a
 * telemetry failure abort the underlying job — except a missing `jobs` row,
 * which means the BullMQ payload is orphaned and must stop the worker.
 *
 * @returns `true` when the DB insert succeeded.
 */
export async function emitAgentEvent(
  ctx: AgentEventContext,
  event: AgentEventInput,
): Promise<boolean> {
  let inserted = false;
  try {
    await ctx.db.insert(agentEvents).values({
      jobId: ctx.jobId,
      projectId: ctx.projectId,
      sessionId: ctx.sessionId,
      role: event.role,
      phase: event.phase,
      seq: event.seq,
      tool: event.tool ?? null,
      summary: event.summary ?? null,
      details: (event.details as never) ?? null,
      elapsedMs: event.elapsedMs ?? null,
    });
    inserted = true;
  } catch (err) {
    if (isUniqueViolation(err)) {
      // Caller (AgentEventStream) will bump seq and retry.
      throw err;
    }
    if (isJobForeignKeyViolation(err)) {
      throw new AgentEventJobMissingError(ctx.jobId, { cause: err });
    }
    console.warn('[agentEvents] db insert failed', err);
  }
  if (ctx.publisher) {
    try {
      const channel = `job:${ctx.projectId}:updates`;
      const payload = JSON.stringify({
        kind: 'agent-event',
        jobId: ctx.jobId,
        projectId: ctx.projectId,
        sessionId: ctx.sessionId,
        role: event.role,
        phase: event.phase,
        seq: event.seq,
        tool: event.tool,
        summary: event.summary,
        details: event.details,
        elapsedMs: event.elapsedMs,
        ts: Date.now(),
      });
      await ctx.publisher.publish(channel, payload);
    } catch (err) {
      console.warn('[agentEvents] redis publish failed', err);
    }
  }
  return inserted;
}

/**
 * Tracks the per-role sequence counter for a job so callers don't have to
 * thread it through every call site.
 *
 * Counters are hydrated from Postgres on first emit so stalled-job retries
 * continue past existing `(job_id, role, seq, phase)` rows instead of
 * spamming unique-violation warnings.
 */
export class AgentEventStream {
  private readonly counters = new Map<string, number>();
  private hydrated = false;
  private hydratePromise: Promise<void> | null = null;
  private jobMissing = false;

  constructor(private readonly ctx: AgentEventContext) {}

  /** Explicit warm-up (optional — `emit` hydrates lazily). */
  async prepare(): Promise<void> {
    await this.ensureHydrated();
  }

  private async ensureHydrated(): Promise<void> {
    if (this.hydrated) return;
    if (!this.hydratePromise) {
      this.hydratePromise = (async () => {
        const loaded = await loadAgentEventCounters(this.ctx.db, this.ctx.jobId);
        for (const [key, value] of loaded) {
          const current = this.counters.get(key) ?? 0;
          if (value > current) this.counters.set(key, value);
        }
        this.hydrated = true;
        if (loaded.size > 0) {
          console.log(
            `[agentEvents] resumed seq counters for job ${this.ctx.jobId} (${loaded.size} role/phase keys)`,
          );
        }
      })();
    }
    await this.hydratePromise;
  }

  async emit(
    role: AgentRole,
    phase: AgentPhase,
    extras: {
      tool?: string;
      summary?: string;
      details?: Record<string, unknown>;
      elapsedMs?: number;
    } = {},
  ): Promise<void> {
    if (this.jobMissing) {
      throw new AgentEventJobMissingError(this.ctx.jobId);
    }
    await this.ensureHydrated();
    const key = counterKey(role, phase);
    // A few retries cover races between concurrent workers / late hydration.
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const next = (this.counters.get(key) ?? 0) + 1;
      this.counters.set(key, next);
      try {
        await emitAgentEvent(this.ctx, {
          role,
          phase,
          seq: next,
          ...(extras.tool !== undefined ? { tool: extras.tool } : {}),
          ...(extras.summary !== undefined ? { summary: extras.summary } : {}),
          ...(extras.details !== undefined ? { details: extras.details } : {}),
          ...(extras.elapsedMs !== undefined ? { elapsedMs: extras.elapsedMs } : {}),
        });
        return;
      } catch (err) {
        if (err instanceof AgentEventJobMissingError) {
          this.jobMissing = true;
          throw err;
        }
        if (!isUniqueViolation(err)) {
          console.warn('[agentEvents] db insert failed', err);
          return;
        }
        // Another writer may have claimed this seq — jump past DB max and retry.
        try {
          const fresh = await loadAgentEventCounters(this.ctx.db, this.ctx.jobId);
          const dbMax = fresh.get(key) ?? 0;
          if (dbMax >= next) this.counters.set(key, dbMax);
        } catch {
          // keep local bump
        }
      }
    }
    console.warn(
      `[agentEvents] gave up inserting ${role}/${phase} after unique conflicts for job ${this.ctx.jobId}`,
    );
  }
}
