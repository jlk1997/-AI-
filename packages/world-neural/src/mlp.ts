/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tiny 2-layer MLP in pure TypeScript — trains without PyTorch so anyone can
 * run dynamics learning in Node. Weights export to JSON for Python/ONNX upgrade.
 */

import { ACTION_DIM, STATE_DIM } from './encode.js';

export interface MlpWeights {
  readonly inputDim: number;
  readonly hiddenDim: number;
  readonly outputDim: number;
  readonly W1: number[];
  readonly b1: number[];
  readonly W2: number[];
  readonly b2: number[];
}

function randn(): number {
  // Box-Muller
  const u = 1 - Math.random();
  const v = 1 - Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function relu(x: number): number {
  return x > 0 ? x : 0;
}

export function createMlp(hiddenDim = 128): MlpWeights {
  const inputDim = STATE_DIM + ACTION_DIM;
  const outputDim = STATE_DIM;
  const scale1 = Math.sqrt(2 / inputDim);
  const scale2 = Math.sqrt(2 / hiddenDim);
  const W1: number[] = [];
  const b1: number[] = [];
  const W2: number[] = [];
  const b2: number[] = [];
  for (let i = 0; i < hiddenDim * inputDim; i++) W1.push(randn() * scale1);
  for (let i = 0; i < hiddenDim; i++) b1.push(0);
  for (let i = 0; i < outputDim * hiddenDim; i++) W2.push(randn() * scale2);
  for (let i = 0; i < outputDim; i++) b2.push(0);
  return { inputDim, hiddenDim, outputDim, W1, b1, W2, b2 };
}

export function forward(
  weights: MlpWeights,
  x: Float64Array | number[],
): { hidden: Float64Array; out: Float64Array } {
  const hidden = new Float64Array(weights.hiddenDim);
  for (let h = 0; h < weights.hiddenDim; h++) {
    let s = weights.b1[h]!;
    for (let i = 0; i < weights.inputDim; i++) {
      s += weights.W1[h * weights.inputDim + i]! * x[i]!;
    }
    hidden[h] = relu(s);
  }
  const out = new Float64Array(weights.outputDim);
  for (let o = 0; o < weights.outputDim; o++) {
    let s = weights.b2[o]!;
    for (let h = 0; h < weights.hiddenDim; h++) {
      s += weights.W2[o * weights.hiddenDim + h]! * hidden[h]!;
    }
    out[o] = s;
  }
  return { hidden, out };
}

export interface TrainSample {
  readonly x: number[];
  readonly y: number[];
}

export interface TrainResult {
  readonly weights: MlpWeights;
  readonly losses: number[];
  readonly finalLoss: number;
}

/**
 * Mini-batch SGD training. Pure JS — swap for PyTorch RSSM later via same JSONL.
 */
export function trainMlp(
  samples: readonly TrainSample[],
  options?: {
    readonly epochs?: number;
    readonly lr?: number;
    readonly batchSize?: number;
    readonly hiddenDim?: number;
    readonly seedWeights?: MlpWeights;
  },
): TrainResult {
  const epochs = options?.epochs ?? 40;
  const lr = options?.lr ?? 0.01;
  const batchSize = options?.batchSize ?? 32;
  const weights = options?.seedWeights
    ? structuredClone(options.seedWeights)
    : createMlp(options?.hiddenDim ?? 128);
  const losses: number[] = [];

  // Mutable copies for training
  const W1 = weights.W1.slice();
  const b1 = weights.b1.slice();
  const W2 = weights.W2.slice();
  const b2 = weights.b2.slice();
  const mutable: MlpWeights = {
    ...weights,
    W1,
    b1,
    W2,
    b2,
  };

  for (let ep = 0; ep < epochs; ep++) {
    // shuffle indices
    const idx = samples.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [idx[i], idx[j]] = [idx[j]!, idx[i]!];
    }
    let epLoss = 0;
    let n = 0;
    for (let start = 0; start < idx.length; start += batchSize) {
      const batch = idx.slice(start, start + batchSize);
      // accumulate grads
      const gW1 = new Float64Array(W1.length);
      const gb1 = new Float64Array(b1.length);
      const gW2 = new Float64Array(W2.length);
      const gb2 = new Float64Array(b2.length);

      for (const si of batch) {
        const sample = samples[si]!;
        const x = sample.x;
        const y = sample.y;
        const { hidden, out } = forward(mutable, x);
        // dL/dout = 2/D (out - y)
        const dout = new Float64Array(mutable.outputDim);
        for (let o = 0; o < mutable.outputDim; o++) {
          const err = out[o]! - y[o]!;
          dout[o] = (2 / mutable.outputDim) * err;
          epLoss += err * err;
        }
        n += 1;
        // backprop W2, b2
        const dhidden = new Float64Array(mutable.hiddenDim);
        for (let o = 0; o < mutable.outputDim; o++) {
          gb2[o]! += dout[o]!;
          for (let h = 0; h < mutable.hiddenDim; h++) {
            gW2[o * mutable.hiddenDim + h]! += dout[o]! * hidden[h]!;
            dhidden[h]! += dout[o]! * W2[o * mutable.hiddenDim + h]!;
          }
        }
        // relu'
        for (let h = 0; h < mutable.hiddenDim; h++) {
          if (hidden[h]! <= 0) dhidden[h] = 0;
        }
        for (let h = 0; h < mutable.hiddenDim; h++) {
          gb1[h]! += dhidden[h]!;
          for (let i = 0; i < mutable.inputDim; i++) {
            gW1[h * mutable.inputDim + i]! += dhidden[h]! * x[i]!;
          }
        }
      }

      const inv = 1 / Math.max(1, batch.length);
      for (let i = 0; i < W1.length; i++) W1[i]! -= lr * gW1[i]! * inv;
      for (let i = 0; i < b1.length; i++) b1[i]! -= lr * gb1[i]! * inv;
      for (let i = 0; i < W2.length; i++) W2[i]! -= lr * gW2[i]! * inv;
      for (let i = 0; i < b2.length; i++) b2[i]! -= lr * gb2[i]! * inv;
    }
    losses.push(epLoss / Math.max(1, n * mutable.outputDim));
  }

  return {
    weights: mutable,
    losses,
    finalLoss: losses[losses.length - 1] ?? Infinity,
  };
}

export function predictNextState(
  weights: MlpWeights,
  state: Float64Array | number[],
  action: Float64Array | number[],
): Float64Array {
  const x = new Float64Array(STATE_DIM + ACTION_DIM);
  for (let i = 0; i < STATE_DIM; i++) x[i] = state[i] ?? 0;
  for (let i = 0; i < ACTION_DIM; i++) x[STATE_DIM + i] = action[i] ?? 0;
  return forward(weights, x).out;
}

export function serializeWeights(weights: MlpWeights): string {
  return JSON.stringify(weights);
}

export function deserializeWeights(json: string): MlpWeights {
  return JSON.parse(json) as MlpWeights;
}
