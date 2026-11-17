/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { isObservatoryLocked, societyDeskGates } from './observatoryLock';

describe('isObservatoryLocked', () => {
  it('locks when there is no world, preview, events, or agents', () => {
    expect(
      isObservatoryLocked({
        hasWorld: false,
        previewUrl: null,
        eventCount: 0,
        agentCount: 0,
      }),
    ).toBe(true);
  });

  it('unlocks once a world exists', () => {
    expect(
      isObservatoryLocked({
        hasWorld: true,
        previewUrl: null,
        eventCount: 0,
        agentCount: 0,
      }),
    ).toBe(false);
  });

  it('unlocks when a preview or live agents are already on screen', () => {
    expect(
      isObservatoryLocked({
        hasWorld: false,
        previewUrl: 'https://example.test/play/',
        eventCount: 0,
        agentCount: 0,
      }),
    ).toBe(false);
    expect(
      isObservatoryLocked({
        hasWorld: false,
        previewUrl: null,
        eventCount: 3,
        agentCount: 0,
      }),
    ).toBe(false);
    expect(
      isObservatoryLocked({
        hasWorld: false,
        previewUrl: null,
        eventCount: 0,
        agentCount: 2,
      }),
    ).toBe(false);
  });

  it('lets the author walk a skeleton while portraits still generate', () => {
    const desk = societyDeskGates({
      locked: false,
      isGenerating: true,
      previewBroken: false,
      hasPreview: true,
    });
    expect(desk.inspectDisabled).toBe(false);
    expect(desk.walkDisabled).toBe(false);
    expect(desk.talkDisabled).toBe(true);
    expect(desk.rebuildDisabled).toBe(true);
  });

  it('keeps walk enabled when the map is live even if the probe is unhappy', () => {
    const desk = societyDeskGates({
      locked: false,
      isGenerating: false,
      previewBroken: true,
      hasPreview: true,
      stageLive: true,
    });
    expect(desk.walkDisabled).toBe(false);
    expect(desk.talkDisabled).toBe(false);
  });

  it('locks walk when the stage is actually black', () => {
    const desk = societyDeskGates({
      locked: false,
      isGenerating: false,
      previewBroken: true,
      hasPreview: true,
      stageLive: false,
    });
    expect(desk.walkDisabled).toBe(true);
  });

  it('freezes talks only when the iframe itself confirms a stub', () => {
    const painted = societyDeskGates({
      locked: false,
      isGenerating: false,
      previewBroken: true,
      hasPreview: true,
      stageLive: true,
      phaserLive: true,
      confirmedByIframe: false,
    });
    expect(painted.walkDisabled).toBe(false);
    expect(painted.talkDisabled).toBe(false);
    const stub = societyDeskGates({
      locked: false,
      isGenerating: false,
      previewBroken: true,
      hasPreview: true,
      stageLive: true,
      phaserLive: false,
      confirmedByIframe: true,
    });
    expect(stub.walkDisabled).toBe(true);
    expect(stub.talkDisabled).toBe(true);
  });
});
