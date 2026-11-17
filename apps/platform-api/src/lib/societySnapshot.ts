/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Read-only inspector payload for a published town (same shape as
 * GET /projects/:id/world/society/events plus the latest report).
 */

import { and, desc, eq, sql } from 'drizzle-orm';
import {
  agentRelations,
  comparePersistedSocietyEvents,
  loadDurableSocietyMind,
  loadEmergenceReport,
  loadLatestObjectStateEvents,
  loadLatestSocietyForecast,
  loadObjectTip,
  societyEvents,
  worldAgents,
  worlds,
  type DrizzleDb,
} from '@opengame/platform-db';
import { townPresenceBadge } from '@opengame/platform-shared';
import { boardView, hydrateMind } from '@opengame/world-agents';

import {
  annotateAgentsWithAreas,
  mergePinnedSocietyEvents,
  objectSnapshotFromSpec,
  slimSocietyEventPayload,
} from './societyLive.js';

export function societyInspectorClock(spec: unknown): {
  clock?: { kind?: string; shifts?: number };
  space?: unknown;
  presentation?: unknown;
} {
  if (!spec || typeof spec !== 'object') return {};
  const rec = spec as {
    presentation?: {
      genreProfile?: { clock?: { kind?: string; shifts?: number } };
    };
    space?: unknown;
  };
  const clock = rec.presentation?.genreProfile?.clock;
  return {
    clock:
      clock && typeof clock === 'object'
        ? {
            kind: typeof clock.kind === 'string' ? clock.kind : undefined,
            shifts: typeof clock.shifts === 'number' ? clock.shifts : undefined,
          }
        : undefined,
    space: rec.space,
    presentation: rec.presentation,
  };
}

