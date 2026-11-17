/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { probePngBuffer, probeAudioBuffer } from './assetAuthenticity.js';

describe('assetAuthenticity', () => {
  it('rejects tiny / near-solid png buffers', () => {
    // minimal 1x1 png
    const tiny = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    expect(probePngBuffer(tiny).ok).toBe(false);
  });

  it('rejects tiny audio', () => {
    expect(probeAudioBuffer(Buffer.from([0, 1, 2])).ok).toBe(false);
  });

  it('accepts larger multi-byte audio stub', () => {
    expect(probeAudioBuffer(Buffer.alloc(12_000, 1)).ok).toBe(true);
  });
});
