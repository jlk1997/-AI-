/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * 批次 9：可访问性 (A11y) 工具。
 * 仅做轻量字符串拼接，不引入 DOM 类型，方便 platform-shared 在 node 单测里跑。
 *
 * 关键原则：
 * - 不修改 React 组件，只为组件提供 aria-* 文案。
 * - 所有 label 默认 i18n key 由调用方解析，本文件只返回结构化数据。
 */

export type ProgressStep = {
  readonly index: number;
  readonly labelKey: string;
  readonly state: 'done' | 'active' | 'pending';
};

export type ProgressDescriptor = {
  readonly currentIndex: number;
  readonly totalSteps: number;
  readonly stepLabelKey: string;
  readonly statusLabelKey: string;
  readonly groupAriaLabel: string;
  readonly steps: readonly ProgressStep[];
};

/**
 * 把 5 幕进度条描述成可朗读的 progressbar。
 *
 * - groupAriaLabel 走 i18n key，由组件 `useT()` 翻译。
 * - aria-valuenow 范围 [1, totalSteps]，aria-valuemin=1，aria-valuemax=totalSteps。
 */
export function describeProgressBar(input: {
  readonly currentIndex: number;
  readonly totalSteps: number;
  readonly stepLabelKey: string;
  readonly statusLabelKey: string;
  readonly groupAriaLabel: string;
}): ProgressDescriptor {
  const total = Math.max(1, Math.floor(input.totalSteps));
  const current = clamp(Math.floor(input.currentIndex), 1, total);
  const steps: ProgressStep[] = [];
  for (let i = 1; i <= total; i++) {
    steps.push({
      index: i,
      labelKey: input.stepLabelKey,
      state: i < current ? 'done' : i === current ? 'active' : 'pending',
    });
  }
  return {
    currentIndex: current,
    totalSteps: total,
    stepLabelKey: input.stepLabelKey,
    statusLabelKey: input.statusLabelKey,
    groupAriaLabel: input.groupAriaLabel,
    steps,
  };
}

export type LiveRegionMessage = {
  readonly messageKey: string;
  readonly politeness: 'polite' | 'assertive';
  readonly vars?: Readonly<Record<string, string | number>>;
};

/**
 * Live region 公告：
 * - polite：常态进度变化（act 切换、刷新成功）。
 * - assertive：错误、堵盘、限额命中（必须打断屏幕阅读器）。
 */
export function announceProgress(input: {
  readonly messageKey: string;
  readonly severity: 'info' | 'success' | 'warn' | 'error';
}): LiveRegionMessage {
  const politeness: LiveRegionMessage['politeness'] =
    input.severity === 'error' || input.severity === 'warn'
      ? 'assertive'
      : 'polite';
  return {
    messageKey: input.messageKey,
    politeness,
  };
}

/**
 * Focus trap 用的 keydown 判断 helper。返回 true 表示按下 Esc 时应退出 trap。
 * 平台 component 可以用这个保证弹窗关闭行为一致。
 */
export function shouldDismissOnEscape(
  event: { readonly key: string },
): boolean {
  return event.key === 'Escape';
}

function clamp(n: number, lo: number, hi: number): number {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}