export async function loadSocietyInspectorSnapshot(
  db: DrizzleDb,
  worldId: string,
): Promise<{
  simTime: number;
  events: Array<{
    id: string;
    simTime: number;
    kind: string;
    agentId: string | null;
    payload: Record<string, unknown>;
    createdAtMs?: number;
  }>;
  agents: unknown[];
  relations: unknown[];
  objects: unknown;
  report: unknown;
  living: boolean;
  speaking: boolean;
  clockPaused: boolean;
  clock?: { kind?: string; shifts?: number };
  space?: unknown;
  presentation?: unknown;
  townTimeUntil: string | null;
  presenceUntil: string | null;
  lightUntil: string | null;
  lightBonusPerHour: number;
  opinion?: unknown;
  forecast?: { label: string; hours: number; bands: unknown } | null;
} | null> {
  const [worldRow] = await db
    .select()
    .from(worlds)
    .where(eq(worlds.id, worldId))
    .limit(1);
  if (!worldRow) return null;

  const rowsDesc = await db
    .select()
    .from(societyEvents)
    .where(
      and(
        eq(societyEvents.worldId, worldRow.id),
        eq(societyEvents.invalidated, 0),
        sql`${societyEvents.kind} NOT IN ('emergence_report', 'occupancy_ema', 'object_tip')`,
      ),
    )
    .orderBy(desc(societyEvents.simTime), desc(societyEvents.createdAt))
    .limit(120);
  const narrativeDesc = await db
    .select()
    .from(societyEvents)
    .where(
      and(
        eq(societyEvents.worldId, worldRow.id),
        eq(societyEvents.invalidated, 0),
          sql`(${societyEvents.kind} IN ('intervene', 'dialogue') OR (${societyEvents.kind} = 'observation' AND ${societyEvents.payloadJson}->>'course' = 'true'))`,
      ),
    )
    .orderBy(desc(societyEvents.simTime), desc(societyEvents.createdAt))
    .limit(32);
  const interveneDesc = await db
    .select()
    .from(societyEvents)
    .where(
      and(
        eq(societyEvents.worldId, worldRow.id),
        eq(societyEvents.invalidated, 0),
        eq(societyEvents.kind, 'intervene'),
      ),
    )
    .orderBy(desc(societyEvents.createdAt))
    .limit(8);
  const toDto = (r: (typeof rowsDesc)[number]) => ({
    id: r.eventKey,
    simTime: Number(r.simTime),
    kind: r.kind,
    agentId: r.agentKey,
    payload: slimSocietyEventPayload(
      r.kind,
      r.payloadJson && typeof r.payloadJson === 'object'
        ? (r.payloadJson as Record<string, unknown>)
        : {},
    ),
    createdAtMs:
      r.createdAt instanceof Date
        ? r.createdAt.getTime()
        : r.createdAt
          ? Date.parse(String(r.createdAt))
          : 0,
  });
  const eventDtos = mergePinnedSocietyEvents(
    [...rowsDesc].reverse().map(toDto),
    [...narrativeDesc, ...interveneDesc].map(toDto),
  ).sort(comparePersistedSocietyEvents);
  const [agents, relations, objectTip, objectKindRows, report] = await Promise.all([
    db.select().from(worldAgents).where(eq(worldAgents.worldId, worldRow.id)),
    db.select().from(agentRelations).where(eq(agentRelations.worldId, worldRow.id)),
    loadObjectTip(db, worldRow.id).catch(() => null),
    loadLatestObjectStateEvents(db, worldRow.id, { limit: 200 }).catch(() => []),
    loadEmergenceReport(db, worldRow.id).catch(() => null),
  ]);
  const tipSim = rowsDesc.length ? Number(rowsDesc[0]!.simTime) : 0;
  const badge = townPresenceBadge({
    presenceUntil: worldRow.heartbeatUntil,
    authorWatchUntil: worldRow.authorWatchUntil,
    townTimeUntil: worldRow.townTimeUntil,
    litUntil: worldRow.lightUntil,
  });
  const face = societyInspectorClock(worldRow.specJson);
  return {
    simTime: tipSim,
    events: eventDtos,
    agents: annotateAgentsWithAreas(
      worldRow.specJson,
      agents.map((a) => {
        const identity =
          a.identityJson && typeof a.identityJson === 'object'
            ? (a.identityJson as { summary?: unknown })
            : null;
        return {
          id: a.agentKey,
          name: a.name,
          regionId: a.regionId,
          x: Number(a.x),
          y: Number(a.y),
          currentAction: a.currentAction,
          identity: {
            summary:
              typeof identity?.summary === 'string'
                ? identity.summary.slice(0, 240)
                : '',
          },
        };
      }),
      eventDtos,
    ),
    relations: relations.map((r) => ({
      from: r.fromAgentKey,
      to: r.toAgentKey,
      summary: typeof r.summary === 'string' ? r.summary.slice(0, 200) : r.summary,
      affinity: Number(r.affinity),
      kind: (() => {
        const s = typeof r.summary === 'string' ? r.summary : '';
        const m = /^【([^】]+)】/u.exec(s);
        return m?.[1];
      })(),
      lastInteractSimTime:
        r.lastInteractSimTime != null ? Number(r.lastInteractSimTime) : undefined,
    })),
    objects: objectSnapshotFromSpec(worldRow.specJson, objectKindRows, objectTip),
    report,
    living: worldRow.clockPaused ? false : badge.living,
    speaking: worldRow.clockPaused ? false : badge.speaking,
    clockPaused: Boolean(worldRow.clockPaused),
    clock: face.clock,
    space: face.space,
    presentation: face.presentation,
    townTimeUntil: worldRow.townTimeUntil?.toISOString() ?? null,
    presenceUntil: worldRow.heartbeatUntil?.toISOString() ?? null,
    lightUntil: worldRow.lightUntil?.toISOString() ?? null,
    lightBonusPerHour: worldRow.lightBonusPerHour ?? 0,
    opinion: await loadDurableSocietyMind(db, worldRow.id)
      .then((raw) => (raw ? boardView(hydrateMind(raw)) : undefined))
      .catch(() => undefined),
    forecast: await loadLatestSocietyForecast(db, worldRow.id).catch(() => null),
  };
}
