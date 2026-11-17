/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * One MiniMax factory for live ticks, heartbeat tails and paid 巷议.
 * Route files must not grow their own copy — emergency consume has to stay
 * wired or floor talks can silently hit FALLBACK.
 */

export type SocietyLlmFn = (prompt: string) => Promise<string>;

export async function createOptionalSocietyLlm(options?: {
  readonly timeoutMs?: number;
  readonly lane?: 'floor' | 'lit';
  readonly consumeEmergency?: () => Promise<boolean>;
}): Promise<SocietyLlmFn | undefined> {
  const { createSocietyLlmFn } = await import('@opengame/world-planner');
  return createSocietyLlmFn(options);
}
