/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { cliStdoutStreamingEnabled, createCliStdoutTap } from './cliStdoutTap.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('createCliStdoutTap', () => {
  it('coalesces chunks and emits the last meaningful line', () => {
    vi.useFakeTimers();
    const lines: string[] = [];
    const tap = createCliStdoutTap({
      emit: (summary) => lines.push(summary),
      intervalMs: 100,
    });
    tap.onChunk('Installing\n');
    tap.onChunk('Wrote src/main.ts\n');
    expect(lines).toEqual([]);
    vi.advanceTimersByTime(100);
    expect(lines).toEqual(['Wrote src/main.ts']);
    tap.onChunk('QA pass\n');
    tap.flush();
    expect(lines).toEqual(['Wrote src/main.ts', 'QA pass']);
  });

  it('caps the number of live events', () => {
    const lines: string[] = [];
    const tap = createCliStdoutTap({
      emit: (summary) => lines.push(summary),
      intervalMs: 1,
      maxEvents: 2,
    });
    tap.onChunk('one\n');
    tap.flush();
    tap.onChunk('two\n');
    tap.flush();
    tap.onChunk('three\n');
    tap.flush();
    expect(lines).toEqual(['one', 'two']);
    expect(tap.emitted()).toBe(2);
  });
});

describe('cliStdoutStreamingEnabled', () => {
  it('is on by default and only off when explicitly false', () => {
    expect(cliStdoutStreamingEnabled({})).toBe(true);
    expect(cliStdoutStreamingEnabled({ PLATFORM_STREAM_CLI_STDOUT: 'true' })).toBe(true);
    expect(cliStdoutStreamingEnabled({ PLATFORM_STREAM_CLI_STDOUT: 'false' })).toBe(false);
  });
});
