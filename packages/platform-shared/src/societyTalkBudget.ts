/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Hard hourly caps so one watched town cannot run MiniMax unbounded.
 * 镇时 is a permit, not an unlimited token card.
 * 点亮世界 raises THIS town's hourly burn without eating other towns' floor.
 */

import { leaseActive, stackPermitUntil } from './societyLease.js';

export const SOCIETY_TALK_BUDGET = {
  worldHour: 1000,
  platformHour: 1200,
} as const;

/** Watched towns try a spoken circle about this often, until the hour cap. */
export const SOCIETY_TALK_SPACING_MIN = 4 / 60;

/** How many circles one walk may start once the spacing has elapsed. */
export const SOCIETY_TALK_SLOTS_PER_WALK = 2;

/** Paid extra talks for one town. Hour pack is this UTC hour only. */
export const SOCIETY_WORLD_LIGHT = {
  hour: { points: 15, bonus: 12, durationMs: 0 },
  day: { points: 40, bonus: 12, durationMs: 86_400_000 },
  week: { points: 160, bonus: 24, durationMs: 7 * 86_400_000 },
} as const;

/**
 * Expensive FALLBACK (Ark / doubao) talks this UTC hour, platform-wide.
 * Lit towns may use emergency after the cheap pool dies. Floor never does.
 */
export const SOCIETY_EMERGENCY_BUDGET = {
  platformHour: 24,
} as const;

export type WorldLightSku = keyof typeof SOCIETY_WORLD_LIGHT;

export type SocietyTalkLane = 'floor' | 'lit';

export function societyTalkHourBucket(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 13);
}

export function societyTalkBudgetKeys(worldId: string, now = Date.now()): {
  readonly world: string;
  readonly platform: string;
  readonly lit: string;
  readonly litCap: string;
} {
  const hour = societyTalkHourBucket(now);
  return {
    world: `society:talks:${worldId}:${hour}`,
    platform: `society:talks:_platform:${hour}`,
    lit: `society:talks:lit:${worldId}:${hour}`,
    litCap: `society:talks:litcap:${worldId}:${hour}`,
  };
}

/** Platform-wide expensive-model slot for this UTC hour. */
export function societyEmergencyTalkKey(now = Date.now()): string {
  return `society:talks:emergency:${societyTalkHourBucket(now)}`;
}

export function societyTalksOverBudget(input: {
  readonly worldUsed: number;
  readonly platformUsed: number;
  readonly worldCap?: number;
  readonly platformCap?: number;
}): boolean {
  const worldCap = input.worldCap ?? SOCIETY_TALK_BUDGET.worldHour;
  const platformCap = input.platformCap ?? SOCIETY_TALK_BUDGET.platformHour;
  return input.worldUsed >= worldCap || input.platformUsed >= platformCap;
}

/**
 * After an atomic INCR: the last slot (`used === cap`) is valid. Only
 * `used > cap` means two callers grabbed more than the hour allows.
 */
export function talkBudgetReserveExceeded(input: {
  readonly worldUsedAfter: number;
  readonly platformUsedAfter: number;
  readonly worldCap?: number;
  readonly platformCap?: number;
}): boolean {
  const worldCap = input.worldCap ?? SOCIETY_TALK_BUDGET.worldHour;
  const platformCap = input.platformCap ?? SOCIETY_TALK_BUDGET.platformHour;
  return input.worldUsedAfter > worldCap || input.platformUsedAfter > platformCap;
}

export function activeLightBonus(
  until: Date | string | null | undefined,
  bonusPerHour: number | null | undefined,
  now = Date.now(),
): number {
  if (!leaseActive(until, now)) return 0;
  const n = Math.floor(Number(bonusPerHour) || 0);
  return n > 0 ? n : 0;
}

export function societyTalkHourBonus(input: {
  readonly leaseBonus?: number;
  readonly hourPackBonus?: number;
}): number {
  return (
    Math.max(0, Math.floor(input.leaseBonus ?? 0)) +
    Math.max(0, Math.floor(input.hourPackBonus ?? 0))
  );
}

