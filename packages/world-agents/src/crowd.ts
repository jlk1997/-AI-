/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Crowd cohorts. Histograms move by bounded confidence. No model calls.
 */

export {
  deriveCrowd,
  forecastCrowd,
  sampleCrowdDots,
  stepCrowd,
  type CrowdCohort,
  type CrowdDot,
  type CrowdLeader,
  type ForecastBand,
} from './societyMind.js';

/** Leaders are core residents. Their stance is what the local crowd hears. */
export function crowdLeadersFromOpinions(
  opinions: ReadonlyArray<{
    readonly agentId: string;
    readonly stance: number;
    readonly topicId: string;
  }>,
  regionOf: (agentId: string) => string | undefined,
  topicId?: string,
): Array<{ agentId: string; regionId: string; stance: number }> {
  const rows = topicId ? opinions.filter((o) => o.topicId === topicId) : opinions;
  const out: Array<{ agentId: string; regionId: string; stance: number }> = [];
  for (const row of rows) {
    const regionId = regionOf(row.agentId);
    if (!regionId) continue;
    out.push({ agentId: row.agentId, regionId, stance: row.stance });
  }
  return out;
}
