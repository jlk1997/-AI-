/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * 批次 9：性能预算计时器（perfMarker）。
 *
 * 设计原则：
 * - 不抛错；用 fail-safe 返回值。
 * - 默认 budget 全部硬编码，调用方可覆盖。
 * - 仅同步、轻量；不依赖任何 DOM / window，方便 SSR / node 单测。
 * - 暴露的 hook：`mark(name)` 开始一个标记，`end(name)` 结束并返回 ms；
 *   `checkBudget(name, ms)` 用于硬阈值告警（不抛错，仅返回值）。
 */

export type PerfMarkerBudget = {
  /** 单次操作超过该 ms 则视为超预算。0 表示不限制。 */
  readonly softLimitMs: number;
  /** 单次操作超过该 ms 则视为严重超预算（红色告警）。0 表示不限制。 */
  readonly hardLimitMs: number;
};

const DEFAULT_BUDGETS: Readonly<Record<string, PerfMarkerBudget>> = {
  world_render: { softLimitMs: 800, hardLimitMs: 1500 },
  course_act_calc: { softLimitMs: 50, hardLimitMs: 200 },
  payout_preview: { softLimitMs: 100, hardLimitMs: 300 },
  narrative_render: { softLimitMs: 400, hardLimitMs: 800 },
};

export type PerfSample = {
  readonly name: string;
  readonly durationMs: number;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly softLimitMs: number;
  readonly hardLimitMs: number;
  readonly status: 'ok' | 'soft' | 'hard';
};

/**
 * 创建一个隔离的 marker 集合，避免多个 React 实例互相干扰。
 * 默认预算表可被整体覆盖，便于测试。
 */
export function createPerfMarker(input?: {
  readonly budgets?: Readonly<Record<string, PerfMarkerBudget>>;
}): PerfMarker {
  const budgets = input?.budgets ?? DEFAULT_BUDGETS;
  const starts = new Map<string, number>();
  const samples: PerfSample[] = [];
  return {
    mark(name: string): void {
      starts.set(name, Date.now());
    },
    end(name: string): PerfSample | null {
      const startedAt = starts.get(name);
      if (startedAt == null) return null;
      starts.delete(name);
      const endedAt = Date.now();
      const durationMs = Math.max(0, endedAt - startedAt);
      const budget = budgets[name] ?? { softLimitMs: 0, hardLimitMs: 0 };
      const status: PerfSample['status'] =
        budget.hardLimitMs > 0 && durationMs >= budget.hardLimitMs
          ? 'hard'
          : budget.softLimitMs > 0 && durationMs >= budget.softLimitMs
            ? 'soft'
            : 'ok';
      const sample: PerfSample = {
        name,
        durationMs,
        startedAt,
        endedAt,
        softLimitMs: budget.softLimitMs,
        hardLimitMs: budget.hardLimitMs,
        status,
      };
      samples.push(sample);
      return sample;
    },
    samples(): readonly PerfSample[] {
      return samples;
    },
    budgetFor(name: string): PerfMarkerBudget {
      return budgets[name] ?? { softLimitMs: 0, hardLimitMs: 0 };
    },
  };
}

export type PerfMarker = {
  readonly mark: (name: string) => void;
  readonly end: (name: string) => PerfSample | null;
  readonly samples: () => readonly PerfSample[];
  readonly budgetFor: (name: string) => PerfMarkerBudget;
};

/**
 * 简易包裹：end 后调用回调把 sample 送出去（用于埋点）。
 */
export function withPerfMarker<T>(
  marker: PerfMarker,
  name: string,
  fn: () => T,
): T {
  marker.mark(name);
  try {
    return fn();
  } finally {
    marker.end(name);
  }
}