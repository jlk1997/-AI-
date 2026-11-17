/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Quality numbers for a town that is supposed to change its mind.
 */

import type { SocietyEvent } from './tick.js';

export type OpinionDynamicsScore = {
  readonly stanceDiversity: number;
  readonly outcomeRate: number;
  readonly repeatRate: number;
  readonly diffusionHours: number | null;
};

export function scoreOpinionDynamics(input: {
  readonly events: readonly SocietyEvent[];
  readonly stances?: readonly number[];
  readonly awareRateByHour?: ReadonlyArray<{ readonly hour: number; readonly rate: number }>;
}): OpinionDynamicsScore {
  const talks = input.events.filter(
    (event) => event.kind === 'dialogue' && event.payload['skipped'] !== true,
  );
  const withOutcomes = talks.filter((event) => event.payload['outcomes']);
  const lines = talks.flatMap((event) => {
    const turns = event.payload['turns'];
    if (!Array.isArray(turns)) {
      const summary = event.payload['summary'];
      return typeof summary === 'string' ? [summary] : [];
    }
    return turns
      .map((turn) =>
        turn && typeof turn === 'object' && typeof (turn as { text?: unknown }).text === 'string'
          ? (turn as { text: string }).text
          : '',
      )
      .filter(Boolean);
  });
  const unique = new Set(lines.map((line) => line.replace(/\s+/g, '').slice(0, 48)));
  const stanceSet = new Set((input.stances ?? []).map((n) => Math.round(n)));
  const span = stanceSet.size === 0 ? 0 : Math.min(1, (stanceSet.size - 1) / 4);
  const crossed = (input.awareRateByHour ?? []).find((row) => row.rate >= 0.5);
  return {
    stanceDiversity: span,
    outcomeRate: talks.length ? withOutcomes.length / talks.length : 0,
    repeatRate: lines.length ? 1 - unique.size / lines.length : 0,
    diffusionHours: crossed ? crossed.hour : null,
  };
}
