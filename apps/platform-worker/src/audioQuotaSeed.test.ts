/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import { probeAudioBuffer } from './assetAuthenticity.js';
import { loadAudioQuotaSeed } from './audioQuotaSeed.js';

describe('audioQuotaSeed', () => {
  it('loads bgm/sfx seeds that pass authenticity size gate', async () => {
    for (const name of ['bgm.mp3', 'sfx_win.mp3', 'sfx_lose.mp3'] as const) {
      const buf = await loadAudioQuotaSeed(name);
      expect(buf, name).not.toBeNull();
      expect(probeAudioBuffer(buf!).ok, name).toBe(true);
    }
  });
});
