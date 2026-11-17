/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Online predictor of "where will people be next".
 *
 * A world model is useless if it only exists as a research package nobody
 * consults. This one sits inside the tick: it watches occupancy, predicts the
 * next distribution, and treats the residual as surprise. Surprise is what
 * raises curiosity — a resident whose model of the town just failed will go
 * look, which is the observable effect the old combat-difficulty MLP never had.
 */

import type { SocietyState } from './tick.js';
import { applyCuriositySurprise, type Needs } from './needs.js';

const REGION_SLOTS = 8;

export interface SocietyOccupancy {
  readonly vector: number[];
  readonly regionIds: string[];
  readonly hourOfDay: number;
  readonly meanAffinity: number;
}

export function encodeOccupancy(state: SocietyState): SocietyOccupancy {
  const regionIds = [
    ...new Set([
      ...(state.regionBounds ? [...state.regionBounds.keys()] : []),
      ...state.agents.map((a) => a.regionId),
    ]),
  ].sort();
  const n = Math.max(1, state.agents.length);
  const vector = new Array<number>(REGION_SLOTS).fill(0);
  regionIds.forEach((id, i) => {
    if (i >= REGION_SLOTS) return;
    vector[i] = state.agents.filter((a) => a.regionId === id).length / n;
  });
  let affinity = 0;
  for (const r of state.relations.values()) affinity += r.affinity;
  return {
    vector,
    regionIds,
    hourOfDay: ((state.simTime % 24) + 24) % 24,
    meanAffinity: state.relations.size ? affinity / state.relations.size : 0,
  };
}

function l1(a: readonly number[], b: readonly number[]): number {
  let s = 0;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) s += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
  return s;
}

export interface OccupancyModelSnapshot {
  ema?: number[];
  prev?: number[];
  surprise?: number;
  history?: number[];
}

/**
 * Exponential-moving-average occupancy predictor. No weights file, no training
 * loop: it learns the town it is currently simulating, which is the only town
 * whose surprise can change a resident's afternoon.
 */
export class SocietyTransitionModel {
  private prev: number[] | undefined;
  private ema: number[] | undefined;
  /** Last residual; 0 = the crowd went exactly where we expected. */
  surprise = 0;
  readonly history: number[] = [];

  snapshot(): OccupancyModelSnapshot {
    return {
      ema: this.ema ? [...this.ema] : undefined,
      prev: this.prev ? [...this.prev] : undefined,
      surprise: this.surprise,
      history: [...this.history],
    };
  }

  restore(snap: OccupancyModelSnapshot | null | undefined): void {
    if (!snap) return;
    if (Array.isArray(snap.ema) && snap.ema.length) this.ema = [...snap.ema];
    if (Array.isArray(snap.prev) && snap.prev.length) this.prev = [...snap.prev];
    if (typeof snap.surprise === 'number' && Number.isFinite(snap.surprise)) {
      this.surprise = snap.surprise;
    }
    if (Array.isArray(snap.history)) {
      this.history.splice(
        0,
        this.history.length,
        ...snap.history
          .filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
          .slice(-48),
      );
    }
  }

  observe(state: SocietyState): number {
    const occ = encodeOccupancy(state);
    if (this.ema && this.prev) {
      this.surprise = l1(this.ema, occ.vector);
      this.history.push(this.surprise);
      if (this.history.length > 48) this.history.shift();
    }
    const rate = 0.35;
    if (!this.ema) {
      this.ema = [...occ.vector];
    } else {
      this.ema = this.ema.map(
        (v, i) => v * (1 - rate) + (occ.vector[i] ?? 0) * rate,
      );
    }
    this.prev = [...occ.vector];
    return this.surprise;
  }

  meanSurprise(): number {
    if (!this.history.length) return 0;
    return this.history.reduce((a, b) => a + b, 0) / this.history.length;
  }
}

/** Hydrate the in-tick occupancy predictor from a persisted EMA row. */
export function applyOccupancySnapshot(
  state: { worldModel?: SocietyTransitionModel },
  snap: OccupancyModelSnapshot | null | undefined,
): void {
  if (!snap) return;
  state.worldModel ??= new SocietyTransitionModel();
  state.worldModel.restore(snap);
}

/** Raise curiosity on every resident when the crowd did something unexpected. */
export function applyTownSurprise(
  agents: Array<{ needs: Needs }>,
  surprise: number,
): void {
  if (surprise < 0.12) return;
  for (const a of agents) {
    a.needs = applyCuriositySurprise(a.needs, surprise);
  }
}
