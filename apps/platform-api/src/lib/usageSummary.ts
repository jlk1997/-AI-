/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Platform usage_events.modality is job semantics (generate/build/…),
 * not Core image/video/audio tokens. meta.jobType is the same axis.
 */

export type UsageMeta = {
  readonly jobType?: unknown;
  readonly ms?: unknown;
  readonly contentHash?: unknown;
};

export function usageJobType(modality: string, meta: unknown): string {
  if (meta && typeof meta === 'object' && 'jobType' in meta) {
    const jobType = (meta as UsageMeta).jobType;
    if (typeof jobType === 'string' && jobType.trim()) return jobType.trim();
  }
  return modality;
}

export function usageDurationMs(meta: unknown): number | null {
  if (meta && typeof meta === 'object' && 'ms' in meta) {
    const ms = (meta as UsageMeta).ms;
    if (typeof ms === 'number' && Number.isFinite(ms) && ms >= 0) return Math.round(ms);
  }
  return null;
}

export function mapUsageRecent(rows: ReadonlyArray<{
  modality: string;
  units: unknown;
  jobId: string | null;
  createdAt: Date | string;
  meta: unknown;
}>): Array<{
  jobType: string;
  modality: string;
  units: number;
  ms: number | null;
  jobId: string | null;
  createdAt: string;
}> {
  return rows.map((row) => ({
    jobType: usageJobType(row.modality, row.meta),
    modality: row.modality,
    units: Number(row.units ?? 0) || 0,
    ms: usageDurationMs(row.meta),
    jobId: row.jobId,
    createdAt: typeof row.createdAt === 'string' ? row.createdAt : row.createdAt.toISOString(),
  }));
}
