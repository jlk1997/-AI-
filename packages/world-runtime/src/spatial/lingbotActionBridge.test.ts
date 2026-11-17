/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  LINGBOT_WASD_CHANNELS,
  manifestToWasdMatrix,
  worldActionPathToLingBotManifest,
  worldActionToLingBotManifest,
} from './lingbotActionBridge.js';

describe('lingbotActionBridge', () => {
  it('maps move/attack to WASD frames', () => {
    const m = worldActionToLingBotManifest('attack', { holdFrames: 4 });
    expect(m.schema).toBe('opengame-lingbot-action-v1');
    expect(m.frameCount).toBe(4);
    expect(m.frames[0]?.wasd).toBe('attack');
    expect(m.frames[0]?.textEvent).toMatch(/weapon/i);
  });

  it('builds continuous path matrix', () => {
    const m = worldActionPathToLingBotManifest(['move_n', 'move_e'], {
      framesPerAction: 2,
    });
    const mat = manifestToWasdMatrix(m);
    expect(mat).toHaveLength(4);
    expect(mat[0]?.length).toBe(LINGBOT_WASD_CHANNELS.length);
    const fwd = LINGBOT_WASD_CHANNELS.indexOf('forward');
    expect(mat[0]?.[fwd]).toBe(1);
  });
});
