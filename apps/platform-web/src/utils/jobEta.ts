/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Honest remaining-time copy for the generation timeline. Not a promise —
 * typical minutes by job type, scaled by pipeline percent and elapsed clock.
 */

export const TYPICAL_JOB_MINUTES: Record<string, number> = {
  generate: 12,
  world_generate: 18,
  world_edit: 8,
  world_train: 6,
  world_society_run: 10,
  build: 4,
  publish: 3,
  bench: 6,
};

export const DEFAULT_JOB_POINT_COSTS: Record<string, number> = {
  generate: 10,
  world_generate: 20,
  world_edit: 6,
  world_train: 4,
  world_society_run: 2,
  build: 1,
  publish: 0,
  bench: 2,
};

export function typicalJobMinutes(jobType?: string | null): number {
  if (!jobType) return TYPICAL_JOB_MINUTES.generate;
  return TYPICAL_JOB_MINUTES[jobType] ?? TYPICAL_JOB_MINUTES.generate;
}

export function defaultJobPointCost(jobType?: string | null): number {
  if (!jobType) return DEFAULT_JOB_POINT_COSTS.generate;
  return DEFAULT_JOB_POINT_COSTS[jobType] ?? 0;
}

export function estimateJobRemainMinutes(params: {
  readonly lifecycle: 'idle' | 'queued' | 'running' | 'done' | 'failed' | string;
  readonly percent?: number;
  readonly jobType?: string | null;
  readonly startedAt?: string | null;
  readonly now?: number;
}): { remainMin: number; typicalMin: number } {
  const typicalMin = typicalJobMinutes(params.jobType);
  if (params.lifecycle === 'queued') {
    return { remainMin: typicalMin + 2, typicalMin };
  }
  if (params.lifecycle !== 'running' && params.lifecycle !== 'generating') {
    return { remainMin: 0, typicalMin };
  }
  const percent = Math.min(99, Math.max(0, params.percent ?? 0));
  const byPercent = Math.max(1, Math.ceil((typicalMin * (100 - percent)) / 100));
  if (params.startedAt) {
    const started = Date.parse(params.startedAt);
    if (Number.isFinite(started)) {
      const elapsedMin = Math.max(0, ((params.now ?? Date.now()) - started) / 60_000);
      const remainByElapsed = Math.max(1, Math.ceil(typicalMin - elapsedMin));
      return { remainMin: Math.min(byPercent, remainByElapsed), typicalMin };
    }
  }
  return { remainMin: byPercent, typicalMin };
}
