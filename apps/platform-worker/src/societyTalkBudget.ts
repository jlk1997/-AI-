/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Redis hourly MiniMax talk caps. Missing Redis fails open for walking,
 * closed for talks — we would rather stay quiet than burn the key pool.
 */

import {
  SOCIETY_EMERGENCY_BUDGET,
  SOCIETY_TALK_BUDGET,
  grantHourLightBonusOn,
  peekSocietyTalkBudgetOn,
  releaseSocietyTalksOn,
  reserveEmergencyTalkOn,
  reserveSocietyTalksOn,
  settleSocietyTalksOn,
  societyTalkBudgetOpenOn,
  type SocietyTalkBudgetOpts,
  type SocietyTalkBudgetRedis,
  type SocietyTalkBudgetView,
  type SocietyTalkLane,
} from '@opengame/platform-shared';

export type { SocietyTalkBudgetOpts, SocietyTalkBudgetRedis, SocietyTalkLane };

function envCap(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

/** Demo mode is opt-in. Shared budget functions never read env themselves. */
export function demoOpenWorldEnabled(): boolean {
  return process.env['PLATFORM_DEMO_OPEN_WORLD'] === '1';
}

function withDemoOpts(
  opts?: SocietyTalkBudgetOpts,
): SocietyTalkBudgetOpts | undefined {
  if (!demoOpenWorldEnabled()) return opts;
  return { ...opts, openWorld: true };
}

export function societyTalkBudgetCaps(): {
  readonly worldHour: number;
  readonly platformHour: number;
} {
  return {
    worldHour: envCap(
      'PLATFORM_SOCIETY_MAX_LLM_TALKS_PER_WORLD_HOUR',
      SOCIETY_TALK_BUDGET.worldHour,
    ),
    platformHour: envCap(
      'PLATFORM_SOCIETY_MAX_LLM_TALKS_PER_HOUR',
      SOCIETY_TALK_BUDGET.platformHour,
    ),
  };
}

export async function societyTalkBudgetOpen(
  redis: SocietyTalkBudgetRedis | undefined,
  worldId: string,
  now = Date.now(),
  opts?: SocietyTalkBudgetOpts,
): Promise<boolean> {
  if (!redis) return false;
  const caps = societyTalkBudgetCaps();
  try {
    return await societyTalkBudgetOpenOn(
      redis,
      worldId,
      now,
      withDemoOpts(opts),
      caps,
    );
  } catch {
    return false;
  }
}

export async function peekSocietyTalkBudget(
  redis: Pick<SocietyTalkBudgetRedis, 'get'> | undefined,
  worldId: string,
  now = Date.now(),
  opts?: SocietyTalkBudgetOpts,
): Promise<SocietyTalkBudgetView | null> {
  if (!redis) return null;
  const caps = societyTalkBudgetCaps();
  try {
    return await peekSocietyTalkBudgetOn(
      redis as SocietyTalkBudgetRedis,
      worldId,
      now,
      withDemoOpts(opts),
      caps.worldHour,
    );
  } catch {
    return null;
  }
}

export async function recordSocietyTalks(
  redis: SocietyTalkBudgetRedis | undefined,
  worldId: string,
  n: number,
  now = Date.now(),
  opts?: SocietyTalkBudgetOpts,
): Promise<void> {
  if (!redis || n <= 0) return;
  await reserveSocietyTalks(redis, worldId, n, now, opts);
}

export async function reserveSocietyTalks(
  redis: SocietyTalkBudgetRedis | undefined,
  worldId: string,
  n: number,
  now = Date.now(),
  opts?: SocietyTalkBudgetOpts,
): Promise<false | SocietyTalkLane> {
  if (!redis) return false;
  const caps = societyTalkBudgetCaps();
  try {
    return await reserveSocietyTalksOn(
      redis,
      worldId,
      n,
      now,
      withDemoOpts(opts),
      caps,
    );
  } catch {
    return false;
  }
}

export async function releaseSocietyTalks(
  redis: SocietyTalkBudgetRedis | undefined,
  worldId: string,
  n: number,
  now = Date.now(),
  lane: SocietyTalkLane = 'floor',
): Promise<void> {
  if (!redis || n <= 0) return;
  try {
    await releaseSocietyTalksOn(redis, worldId, n, now, lane);
  } catch {
    /* next tick will mute if we cannot count */
  }
}

export async function settleSocietyTalks(
  redis: SocietyTalkBudgetRedis | undefined,
  worldId: string,
  reserved: number,
  talksStarted: number,
  now = Date.now(),
  lane: SocietyTalkLane = 'floor',
  opts?: SocietyTalkBudgetOpts,
): Promise<void> {
  if (!redis) return;
  try {
    await settleSocietyTalksOn(
      redis,
      worldId,
      reserved,
      talksStarted,
      now,
      lane,
      withDemoOpts(opts),
      societyTalkBudgetCaps(),
    );
  } catch {
    /* next tick will mute if we cannot count */
  }
}

export async function grantHourLightBonus(
  redis: SocietyTalkBudgetRedis | undefined,
  worldId: string,
  bonus: number,
  now = Date.now(),
): Promise<number> {
  if (!redis) return 0;
  try {
    return await grantHourLightBonusOn(redis, worldId, bonus, now);
  } catch {
    return 0;
  }
}

export function societyEmergencyTalkCap(): number {
  return envCap(
    'PLATFORM_SOCIETY_EMERGENCY_MAX_PER_HOUR',
    SOCIETY_EMERGENCY_BUDGET.platformHour,
  );
}

/** One expensive-model slot. No Redis → refuse (do not burn Ark unbounded). */
export async function consumeEmergencySocietyTalk(
  redis: SocietyTalkBudgetRedis | undefined,
  now = Date.now(),
): Promise<boolean> {
  if (!redis) return false;
  try {
    return await reserveEmergencyTalkOn(
      redis,
      now,
      societyEmergencyTalkCap(),
    );
  } catch {
    return false;
  }
}
