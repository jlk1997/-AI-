/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * 每日额度限制（批次 7 + 批次 10）。
 *
 * 用 Redis 计数器 + 1 天 TTL。key 形 = `{prefix}:{orgId}:{YYYY-MM-DD}`。
 * Redis 不可用时**直接放行**——不挡正常流量；只在最严苛的全局故障场景再降级。
 *
 * 批次 10 新增按 plan 分级：free=1 / pro=5 / studio=20。
 * 单个 quota 名空间（如 `narrative-refresh`）可被多个 plan 调用同一份实现。
 */

import type { Redis } from 'ioredis';

export type DailyCapDecision =
  | { readonly ok: true; readonly count: number; readonly limit: number; readonly plan: PlanTier }
  | { readonly ok: false; readonly count: number; readonly limit: number; readonly resetAt: string; readonly plan: PlanTier };

export type PlanTier = 'free' | 'pro' | 'studio' | 'unknown';

/** plan → 默认每日 quota。环境变量可覆盖：`NARRATIVE_REFRESH_DAILY_CAP_PRO` 等。 */
export const DEFAULT_PLAN_DAILY_CAPS: Readonly<Record<Exclude<PlanTier, 'unknown'>, number>> = {
  free: 1,
  pro: 5,
  studio: 20,
};

export async function checkAndIncrementDailyCap(input: {
  readonly redis: Redis | null;
  readonly prefix: string;
  readonly organizationId: string;
  readonly limit: number;
  readonly now?: Date;
  /** 批次 10：调用方提供的 plan 信息，便于 ops 看出是哪个 plan 命中限额。 */
  readonly plan?: PlanTier;
}): Promise<DailyCapDecision> {
  const now = input.now ?? new Date();
  const dateKey = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const key = `${input.prefix}:${input.organizationId}:${dateKey}`;
  const limit = Math.max(0, Math.floor(input.limit));
  const plan = input.plan ?? 'unknown';
  const resetAt = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  ).toISOString();

  if (!input.redis) {
    // Redis 不可用：放行（fail-open），但记一个标记便于监控识别
    return { ok: true, count: 0, limit, plan };
  }

  try {
    const newCount = await input.redis.incr(key);
    if (newCount === 1) {
      // 仅首次设过期；避免原子 race 时丢 expire
      await input.redis.expire(key, 24 * 60 * 60);
    }
    if (newCount > limit) {
      return { ok: false, count: newCount, limit, resetAt, plan };
    }
    return { ok: true, count: newCount, limit, plan };
  } catch {
    return { ok: true, count: 0, limit, plan };
  }
}

export function dailyCapForEnv(
  envName: string | undefined,
  defaultCap: number,
): number {
  // dev / test 环境：放大上限，避免本地开发被打回
  if (envName === 'development' || envName === 'test') {
    return Math.max(defaultCap * 100, defaultCap);
  }
  return defaultCap;
}

/**
 * 批次 10：把"该 quota 名空间 × 该 plan"的最终上限解出来。
 * 顺序：
 *   1) `{PREFIX}_{PLAN}` 环境变量（如 `NARRATIVE_REFRESH_DAILY_CAP_PRO`）。
 *   2) `{PREFIX}_DAILY_CAP` 全局覆盖。
 *   3) `DEFAULT_PLAN_DAILY_CAPS[plan]`。
 *   4) 未知 plan → free 的下限（保守），避免误给无限额。
 */
export function resolvePlanDailyCap(input: {
  readonly quotaNamespace: string;
  readonly plan: PlanTier;
  readonly env?: NodeJS.ProcessEnv;
}): number {
  const env: NodeJS.ProcessEnv = input.env ?? process.env;
  const planKey = input.plan === 'unknown' ? 'free' : input.plan;
  const planUpper = planKey.toUpperCase();
  const namespaceEnv = input.quotaNamespace.toUpperCase().replace(/-/g, '_');
  const perPlanKey = `${namespaceEnv}_DAILY_CAP_${planUpper}`;
  const globalKey = `${namespaceEnv}_DAILY_CAP`;
  const nodeEnv = env.NODE_ENV;
  const fromEnv = readIntEnv(env[perPlanKey]);
  if (fromEnv != null) return dailyCapForEnv(nodeEnv, fromEnv);
  const fromGlobal = readIntEnv(env[globalKey]);
  if (fromGlobal != null) return dailyCapForEnv(nodeEnv, fromGlobal);
  return dailyCapForEnv(nodeEnv, DEFAULT_PLAN_DAILY_CAPS[planKey]);
}

/**
 * 解析 organization 的 plan tier。
 * 现在通过环境变量 `OG_PLAN_TIER_{orgId}` 或全局 `OG_PLAN_TIER` 提供默认值；
 * 后续可接入 billing 服务而无需改函数签名。
 */
export function resolvePlanTier(input: {
  readonly organizationId: string;
  readonly env?: NodeJS.ProcessEnv;
}): PlanTier {
  const env = input.env ?? process.env;
  const perOrg = env[`OG_PLAN_TIER_${input.organizationId.toUpperCase()}`];
  if (perOrg && isPlanTier(perOrg)) return perOrg;
  const global = env['OG_PLAN_TIER'];
  if (global && isPlanTier(global)) return global;
  return 'free';
}

function isPlanTier(s: string): s is PlanTier {
  return s === 'free' || s === 'pro' || s === 'studio' || s === 'unknown';
}

function readIntEnv(raw: string | undefined): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}