export function stackWorldLight(input: {
  readonly sku: WorldLightSku;
  readonly currentUntil?: Date | string | null;
  readonly currentBonus?: number | null;
  readonly now?: number;
}): {
  readonly until: Date | null;
  readonly bonusPerHour: number;
  readonly hourPackBonus: number;
} {
  const offer = SOCIETY_WORLD_LIGHT[input.sku];
  const currentBonus = Math.max(0, Math.floor(Number(input.currentBonus) || 0));
  if (offer.durationMs <= 0) {
    const raw = input.currentUntil;
    const until =
      raw == null
        ? null
        : raw instanceof Date
          ? raw
          : new Date(raw);
    return {
      until,
      bonusPerHour: currentBonus,
      hourPackBonus: offer.bonus,
    };
  }
  const now = new Date(input.now ?? Date.now());
  const raw = input.currentUntil;
  const currentUntil =
    raw == null ? null : raw instanceof Date ? raw : new Date(raw);
  return {
    until: stackPermitUntil(currentUntil, now, offer.durationMs),
    bonusPerHour: Math.max(currentBonus, offer.bonus),
    hourPackBonus: 0,
  };
}

export function parseWorldLightSku(raw: unknown): WorldLightSku {
  if (raw === 'week' || raw === 'day' || raw === 'hour') return raw;
  return 'hour';
}

/** Author-paid 点亮 / tip stack. While this lease is live, 36/80 must not mute. */
export function authorFundingOpen(
  litUntil: Date | string | null | undefined,
  now = Date.now(),
): boolean {
  return leaseActive(litUntil, now);
}

/** Lease or this-hour pack. Free 36/80 is not a talk switch. */
export function talkFundingOpen(input: {
  readonly litUntil?: Date | string | null;
  readonly litBonus?: number;
  readonly now?: number;
}): boolean {
  if (authorFundingOpen(input.litUntil, input.now)) return true;
  return Math.max(0, Math.floor(input.litBonus ?? 0)) > 0;
}

/** Visitor 打赏 stacks the same world `lightUntil`. */
export function tipExtendsLightMs(points: number): number {
  const n = Math.max(0, Math.round(points));
  if (n >= 30) return 12 * 60 * 60 * 1000;
  if (n >= 12) return 3 * 60 * 60 * 1000;
  if (n >= 5) return 60 * 60 * 1000;
  return Math.max(15 * 60 * 1000, n * 12 * 60 * 1000);
}

/** Lit towns (lease, hour pack, or this beat’s lit bucket) use the paid key lane. */
export function pickSocietyLlmLane(input: {
  readonly reserved?: SocietyTalkLane | false | null;
  readonly litBonus?: number;
  readonly litUntil?: Date | string | null;
  readonly leaseBonus?: number | null;
  readonly now?: number;
}): SocietyTalkLane {
  if (input.reserved === 'lit') return 'lit';
  if ((input.litBonus ?? 0) > 0) return 'lit';
  if (activeLightBonus(input.litUntil, input.leaseBonus, input.now) > 0) {
    return 'lit';
  }
  return 'floor';
}

/** Next UTC hour after the current talk-budget bucket. */
export function societyTalkHourResetsAt(now = Date.now()): string {
  const hour = societyTalkHourBucket(now);
  const start = Date.parse(`${hour}:00:00.000Z`);
  const t = Number.isFinite(start) ? start + 3_600_000 : now + 3_600_000;
  return new Date(t).toISOString();
}

/** Minutes until the current UTC talk-budget hour rolls over. */
export function societyTalkMinutesLeftInHour(now = Date.now()): number {
  const resets = Date.parse(societyTalkHourResetsAt(now));
  if (!Number.isFinite(resets)) return 60;
  return Math.max(0, (resets - now) / 60_000);
}

/**
 * How many MiniMax talks this walk may start.
 *
 * A watched town may start two circles about every 4 seconds. The hourly cap
 * is high enough for a live demo and still stops an unattended runaway.
 * An open stake board skips the wait so evidence can land.
 */
export function pacedTalkSlotsThisWalk(input: {
  readonly remaining: number;
  readonly minutesLeftInHour: number;
  readonly pending: number;
  /** Wall-clock minutes since this world last reserved a talk. */
  readonly minutesSinceLastTalk?: number;
  /** Heartbeat interval in minutes. Default matches a 3s walk. */
  readonly walkIntervalMinutes?: number;
  /** Open or closed board with live stakes — do not starve evidence. */
  readonly keepAlive?: boolean;
}): number {
  const remaining = Math.max(0, Math.floor(input.remaining));
  const pending = Math.max(0, Math.floor(input.pending));
  if (remaining <= 0 || pending <= 0) return 0;
  const slots = Math.min(SOCIETY_TALK_SLOTS_PER_WALK, pending, remaining);
  if (input.keepAlive) return slots;
  const minutes = Math.max(0.05, input.minutesLeftInHour);
  const walkMin = Math.max(0.008, input.walkIntervalMinutes ?? 0.05);
  const fairSpacing = Math.min(minutes / remaining, SOCIETY_TALK_SPACING_MIN);
  // Hour almost over: spend leftovers so they do not expire unused.
  if (fairSpacing <= walkMin * 1.5) return slots;
  const since = input.minutesSinceLastTalk;
  if (since == null) return slots;
  if (since + 1e-6 < fairSpacing * 0.9) return 0;
  return slots;
}

