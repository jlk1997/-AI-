/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Turns a decision into a queued forecast and a first-pass report.
 * The worker replaces the report with a larger sample.
 */

import {
  enqueueForecast,
  finishForecast,
  type DrizzleDb,
} from '@opengame/platform-db';
import {
  contestedDecision,
  exerciseNearHomes,
  nearestCase,
  runEnsemble,
  withExecution,
  type ExecutionMode,
  type ForecastScenario,
} from '@opengame/world-agents';

export type EnsembleBody = {
  readonly title?: string;
  readonly decision?: string;
  readonly execution?: ExecutionMode;
  readonly population?: number;
  readonly grievance?: number;
  readonly legitimacy?: number;
  readonly noticeHours?: number;
  readonly liveFire?: boolean;
  readonly nearResidents?: boolean;
  readonly windowHours?: number;
  readonly medical?: boolean;
  readonly preset?: 'contested' | 'exercise';
};

const MODES: readonly ExecutionMode[] = [
  'negotiate',
  'disperse',
  'sudden',
  'exercise_live',
  'exercise_notice',
];

export function scenarioFromBody(body: EnsembleBody): ForecastScenario {
  const preset = body.preset === 'exercise' ? exerciseNearHomes() : contestedDecision();
  const execution = MODES.includes(body.execution as ExecutionMode)
    ? (body.execution as ExecutionMode)
    : preset.execution;
  return withExecution(
    {
      ...preset,
      title: body.title?.trim() || preset.title,
      decision: body.decision?.trim() || preset.decision,
      population: Math.max(100, Math.min(2_000_000, Math.round(body.population ?? preset.population))),
      grievance: clamp(body.grievance, preset.grievance),
      legitimacy: clamp(body.legitimacy, preset.legitimacy),
      noticeHours: Number.isFinite(body.noticeHours) ? Math.max(0, body.noticeHours ?? 0) : preset.noticeHours,
      liveFire: body.liveFire ?? preset.liveFire,
      nearResidents: body.nearResidents ?? preset.nearResidents,
      medical: body.medical ?? preset.medical,
      windowHours: Math.max(6, Math.min(168, Math.round(body.windowHours ?? preset.windowHours))),
    },
    execution,
  );
}

function clamp(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

export async function submitEnsembleForecast(
  db: DrizzleDb,
  worldId: string,
  body: EnsembleBody,
): Promise<{ runId: string; status: string; report: unknown; preliminary: boolean }> {
  const scenario = scenarioFromBody(body);
  const near = nearestCase({
    grievance: scenario.grievance,
    legitimacy: scenario.legitimacy,
    liveFire: scenario.liveFire,
    noticeHours: scenario.noticeHours,
  });
  const report = await runEnsemble(scenario, {
    seed: worldId.length,
    deepRuns: 0,
    fastRuns: 40,
    llmBudget: 0,
    calibrated: !near.extrapolated,
  });
  const runId = await enqueueForecast(db, worldId, scenario.title, scenario);
  return { runId, status: 'queued', report, preliminary: true };
}

/** Worker pass: larger sample, no live-town budget. */
export async function completeEnsembleForecast(
  db: DrizzleDb,
  runId: string,
  spec: unknown,
): Promise<void> {
  const scenario = scenarioFromBody((spec ?? {}) as EnsembleBody);
  const near = nearestCase({
    grievance: scenario.grievance,
    legitimacy: scenario.legitimacy,
    liveFire: scenario.liveFire,
    noticeHours: scenario.noticeHours,
  });
  const report = await runEnsemble(scenario, {
    seed: runId.length * 17,
    deepRuns: 1,
    fastRuns: 96,
    llmBudget: 0,
    calibrated: !near.extrapolated,
  });
  await finishForecast(db, runId, report);
}
