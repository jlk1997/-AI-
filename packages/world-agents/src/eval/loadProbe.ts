/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Short walk used as a load baseline. Callers extrapolate to a full day.
 * The crowd forecast does not call a model.
 */

import {
  deriveCrowd,
  emptyMind,
  forecastCrowd,
  stepCrowd,
  type SocietyMind,
} from '../societyMind.js';
import { createSocietyState, runSocietyHours } from '../tick.js';

export type LoadProbeResult = {
  readonly residents: number;
  readonly crowd: number;
  readonly hours: number;
  readonly steps: number;
  readonly elapsedMs: number;
  readonly frameBytes: number;
  readonly poseWrites: number;
  readonly crowdForecastMs: number;
  readonly extrapolated24hMs: number;
};

function resident(index: number) {
  const region = index % 3 === 0 ? 'market' : index % 3 === 1 ? 'school' : 'plaza';
  return {
    id: `load_${index}`,
    name: `居民${index}`,
    identitySummary: index % 2 === 0 ? '摊主' : '教师',
    regionId: region,
    x: 2 + (index % 8),
    y: 2 + (index % 6),
    needs: { hunger: 0.2, energy: 0.6, social: 0.3, curiosity: 0.2 },
    occupation: index % 2 === 0 ? '摊主' : '教师',
  };
}

export async function probeTownLoad(input?: {
  readonly residents?: number;
  readonly crowd?: number;
  readonly hours?: number;
  readonly dtHours?: number;
}): Promise<LoadProbeResult> {
  const residents = Math.max(2, input?.residents ?? 40);
  const crowdN = Math.max(0, input?.crowd ?? 1500);
  const hours = Math.max(1, input?.hours ?? 1);
  const dtHours = input?.dtHours ?? 1;
  const state = createSocietyState({
    seed: 7,
    simTime: 8,
    agents: Array.from({ length: residents }, (_, i) => resident(i)),
    regionBounds: new Map([
      ['market', { width: 20, height: 16 }],
      ['school', { width: 16, height: 12 }],
      ['plaza', { width: 24, height: 18 }],
    ]),
  });
  const t0 = Date.now();
  const events = await runSocietyHours(state, hours, {
    dtHours,
    maxConversationsPerStep: 0,
    maxPlanLlmCallsPerStep: 0,
    maxReactLlmCallsPerStep: 0,
  });
  const elapsedMs = Date.now() - t0;
  const frame = {
    agents: state.agents.map((agent) => ({
      id: agent.id,
      x: agent.x,
      y: agent.y,
      regionId: agent.regionId,
    })),
    events: events.slice(-8),
  };
  let mind: SocietyMind = {
    ...emptyMind(),
    crowd: deriveCrowd(
      state.agents.map((agent) => ({
        id: agent.id,
        name: agent.name,
        occupation: agent.occupation,
        regionId: agent.regionId,
      })),
      crowdN,
    ),
  };
  const crowdT0 = Date.now();
  mind = stepCrowd(mind, [], 1);
  forecastCrowd(mind, 4, 20, 1);
  const crowdForecastMs = Date.now() - crowdT0;
  const steps = Math.max(1, Math.ceil(hours / dtHours));
  return {
    residents,
    crowd: mind.crowd.reduce((sum, cohort) => sum + cohort.size, 0),
    hours,
    steps,
    elapsedMs,
    frameBytes: JSON.stringify(frame).length,
    poseWrites: state.agents.length * steps,
    crowdForecastMs,
    extrapolated24hMs: Math.round((elapsedMs / hours) * 24),
  };
}