/** Live towns with an open stake go first so evidence is not starved. */
export function orderLiveWorldsForCourse<T extends { readonly id: string }>(
  worlds: readonly T[],
  keepAliveIds: ReadonlySet<string>,
): T[] {
  if (keepAliveIds.size === 0) return [...worlds];
  return [...worlds].sort((a, b) => {
    const ap = keepAliveIds.has(a.id) ? 0 : 1;
    const bp = keepAliveIds.has(b.id) ? 0 : 1;
    return ap - bp;
  });
}

export const SOCIETY_TALK_TTL_SEC = 2 * 3600;

export type SocietyTalkBudgetRedis = {
  get(key: string): Promise<string | null>;
  incrby(key: string, increment: number): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
  /** Present on ioredis. Used so reserve/release/emergency stay atomic. */
  eval?(
    script: string,
    numKeys: number,
    ...args: Array<string | number>
  ): Promise<unknown>;
};

/** Atomic floor-then-lit reserve. Tagged so in-memory tests can dispatch. */
export const RESERVE_TALKS_SCRIPT = `
-- og:society_reserve_talks
local count = tonumber(ARGV[1])
local worldCap = tonumber(ARGV[2])
local platformCap = tonumber(ARGV[3])
local leaseBonus = tonumber(ARGV[4])
local ttl = tonumber(ARGV[5])
local function bump(key, n)
  local after = redis.call('INCRBY', key, n)
  redis.call('EXPIRE', key, ttl)
  return after
end
local worldUsed = bump(KEYS[1], count)
local platUsed = bump(KEYS[2], count)
if worldUsed <= worldCap and platUsed <= platformCap then
  return 'floor'
end
redis.call('INCRBY', KEYS[1], -count)
redis.call('INCRBY', KEYS[2], -count)
local hourPack = tonumber(redis.call('GET', KEYS[4]) or '0')
if hourPack < 0 then hourPack = 0 end
if leaseBonus < 0 then leaseBonus = 0 end
local bonus = hourPack + leaseBonus
if bonus <= 0 then return 'none' end
local litUsed = bump(KEYS[3], count)
if litUsed <= bonus then return 'lit' end
redis.call('INCRBY', KEYS[3], -count)
return 'none'
`;

/** Clamp DECR so a double-settle or hour-boundary miss cannot mint extra slots. */
export const RELEASE_TALKS_SCRIPT = `
-- og:society_release_talks
local n = tonumber(ARGV[1])
if n <= 0 then return 0 end
for i = 1, #KEYS do
  local cur = tonumber(redis.call('GET', KEYS[i]) or '0')
  if cur > 0 then
    redis.call('INCRBY', KEYS[i], -math.min(cur, n))
  end
end
return 1
`;

export const RESERVE_EMERGENCY_SCRIPT = `
-- og:society_reserve_emergency
local cap = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])
if cap <= 0 then return 0 end
local after = redis.call('INCRBY', KEYS[1], 1)
redis.call('EXPIRE', KEYS[1], ttl)
if after <= cap then return 1 end
redis.call('INCRBY', KEYS[1], -1)
return 0
`;

export type SocietyTalkBudgetOpts = {
  readonly leaseBonus?: number;
  readonly litUntil?: Date | string | null;
  /**
   * Demo open world: talks are allowed without 点亮, but they still count
   * against the hourly world/platform caps. Callers set this from env;
   * this package does not read process.env.
   */
  readonly openWorld?: boolean;
};

