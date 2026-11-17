/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Coalesce CLI stdout into a bounded live tap. Full transcripts still go to
 * the S3 job log — this only keeps the studio timeline honest without
 * inserting one agent_events row per chunk.
 */

export type CliStdoutEmit = (
  summary: string,
  details: Record<string, unknown>,
) => void;

export type CliStdoutTap = {
  readonly onChunk: (chunk: string) => void;
  readonly flush: () => void;
  readonly emitted: () => number;
};

function lastMeaningfulLine(buf: string, lineMax: number): string {
  const lines = buf.split(/\r?\n/).map((line) => line.trim());
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    if (!line) continue;
    if (line.length <= lineMax) return line;
    return `…${line.slice(-lineMax)}`;
  }
  const compact = buf.replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  return compact.length <= lineMax ? compact : `…${compact.slice(-lineMax)}`;
}

export function createCliStdoutTap(opts: {
  readonly emit: CliStdoutEmit;
  readonly intervalMs?: number;
  readonly maxEvents?: number;
  readonly lineMax?: number;
}): CliStdoutTap {
  const intervalMs = opts.intervalMs ?? 2_000;
  const maxEvents = opts.maxEvents ?? 40;
  const lineMax = opts.lineMax ?? 160;
  let buffer = '';
  let emitted = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastSent = '';

  const publish = (force: boolean): void => {
    if (emitted >= maxEvents) {
      buffer = '';
      return;
    }
    const summary = lastMeaningfulLine(buffer, lineMax);
    buffer = '';
    if (!summary) return;
    if (!force && summary === lastSent) return;
    lastSent = summary;
    emitted += 1;
    opts.emit(summary, {
      stream: true,
      cli: true,
      seq: emitted,
      capped: emitted >= maxEvents,
    });
  };

  const schedule = (): void => {
    if (timer || emitted >= maxEvents) return;
    timer = setTimeout(() => {
      timer = null;
      publish(false);
    }, intervalMs);
  };

  return {
    onChunk: (chunk: string) => {
      if (emitted >= maxEvents) return;
      buffer += chunk;
      if (buffer.length > 8_000) buffer = buffer.slice(-4_000);
      schedule();
    },
    flush: () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      publish(true);
    },
    emitted: () => emitted,
  };
}

export function cliStdoutStreamingEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const v = env['PLATFORM_STREAM_CLI_STDOUT']?.trim().toLowerCase();
  return v !== 'false' && v !== '0';
}
