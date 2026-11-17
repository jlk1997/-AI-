/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Crowd cohorts from a population mix, then a small pull toward a survey.
 * One questionnaire does not flip the town; it moves the histogram a step.
 */

import type { CrowdCohort, SocietyMind } from './societyMind.js';

export type DemographicSlice = {
  readonly regionId: string;
  readonly occupation: string;
  readonly ageBand?: string;
  readonly income?: 'low' | 'mid' | 'high' | string;
  readonly weight: number;
};

export type SurveyReading = {
  readonly support: number;
  readonly oppose: number;
  readonly regionId?: string;
  /** 0 keeps the crowd, 1 replaces it. Default is a quarter step. */
  readonly trust?: number;
};

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function histFor(slice: DemographicSlice): [number, number, number, number, number] {
  if (slice.income === 'low') return [18, 28, 34, 14, 6];
  if (slice.income === 'high') return [6, 14, 34, 28, 18];
  if (slice.ageBand === 'elder') return [10, 22, 40, 20, 8];
  if (slice.ageBand === 'youth') return [14, 20, 32, 22, 12];
  return [8, 18, 48, 18, 8];
}

export function cohortsFromDemography(
  slices: readonly DemographicSlice[],
  total = 1500,
): CrowdCohort[] {
  const rows = slices.filter((slice) => slice.weight > 0 && slice.regionId).slice(0, 20);
  const sum = rows.reduce((acc, slice) => acc + slice.weight, 0) || 1;
  const people = Math.max(rows.length, Math.round(total));
  return rows.map((slice) => {
    const age = slice.ageBand ? `·${slice.ageBand}` : '';
    return {
      id: `${slice.regionId}|${slice.occupation}${age}`,
      label: `${slice.occupation}${age}·${slice.regionId}`,
      regionId: slice.regionId,
      occupation: slice.occupation,
      size: Math.max(1, Math.round((people * slice.weight) / sum)),
      hist: histFor(slice),
    };
  });
}

function targetHist(
  support: number,
  oppose: number,
): [number, number, number, number, number] {
  const sup = clamp01(support);
  const opp = clamp01(oppose);
  const rest = Math.max(0, 1 - sup - opp);
  const mass = 100;
  return [
    mass * opp * 0.65,
    mass * opp * 0.35,
    mass * rest,
    mass * sup * 0.35,
    mass * sup * 0.65,
  ];
}

export function calibrateCrowd(mind: SocietyMind, survey: SurveyReading): SocietyMind {
  const trust = clamp01(survey.trust ?? 0.25);
  const target = targetHist(survey.support, survey.oppose);
  return {
    ...mind,
    crowd: mind.crowd.map((cohort) => {
      if (survey.regionId && cohort.regionId !== survey.regionId) return cohort;
      const hist = cohort.hist.map(
        (bin, index) => bin * (1 - trust) + target[index]! * trust,
      ) as [number, number, number, number, number];
      return { ...cohort, hist };
    }),
  };
}
