/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Right-hand observatory stays inert until this project has a world.
 */

import {
  previewStageIsDead,
  type PreviewBundleReason,
} from '../../utils/previewBundleHealth';

export function isObservatoryLocked(input: {
  readonly hasWorld: boolean;
  readonly previewUrl: string | null | undefined;
  readonly eventCount: number;
  readonly agentCount: number;
}): boolean {
  return (
    !input.hasWorld &&
    !input.previewUrl &&
    input.eventCount === 0 &&
    input.agentCount === 0
  );
}

export type SocietyDeskGates = {
  readonly inspectDisabled: boolean;
  readonly walkDisabled: boolean;
  readonly talkDisabled: boolean;
  readonly rebuildDisabled: boolean;
};

/**
 * Skeleton preview must stay walkable while portraits generate.
 * MiniMax talks (interview / 巷议 / 聚会) wait until the generate job lets go.
 */
export function societyDeskGates(input: {
  readonly locked: boolean;
  readonly isGenerating: boolean;
  readonly previewBroken: boolean;
  readonly hasPreview: boolean;
  /** Phaser iframe already painted — probe misses must not freeze the clock. */
  readonly stageLive?: boolean;
  readonly phaserLive?: boolean;
  readonly confirmedByIframe?: boolean;
  readonly probeReason?: PreviewBundleReason;
}): SocietyDeskGates {
  const inspectDisabled = input.locked;
  const stageDead = previewStageIsDead({
    probeBroken: input.previewBroken,
    probeReason: input.probeReason,
    iframeReady: Boolean(input.stageLive),
    phaserLive: input.phaserLive,
    confirmedByIframe: input.confirmedByIframe,
  });
  const walkDisabled = input.locked || !input.hasPreview || stageDead;
  const talkDisabled = input.locked || input.isGenerating || stageDead;
  const rebuildDisabled = input.locked || input.isGenerating;
  return { inspectDisabled, walkDisabled, talkDisabled, rebuildDisabled };
}
