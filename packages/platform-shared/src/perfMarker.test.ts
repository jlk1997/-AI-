/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';

import { createPerfMarker, withPerfMarker } from './perfMarker.js';

describe('perfMarker', () => {
  it('classifies samples against soft/hard budgets', () => {
    const marker = createPerfMarker({
      budgets: {
        test_op: { softLimitMs: 50, hardLimitMs: 100 },
      },
    });
    marker.mark('test_op');
    // 同步阻塞一会儿，Date.now 精度是 1ms
    const start = Date.now();
    while (Date.now() - start < 60) {
      // busy-wait 到 ~60ms
    }
    const sample = marker.end('test_op');
    expect(sample).not.toBeNull();
    expect(sample?.name).toBe('test_op');
    expect(sample?.durationMs).toBeGreaterThanOrEqual(50);
    expect(sample?.status === 'soft' || sample?.status === 'hard').toBe(true);
  });

  it('returns null when end is called without mark', () => {
    const marker = createPerfMarker();
    expect(marker.end('never-marked')).toBeNull();
  });

  it('records samples in order', () => {
    const marker = createPerfMarker();
    marker.mark('a');
    marker.end('a');
    marker.mark('b');
    marker.end('b');
    expect(marker.samples().map((s) => s.name)).toEqual(['a', 'b']);
  });

  it('withPerfMarker runs fn and records duration', () => {
    const marker = createPerfMarker({
      budgets: { wrap: { softLimitMs: 0, hardLimitMs: 0 } },
    });
    const out = withPerfMarker(marker, 'wrap', () => 42);
    expect(out).toBe(42);
    const sample = marker.samples()[0];
    expect(sample?.name).toBe('wrap');
    expect(sample?.status).toBe('ok');
  });

  it('budgetFor returns zero limits for unknown names', () => {
    const marker = createPerfMarker();
    expect(marker.budgetFor('nope')).toEqual({ softLimitMs: 0, hardLimitMs: 0 });
  });
});