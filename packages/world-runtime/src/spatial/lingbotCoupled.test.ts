/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  worldActionToLingBotManifest,
  manifestToWasdMatrix,
} from './lingbotActionBridge.js';
import type { LingBotSessionState } from './lingbotSession.js';
import { presentActionOnLingBot } from './lingbotCoupled.js';

describe('lingbotCoupled', () => {
  it('skips when no session', async () => {
    const r = await presentActionOnLingBot(null, 'move_n');
    expect(r.skippedLingBot).toBe(true);
    expect(r.action).toBe('move_n');
  });

  it('maps action manifest for sidecar convert', () => {
    const m = worldActionToLingBotManifest('spell', { holdFrames: 3 });
    const mat = manifestToWasdMatrix(m);
    expect(mat[0]?.[7]).toBe(1); // spell channel index
  });

  it('accepts stub session shape', () => {
    const s: LingBotSessionState = {
      sessionId: 'x',
      mode: 'mock',
      step: 0,
      frameUrl: 'data:image/svg+xml,test',
    };
    expect(s.sessionId).toBe('x');
  });
});
