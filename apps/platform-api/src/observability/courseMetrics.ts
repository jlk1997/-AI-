/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * 业务指标统一出口（批次 5）。
 *
 * 设计：每个 emitCourseMetric 调用都是一行 JSON，跟 worker emitJobMetric 同 schema。
 * 这样前端埋点 / server 埋点 / 未来 OTel 接入的形状统一。
 * 任何失败都不抛出，永远 fire-and-forget。
 */

export type CourseMetric = {
  readonly name: string;
  readonly projectId?: string;
  readonly organizationId?: string;
  readonly worldId?: string;
  readonly ms?: number;
  readonly extra?: Record<string, string | number | boolean | null>;
};

export function emitCourseMetric(metric: CourseMetric): void {
  try {
    const line = JSON.stringify({
      kind: 'og.course.metric',
      ts: new Date().toISOString(),
      ...metric,
    });
    if (process.env['PLATFORM_METRICS_LOG'] === 'false') return;
    console.log(line);
  } catch {
    /* fire-and-forget */
  }
}

/** 退盘原因（muted/paused/author_replace/...） */
export function recordCourseVoid(input: {
  readonly reason: string;
  readonly worldId?: string;
  readonly organizationId?: string;
  readonly ms?: number;
}): void {
  emitCourseMetric({
    name: 'course_void_kind',
    worldId: input.worldId,
    organizationId: input.organizationId,
    ms: input.ms,
    extra: { reason: input.reason },
  });
}

/** 「再润色一次」调用结果。changed / noop / error。 */
export function recordNarrativeRefresh(input: {
  readonly result: 'changed' | 'noop' | 'error';
  readonly fields: string;
  readonly worldId?: string;
  readonly organizationId?: string;
  readonly ms?: number;
  readonly plan?: 'free' | 'pro' | 'studio' | 'unknown';
}): void {
  emitCourseMetric({
    name: 'narrative_refresh_total',
    worldId: input.worldId,
    organizationId: input.organizationId,
    ms: input.ms,
    extra: {
      result: input.result,
      fields: input.fields,
      plan: input.plan ?? 'unknown',
    },
  });
}

/** 5 幕进度条每次进入 act 1/2/3/4/5 时记录。 */
export function recordCourseActDisplay(input: {
  readonly act: 1 | 2 | 3 | 4 | 5;
  readonly closesRemainMs?: number;
  readonly worldId?: string;
  readonly organizationId?: string;
}): void {
  emitCourseMetric({
    name: 'course_act_display',
    worldId: input.worldId,
    organizationId: input.organizationId,
    extra: {
      act: input.act,
      closesRemainMs: input.closesRemainMs ?? null,
    },
  });
}