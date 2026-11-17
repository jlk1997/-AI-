/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  DEFAULT_CONTEXT_BUDGET,
  FIX_CONTEXT_BUDGET,
  type ContextBudget,
} from '@opengame/platform-agent';

export function parseContextBudget(): ContextBudget {
  const raw = process.env['PLATFORM_CONTEXT_BUDGET'];
  if (!raw?.trim()) return DEFAULT_CONTEXT_BUDGET;
  try {
    const parsed = JSON.parse(raw) as Partial<ContextBudget>;
    return { ...DEFAULT_CONTEXT_BUDGET, ...parsed };
  } catch {
    return DEFAULT_CONTEXT_BUDGET;
  }
}

/** Lean budget for FIX / self-heal rounds. */
export function parseFixContextBudget(): ContextBudget {
  const raw = process.env['PLATFORM_FIX_CONTEXT_BUDGET'];
  if (!raw?.trim()) return FIX_CONTEXT_BUDGET;
  try {
    const parsed = JSON.parse(raw) as Partial<ContextBudget>;
    return { ...FIX_CONTEXT_BUDGET, ...parsed };
  } catch {
    return FIX_CONTEXT_BUDGET;
  }
}
