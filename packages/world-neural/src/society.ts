/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Society occupancy as a world-model observation.
 *
 * The original MLP predicted combat difficulty knobs — a number nobody could
 * see in the town. This encoder is the social analogue of `encodeWorldState`:
 * where people are, how tightly they are tied, how much they just talked.
 * Train it on consecutive ticks; the residual is curiosity.
 */

import { encodeAction, STATE_DIM } from './encode.js';
import {
  createMlp,
  predictNextState,
  trainMlp,
  type MlpWeights,
} from './mlp.js';

export interface SocietyCrowdObservation {
  readonly hourOfDay: number;
  /** Per-region occupancy, already in [0, 1], region-id order. */
  readonly occupancy: readonly number[];
  readonly meanAffinity: number;
  /** Dialogues this step / population, capped at 1. */
  readonly talkRate: number;
}

export function encodeSocietyCrowd(obs: SocietyCrowdObservation): Float64Array {
  const v = new Float64Array(STATE_DIM);
  v[0] = ((obs.hourOfDay % 24) + 24) % 24 / 24;
  v[1] = Math.min(1, Math.max(0, obs.meanAffinity));
  v[2] = Math.min(1, Math.max(0, obs.talkRate));
  obs.occupancy.slice(0, 16).forEach((n, i) => {
    v[8 + i] = Math.min(1, Math.max(0, n));
  });
  return v;
}

const TICK_ACTION = encodeAction('tick');

export interface SocietyDynamicsFit {
  readonly weights: MlpWeights;
  readonly finalLoss: number;
  readonly surprise: number;
}

/**
 * Fit a tiny MLP on consecutive crowd observations. `surprise` is the L2
 * residual of the last transition — the number a tick should feed curiosity.
 */
export function fitSocietyDynamics(
  sequence: readonly SocietyCrowdObservation[],
  options?: { readonly epochs?: number; readonly lr?: number },
): SocietyDynamicsFit | null {
  if (sequence.length < 3) return null;
  const samples: Array<{ x: number[]; y: number[] }> = [];
  for (let i = 0; i < sequence.length - 1; i++) {
    const obs = encodeSocietyCrowd(sequence[i]!);
    const next = encodeSocietyCrowd(sequence[i + 1]!);
    samples.push({
      x: [...obs, ...TICK_ACTION],
      y: [...next],
    });
  }
  const result = trainMlp(samples, {
    epochs: options?.epochs ?? 12,
    lr: options?.lr ?? 0.05,
    batchSize: Math.min(16, samples.length),
  });
  const last = samples[samples.length - 1]!;
  const pred = predictNextState(
    result.weights,
    last.x.slice(0, STATE_DIM),
    last.x.slice(STATE_DIM),
  );
  let surprise = 0;
  for (let i = 0; i < STATE_DIM; i++) {
    const d = pred[i]! - last.y[i]!;
    surprise += d * d;
  }
  return {
    weights: result.weights,
    finalLoss: result.finalLoss,
    surprise: Math.sqrt(surprise),
  };
}

export function createSocietyDynamicsMlp(): MlpWeights {
  return createMlp(64);
}
