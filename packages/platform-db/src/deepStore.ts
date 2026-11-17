/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * JSON snapshot plus the query tables for a deep town and its forecasts.
 */

import { and, asc, desc, eq, sql } from 'drizzle-orm';

import {
  agentActionLog,
  agentPsyche,
  forecastRuns,
  forecastScenarios,
  historicalCases,
  worldChronicle,
  worldDeepState,
  worldInstitutions,
  worldLedgerSnapshots,
  worlds,
} from './schema.js';
import type { DrizzleDb } from './index.js';

type Db = DrizzleDb;

export async function readCognition(
  db: Db,
  worldId: string,
): Promise<{ cognition: string; violencePublic: boolean } | null> {
  const [row] = await db
    .select({ cognition: worlds.cognition, violencePublic: worlds.violencePublic })
    .from(worlds)
    .where(eq(worlds.id, worldId))
    .limit(1);
  return row ?? null;
}

export async function setCognition(
  db: Db,
  worldId: string,
  cognition: 'classic' | 'deep',
  violencePublic?: boolean,
): Promise<void> {
  await db
    .update(worlds)
    .set({
      cognition,
      ...(typeof violencePublic === 'boolean' ? { violencePublic } : {}),
      updatedAt: new Date(),
    })
    .where(eq(worlds.id, worldId));
}

export async function readDeepState(db: Db, worldId: string): Promise<unknown | null> {
  const [row] = await db
    .select({ stateJson: worldDeepState.stateJson })
    .from(worldDeepState)
    .where(eq(worldDeepState.worldId, worldId))
    .limit(1);
  return row?.stateJson ?? null;
}

