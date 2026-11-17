/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Structured job metrics. A later OTel exporter can subscribe to the same
 * shape without changing call sites.
 */

export type JobMetric = {
  readonly name: string;
  readonly jobId?: string;
  readonly projectId?: string;
  readonly ms?: number;
  readonly extra?: Record<string, string | number | boolean | null>;
};

export function emitJobMetric(metric: JobMetric): void {
  const line = JSON.stringify({
    kind: 'og.job.metric',
    ts: new Date().toISOString(),
    ...metric,
  });
  if (process.env['PLATFORM_METRICS_LOG'] === 'false') return;
  console.log(line);
}
