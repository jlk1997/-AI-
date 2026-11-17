/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Publish society_replay.json next to the latest preview dist (S3 + optional disk).
 */

import { and, desc, eq } from 'drizzle-orm';
import type { S3Client } from '@aws-sdk/client-s3';

import {
  artifacts,
  deployments,
  loadSocietyReplayBundle,
  type DrizzleDb,
} from '@opengame/platform-db';

import type { PlatformEnv } from '../env.js';
import { putObjectText } from './s3.js';
import { slimSocietyEventPayload, mergePinnedSocietyEvents } from './societyLive.js';

export async function publishSocietyReplayJson(input: {
  readonly db: DrizzleDb;
  readonly s3: S3Client;
  readonly env: PlatformEnv;
  readonly projectId: string;
  readonly worldId: string;
}): Promise<{ readonly ok: boolean; readonly key?: string; readonly events: number }> {
  const bundle = await loadSocietyReplayBundle(input.db, input.worldId);
  const usable = bundle.events.filter((e) => e.kind !== 'emergence_report');
  const slimEvents = mergePinnedSocietyEvents(
    usable.slice(-400),
    [
      ...usable.filter((e) => e.kind === 'intervene'),
      ...usable.filter((e) => e.kind === 'dialogue').slice(-24),
    ],
  ).map((e) => ({
      id: e.id,
      simTime: e.simTime,
      kind: e.kind,
      agentId: e.agentId,
      payload: slimSocietyEventPayload(
        e.kind,
        e.payload as Record<string, unknown>,
      ),
    }));
  const body = JSON.stringify({
    version: 1,
    worldId: input.worldId,
    projectId: input.projectId,
    simTime: bundle.simTime,
    agents: bundle.agents,
    events: slimEvents,
    report: bundle.report
      ? {
          summary:
            typeof bundle.report['summary'] === 'string'
              ? String(bundle.report['summary']).slice(0, 320)
              : bundle.report['summary'],
          informationSpread: bundle.report['informationSpread'],
          relationshipFormation: bundle.report['relationshipFormation'],
          coordination: bundle.report['coordination'],
        }
      : null,
  });

  const [dep] = await input.db
    .select()
    .from(deployments)
    .where(
      and(
        eq(deployments.projectId, input.projectId),
        eq(deployments.channel, 'preview'),
      ),
    )
    .orderBy(desc(deployments.createdAt))
    .limit(1);

  if (!dep?.artifactId) {
    return { ok: false, events: bundle.events.length };
  }

  const [art] = await input.db
    .select()
    .from(artifacts)
    .where(eq(artifacts.id, dep.artifactId))
    .limit(1);
  const manifest = art?.manifest as { distPrefix?: string } | null;
  const distPrefix = (
    manifest?.distPrefix ??
    art?.storagePrefix ??
    ''
  ).replace(/\/$/, '');
  if (!distPrefix) {
    return { ok: false, events: bundle.events.length };
  }

  const key = `${distPrefix}/society_replay.json`;
  await putObjectText(
    input.s3,
    input.env,
    key,
    body,
    'application/json; charset=utf-8',
  );
  return { ok: true, key, events: bundle.events.length };
}

const lastPublishAt = new Map<string, number>();

function eventsHaveSpeech(
  events: ReadonlyArray<{ readonly kind?: string }>,
): boolean {
  return events.some((e) => e.kind === 'dialogue' || e.kind === 'intervene');
}

/** After live dialogue / whisper: refresh society_replay.json so a new tab sees the tip.
 * Live observatory uses postMessage APPEND as source of truth — keep S3 publish rare
 * so it does not contend with the tick DB pool.
 */
export function scheduleSocietyReplayPublish(input: {
  readonly db: DrizzleDb;
  readonly s3: S3Client;
  readonly env: PlatformEnv;
  readonly projectId: string;
  readonly worldId: string;
  readonly events?: ReadonlyArray<{ readonly kind?: string }>;
  readonly force?: boolean;
}): void {
  if (!input.force && !eventsHaveSpeech(input.events ?? [])) return;
  const now = Date.now();
  const prev = lastPublishAt.get(input.worldId) ?? 0;
  // 30s debounce on the hot dialogue path (was 8s).
  if (!input.force && now - prev < 30_000) return;
  lastPublishAt.set(input.worldId, now);
  void publishSocietyReplayJson(input).catch(() => undefined);
}
