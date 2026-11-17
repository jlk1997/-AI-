/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure helpers for world→game lineage snapshots. Kept out of the React
 * component file so Vite Fast Refresh does not full-reload GeneratePage
 * (incompatible non-component export).
 */

import type { AgentEventRow } from '../types';
import { getActiveJobEvents } from './generationProgressText';

export interface LineageCoverage {
  readonly total: number;
  readonly present: number;
  readonly missing?: string[];
}

export interface WorldLineageSnapshot {
  readonly worldTitle: string | null;
  readonly initialSceneId: string | null;
  readonly scenes: string[];
  readonly stats: {
    regions: number;
    entities: number;
    quests: number;
    portals: number;
    rules: number;
  } | null;
  readonly tunables: Record<string, number> | null;
  readonly tunablesSource: string | null;
  readonly summaryLines: string[];
  readonly gateOk: boolean | null;
  readonly coverage: {
    scenes?: LineageCoverage;
    entities?: LineageCoverage;
    quests?: LineageCoverage;
    portals?: LineageCoverage;
  } | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function asNumberRecord(value: unknown): Record<string, number> | null {
  const row = asRecord(value);
  if (!row) return null;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(row)) {
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Latest compile + gate state for the focused job, or `null` when no world. */
export function readWorldLineageSnapshot(
  events: AgentEventRow[],
  activeJobId?: string | null,
): WorldLineageSnapshot | null {
  const focused = getActiveJobEvents(events, activeJobId).filter(
    (evt) => evt.phase === 'WORLD',
  );
  if (focused.length === 0) return null;

  const compile = [...focused]
    .reverse()
    .find((evt) => evt.tool === 'world-game-compiler' && evt.details);
  const gate = [...focused]
    .reverse()
    .find((evt) => evt.tool === 'world-lineage-gate' && evt.details);
  const neural = [...focused]
    .reverse()
    .find((evt) => evt.tool === 'l2-hybrid-world-model' && evt.details);
  if (!compile && !gate) return null;

  const compileDetails = asRecord(compile?.details) ?? {};
  const gateDetails = asRecord(gate?.details) ?? {};
  const neuralDetails = asRecord(neural?.details) ?? {};
  const statsRow = asRecord(compileDetails['stats']);
  const stats = statsRow
    ? {
        regions: Number(statsRow['regions'] ?? 0),
        entities: Number(statsRow['entities'] ?? 0),
        quests: Number(statsRow['quests'] ?? 0),
        portals: Number(statsRow['portals'] ?? 0),
        rules: Number(statsRow['rules'] ?? 0),
      }
    : null;

  const gateOkRaw = gateDetails['ok'];
  return {
    worldTitle:
      typeof compileDetails['worldTitle'] === 'string'
        ? (compileDetails['worldTitle'] as string)
        : typeof gateDetails['worldTitle'] === 'string'
          ? (gateDetails['worldTitle'] as string)
          : null,
    initialSceneId:
      typeof compileDetails['initialSceneId'] === 'string'
        ? (compileDetails['initialSceneId'] as string)
        : null,
    scenes: asStringArray(compileDetails['scenes']),
    stats,
    tunables:
      asNumberRecord(compileDetails['tunables']) ??
      asNumberRecord(neuralDetails['tunables']),
    tunablesSource:
      typeof compileDetails['tunablesSource'] === 'string'
        ? (compileDetails['tunablesSource'] as string)
        : neural
          ? 'l2-hybrid-world-model'
          : null,
    summaryLines: asStringArray(compileDetails['summaryLines']),
    gateOk: typeof gateOkRaw === 'boolean' ? gateOkRaw : null,
    coverage: (asRecord(gateDetails['coverage']) as WorldLineageSnapshot['coverage']) ?? null,
  };
}