export async function writeDeepBundle(
  db: Db,
  worldId: string,
  input: {
    readonly state: unknown;
    readonly psyches?: ReadonlyArray<{ readonly agentKey: string; readonly psyche: unknown }>;
    readonly institutions?: ReadonlyArray<{
      readonly key: string;
      readonly kind: string;
      readonly name: string;
      readonly body: unknown;
    }>;
    readonly chronicle?: ReadonlyArray<{
      readonly simTime: number;
      readonly text: string;
      readonly surprise: boolean;
    }>;
    readonly actions?: ReadonlyArray<{
      readonly agentKey: string;
      readonly simTime: number;
      readonly intent: string;
      readonly action: string;
      readonly monologue: string;
      readonly isPublic: boolean;
    }>;
    readonly ledger?: unknown;
    readonly ledgerSimTime?: number;
  },
): Promise<void> {
  const now = new Date();
  await db
    .insert(worldDeepState)
    .values({ worldId, stateJson: input.state ?? {}, updatedAt: now })
    .onConflictDoUpdate({
      target: worldDeepState.worldId,
      set: { stateJson: input.state ?? {}, updatedAt: now },
    });
  if (input.psyches?.length) {
    await db
      .insert(agentPsyche)
      .values(
        input.psyches.map((row) => ({
          worldId,
          agentKey: row.agentKey,
          psycheJson: row.psyche ?? {},
          updatedAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: [agentPsyche.worldId, agentPsyche.agentKey],
        set: {
          psycheJson: sql`excluded.psyche_json`,
          updatedAt: now,
        },
      });
  }
  if (input.institutions) {
    await db.delete(worldInstitutions).where(eq(worldInstitutions.worldId, worldId));
    if (input.institutions.length) {
      await db.insert(worldInstitutions).values(
        input.institutions.map((row) => ({
          worldId,
          instKey: row.key,
          kind: row.kind,
          name: row.name,
          bodyJson: row.body ?? {},
          updatedAt: now,
        })),
      );
    }
  }
  if (input.chronicle) {
    await db.delete(worldChronicle).where(eq(worldChronicle.worldId, worldId));
    if (input.chronicle.length) {
      await db.insert(worldChronicle).values(
        input.chronicle.slice(-80).map((row) => ({
          worldId,
          simTime: String(row.simTime),
          text: row.text,
          surprise: row.surprise,
        })),
      );
    }
  }
  if (input.actions?.length) {
    await db.insert(agentActionLog).values(
      input.actions.slice(0, 20).map((row) => ({
        worldId,
        agentKey: row.agentKey,
        simTime: String(row.simTime),
        intent: row.intent,
        actionText: row.action,
        monologue: row.monologue,
        isPublic: row.isPublic,
      })),
    );
  }
  if (input.ledger) {
    await db.insert(worldLedgerSnapshots).values({
      worldId,
      simTime: String(input.ledgerSimTime ?? 0),
      ledgerJson: input.ledger,
    });
    await db.execute(sql`
      DELETE FROM world_ledger_snapshots
      WHERE world_id = ${worldId}
        AND id NOT IN (
          SELECT id FROM world_ledger_snapshots
          WHERE world_id = ${worldId}
          ORDER BY created_at DESC
          LIMIT 24
        )
    `);
  }
}

export async function enqueueForecast(
  db: Db,
  worldId: string,
  title: string,
  spec: unknown,
): Promise<string> {
  const [scenario] = await db
    .insert(forecastScenarios)
    .values({ worldId, title, specJson: spec ?? {} })
    .returning({ id: forecastScenarios.id });
  const [run] = await db
    .insert(forecastRuns)
    .values({
      worldId,
      scenarioId: scenario?.id,
      status: 'queued',
      specJson: spec ?? {},
    })
    .returning({ id: forecastRuns.id });
  return run!.id;
}

export async function claimForecast(db: Db): Promise<{
  readonly id: string;
  readonly worldId: string;
  readonly spec: unknown;
} | null> {
  const [queued] = await db
    .select({
      id: forecastRuns.id,
      worldId: forecastRuns.worldId,
      spec: forecastRuns.specJson,
    })
    .from(forecastRuns)
    .where(eq(forecastRuns.status, 'queued'))
    .orderBy(asc(forecastRuns.createdAt))
    .limit(1);
  if (!queued) return null;
  const updated = await db
    .update(forecastRuns)
    .set({ status: 'running', updatedAt: new Date() })
    .where(and(eq(forecastRuns.id, queued.id), eq(forecastRuns.status, 'queued')))
    .returning({ id: forecastRuns.id });
  if (!updated.length) return null;
  return queued;
}

export async function finishForecast(
  db: Db,
  id: string,
  report: unknown,
  error?: string,
): Promise<void> {
  await db
    .update(forecastRuns)
    .set({
      status: error ? 'failed' : 'done',
      reportJson: error ? null : (report ?? {}),
      error: error ?? null,
      updatedAt: new Date(),
    })
    .where(eq(forecastRuns.id, id));
}

export async function readForecast(
  db: Db,
  worldId: string,
  runId: string,
): Promise<{ status: string; report: unknown; error: string | null } | null> {
  const [row] = await db
    .select({
      status: forecastRuns.status,
      report: forecastRuns.reportJson,
      error: forecastRuns.error,
    })
    .from(forecastRuns)
    .where(and(eq(forecastRuns.id, runId), eq(forecastRuns.worldId, worldId)))
    .limit(1);
  return row ?? null;
}

export async function latestForecast(
  db: Db,
  worldId: string,
): Promise<{ id: string; status: string; report: unknown } | null> {
  const [row] = await db
    .select({
      id: forecastRuns.id,
      status: forecastRuns.status,
      report: forecastRuns.reportJson,
    })
    .from(forecastRuns)
    .where(eq(forecastRuns.worldId, worldId))
    .orderBy(desc(forecastRuns.createdAt))
    .limit(1);
  return row ?? null;
}

export async function upsertHistoricalCase(
  db: Db,
  id: string,
  title: string,
  body: unknown,
): Promise<void> {
  await db
    .insert(historicalCases)
    .values({ id, title, bodyJson: body ?? {} })
    .onConflictDoUpdate({
      target: historicalCases.id,
      set: { title, bodyJson: body ?? {} },
    });
}