async function readCount(
  redis: SocietyTalkBudgetRedis,
  key: string,
): Promise<number> {
  const raw = await redis.get(key);
  const n = Number(raw ?? 0);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

export async function resolveTalkHourBonus(
  redis: SocietyTalkBudgetRedis,
  worldId: string,
  now: number,
  opts: SocietyTalkBudgetOpts | undefined,
): Promise<number> {
  const keys = societyTalkBudgetKeys(worldId, now);
  const hourPack = await readCount(redis, keys.litCap);
  const lease = activeLightBonus(opts?.litUntil, opts?.leaseBonus, now);
  return societyTalkHourBonus({ leaseBonus: lease, hourPackBonus: hourPack });
}

export async function peekSocietyTalkBudgetOn(
  redis: SocietyTalkBudgetRedis,
  worldId: string,
  now: number,
  opts: SocietyTalkBudgetOpts | undefined,
  floorCap: number,
): Promise<SocietyTalkBudgetView> {
  const keys = societyTalkBudgetKeys(worldId, now);
  const [floorUsed, litUsed, bonus] = await Promise.all([
    readCount(redis, keys.world),
    readCount(redis, keys.lit),
    resolveTalkHourBonus(redis, worldId, now, opts),
  ]);
  const until = opts?.litUntil
    ? opts.litUntil instanceof Date
      ? opts.litUntil.toISOString()
      : String(opts.litUntil)
    : null;
  const funded = authorFundingOpen(opts?.litUntil, now);
  if (opts?.openWorld && !funded) {
    return societyTalkBudgetView({
      worldUsed: floorUsed,
      worldCap: floorCap,
      now,
      litBonus: 0,
      litUntil: null,
      openWorld: true,
    });
  }
  if (!funded) {
    return societyTalkBudgetView({
      worldUsed: litUsed,
      worldCap: bonus,
      now,
      litBonus: bonus,
      litUntil: null,
    });
  }
  return societyTalkBudgetView({
    worldUsed: floorUsed + litUsed,
    worldCap: floorCap + bonus,
    now,
    litBonus: bonus,
    litUntil: until,
  });
}

export async function societyTalkBudgetOpenOn(
  redis: SocietyTalkBudgetRedis,
  worldId: string,
  now: number,
  opts: SocietyTalkBudgetOpts | undefined,
  caps: { readonly worldHour: number; readonly platformHour: number },
): Promise<boolean> {
  if (caps.worldHour <= 0 || caps.platformHour <= 0) return false;
  if (authorFundingOpen(opts?.litUntil, now)) return true;
  if (opts?.openWorld) {
    const keys = societyTalkBudgetKeys(worldId, now);
    const [worldUsed, platUsed] = await Promise.all([
      readCount(redis, keys.world),
      readCount(redis, keys.platform),
    ]);
    return worldUsed < caps.worldHour && platUsed < caps.platformHour;
  }
  const keys = societyTalkBudgetKeys(worldId, now);
  const [litUsed, bonus] = await Promise.all([
    readCount(redis, keys.lit),
    resolveTalkHourBonus(redis, worldId, now, opts),
  ]);
  return bonus > 0 && litUsed < bonus;
}

async function bump(
  redis: SocietyTalkBudgetRedis,
  key: string,
  n: number,
): Promise<number> {
  const after = await redis.incrby(key, n);
  if (n > 0) await redis.expire(key, SOCIETY_TALK_TTL_SEC);
  return after;
}

async function decrFloor(
  redis: SocietyTalkBudgetRedis,
  key: string,
  n: number,
): Promise<void> {
  const dec = Math.max(0, Math.floor(n));
  if (dec <= 0) return;
  if (redis.eval) {
    await redis.eval(RELEASE_TALKS_SCRIPT, 1, key, dec);
    return;
  }
  const cur = await readCount(redis, key);
  const take = Math.min(cur, dec);
  if (take > 0) await redis.incrby(key, -take);
}

export async function reserveSocietyTalksOn(
  redis: SocietyTalkBudgetRedis,
  worldId: string,
  n: number,
  now: number,
  opts: SocietyTalkBudgetOpts | undefined,
  caps: { readonly worldHour: number; readonly platformHour: number },
): Promise<false | SocietyTalkLane> {
  const count = Math.floor(n);
  if (count === 0) return 'floor';
  if (count < 0) {
    await releaseSocietyTalksOn(redis, worldId, -count, now, 'floor');
    return 'floor';
  }
  if (caps.worldHour <= 0 || caps.platformHour <= 0) return false;
  if (authorFundingOpen(opts?.litUntil, now)) return 'lit';
  if (opts?.openWorld) {
    const keys = societyTalkBudgetKeys(worldId, now);
    const worldUsed = await bump(redis, keys.world, count);
    const platUsed = await bump(redis, keys.platform, count);
    if (worldUsed <= caps.worldHour && platUsed <= caps.platformHour) {
      return 'floor';
    }
    await decrFloor(redis, keys.world, count);
    await decrFloor(redis, keys.platform, count);
    return false;
  }
  const keys = societyTalkBudgetKeys(worldId, now);
  const bonus = await resolveTalkHourBonus(redis, worldId, now, opts);
  if (bonus <= 0) return false;
  const litUsed = await bump(redis, keys.lit, count);
  if (litUsed <= bonus) return 'lit';
  await decrFloor(redis, keys.lit, count);
  return false;
}

export async function releaseSocietyTalksOn(
  redis: SocietyTalkBudgetRedis,
  worldId: string,
  n: number,
  now: number,
  lane: SocietyTalkLane = 'floor',
): Promise<void> {
  if (n <= 0) return;
  const keys = societyTalkBudgetKeys(worldId, now);
  if (lane === 'lit') {
    await decrFloor(redis, keys.lit, n);
    return;
  }
  if (redis.eval) {
    await redis.eval(RELEASE_TALKS_SCRIPT, 2, keys.world, keys.platform, n);
    return;
  }
  await decrFloor(redis, keys.world, n);
  await decrFloor(redis, keys.platform, n);
}

export async function settleSocietyTalksOn(
  redis: SocietyTalkBudgetRedis,
  worldId: string,
  reserved: number,
  talksStarted: number,
  now: number,
  lane: SocietyTalkLane = 'floor',
  opts?: SocietyTalkBudgetOpts,
  caps?: { readonly worldHour: number; readonly platformHour: number },
): Promise<void> {
  const extra = Math.floor(talksStarted) - Math.floor(reserved);
  if (extra > 0) {
    await reserveSocietyTalksOn(
      redis,
      worldId,
      extra,
      now,
      opts,
      caps ?? SOCIETY_TALK_BUDGET,
    );
  }
  if (extra < 0) {
    await releaseSocietyTalksOn(redis, worldId, -extra, now, lane);
  }
}

export async function grantHourLightBonusOn(
  redis: SocietyTalkBudgetRedis,
  worldId: string,
  bonus: number,
  now = Date.now(),
): Promise<number> {
  const n = Math.max(0, Math.floor(bonus));
  if (n <= 0) return 0;
  const keys = societyTalkBudgetKeys(worldId, now);
  const after = await bump(redis, keys.litCap, n);
  return after;
}

export async function peekEmergencyTalkOn(
  redis: SocietyTalkBudgetRedis,
  now = Date.now(),
  cap: number = SOCIETY_EMERGENCY_BUDGET.platformHour,
): Promise<{ readonly used: number; readonly cap: number; readonly remaining: number }> {
  const used = await readCount(redis, societyEmergencyTalkKey(now));
  const limit = Math.max(0, Math.floor(cap));
  return { used, cap: limit, remaining: Math.max(0, limit - used) };
}

/**
 * Take one expensive-model slot. Last slot (`used === cap`) is valid.
 * Fail closed: cap 0 or Redis error is the caller's problem.
 */
export async function reserveEmergencyTalkOn(
  redis: SocietyTalkBudgetRedis,
  now = Date.now(),
  cap: number = SOCIETY_EMERGENCY_BUDGET.platformHour,
): Promise<boolean> {
  const limit = Math.max(0, Math.floor(cap));
  if (limit <= 0) return false;
  const key = societyEmergencyTalkKey(now);
  if (redis.eval) {
    const out = await redis.eval(
      RESERVE_EMERGENCY_SCRIPT,
      1,
      key,
      limit,
      SOCIETY_TALK_TTL_SEC,
    );
    return Number(out) === 1;
  }
  const after = await bump(redis, key, 1);
  if (after <= limit) return true;
  await decrFloor(redis, key, 1);
  return false;
}

export type SocietyTalkBudgetView = {
  readonly used: number;
  readonly cap: number;
  readonly remaining: number;
  readonly resetsAt: string;
  readonly litBonus: number;
  readonly litUntil: string | null;
};

/** World remaining only — never leak the platform-wide counter. */
export function societyTalkBudgetView(input: {
  readonly worldUsed: number;
  readonly worldCap?: number;
  readonly now?: number;
  readonly litBonus?: number;
  readonly litUntil?: string | null;
  /** Count remaining against the cap instead of the paid-lease floor. */
  readonly openWorld?: boolean;
}): SocietyTalkBudgetView {
  const litBonus = Math.max(0, Math.floor(input.litBonus ?? 0));
  const cap = Math.max(
    0,
    Math.floor(input.worldCap ?? SOCIETY_TALK_BUDGET.worldHour + litBonus),
  );
  const used = Math.max(0, Math.floor(Number(input.worldUsed) || 0));
  const rawRemaining = Math.max(0, cap - used);
  // Lease: skip 36/80 mute. Open world: count the cap. Hour pack: paid bonus.
  const remaining = authorFundingOpen(input.litUntil, input.now)
    ? Math.max(rawRemaining, SOCIETY_TALK_BUDGET.worldHour)
    : input.openWorld
      ? rawRemaining
      : litBonus > 0
        ? Math.min(rawRemaining, litBonus)
        : 0;
  return {
    used,
    cap,
    remaining,
    resetsAt: societyTalkHourResetsAt(input.now),
    litBonus,
    litUntil: input.litUntil ?? null,
  };
}
