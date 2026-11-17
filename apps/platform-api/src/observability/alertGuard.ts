/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * 业务告警阈值（批次 6）。
 *
 * 设计要点：
 *  - 完全进程内，1 小时窗口滚动计数
 *  - 命中阈值后调用 ops alert webhook（复用 platform-worker alertWebhook 同样的形态）
 *  - 每个 metric 在 1 小时内最多打 1 次告警，避免告警风暴
 *  - 阈值由环境变量配置；环境变量缺失时使用保守默认（不告警）
 */

const WINDOW_MS = 60 * 60 * 1000; // 1h
const COOLDOWN_MS = 60 * 60 * 1000; // 1h cooldown

type WindowKey = string;

const windows = new Map<WindowKey, number[]>();
const lastAlertAt = new Map<WindowKey, number>();

function trimWindow(key: WindowKey, now: number): void {
  const arr = windows.get(key);
  if (!arr) return;
  const cutoff = now - WINDOW_MS;
  while (arr.length > 0 && arr[0] < cutoff) arr.shift();
  if (arr.length === 0) windows.delete(key);
}

function withinWindowCount(key: WindowKey, now = Date.now()): number {
  trimWindow(key, now);
  return windows.get(key)?.length ?? 0;
}

function pushIncidence(key: WindowKey, now = Date.now()): number {
  trimWindow(key, now);
  const arr = windows.get(key) ?? [];
  arr.push(now);
  windows.set(key, arr);
  return arr.length;
}

function readEnvInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

function readEnvWebhook(): string | undefined {
  const url = process.env['PLATFORM_ALERT_WEBHOOK_URL']?.trim();
  return url && url.length > 0 ? url : undefined;
}

async function postAlert(
  payload: Record<string, unknown>,
): Promise<void> {
  const url = readEnvWebhook();
  if (!url) return;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        source: 'opengame-platform-api',
        ts: new Date().toISOString(),
        ...payload,
      }),
    });
    if (!res.ok) {
      console.error('[alert-guard] non-2xx', res.status);
    }
  } catch (err) {
    console.error('[alert-guard] failed', err);
  }
}

async function maybeAlert(input: {
  readonly metric: string;
  readonly threshold: number;
  readonly windowLabel: string;
  readonly extra?: Record<string, unknown>;
}): Promise<void> {
  const count = withinWindowCount(input.metric);
  if (count < input.threshold) return;
  const now = Date.now();
  const last = lastAlertAt.get(input.metric) ?? 0;
  if (now - last < COOLDOWN_MS) return;
  lastAlertAt.set(input.metric, now);
  await postAlert({
    metric: input.metric,
    windowCount: count,
    threshold: input.threshold,
    window: input.windowLabel,
    ...(input.extra ?? {}),
  });
}

/**
 * 退盘率告警：1 小时内退盘超过阈值（默认 20）触发。
 * 使用方法：每次 recordCourseVoid 后调用一次。
 */
export function guardCourseVoidRate(input: {
  readonly reason?: string;
}): void {
  const threshold = readEnvInt('ALERT_COURSE_VOID_PER_HOUR', 20);
  const key = 'course_void_kind';
  pushIncidence(key);
  void maybeAlert({
    metric: key,
    threshold,
    windowLabel: '1h',
    extra: { reason: input.reason ?? null },
  });
}

/**
 * narrative_refresh 错误率告警：1 小时内 error 类超过阈值（默认 10）触发。
 */
export function guardNarrativeRefreshError(): void {
  const threshold = readEnvInt('ALERT_NARRATIVE_REFRESH_ERROR_PER_HOUR', 10);
  const key = 'narrative_refresh_error';
  pushIncidence(key);
  void maybeAlert({
    metric: key,
    threshold,
    windowLabel: '1h',
  });
}

/**
 * LLM 调用失败告警：1 小时内 LLM 401/429 超过阈值（默认 5）触发。
 * 主要让 ops 知道钥匙池快空了。
 */
/**
 * 开放模式令牌桶打满。调用方在拒绝一次模型调用后打点，1 小时内超过阈值告警。
 */
export function guardLlmBucketHardCap(lane: string): void {
  const threshold = readEnvInt('ALERT_LLM_BUCKET_PER_HOUR', 1);
  const key = `llm_bucket_${lane}`;
  pushIncidence(key);
  void maybeAlert({
    metric: key,
    threshold,
    windowLabel: '1h',
    extra: { lane },
  });
}

export function guardLlmKeyPool(): void {
  const threshold = readEnvInt('ALERT_LLM_POOL_PER_HOUR', 5);
  const key = 'llm_pool_dead';
  pushIncidence(key);
  void maybeAlert({
    metric: key,
    threshold,
    windowLabel: '1h',
  });
}

/** 测试 / 单测使用：重置窗口与冷却 */
export function resetAlertGuardForTest(): void {
  windows.clear();
  lastAlertAt.clear();
}