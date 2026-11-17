/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Grounding rules so NPCs/player don't float as bust portraits over scenic BGs.
 */
export interface GroundingConfig {
  readonly spriteDisplayHeight: number;
  readonly shadowEllipse: { width: number; height: number; alpha: number };
  readonly origin: { x: number; y: number };
}

export const DEFAULT_GROUNDING: GroundingConfig = {
  spriteDisplayHeight: 56,
  shadowEllipse: { width: 36, height: 10, alpha: 0.28 },
  /** Feet at bottom-center */
  origin: { x: 0.5, y: 1 },
};

export function groundingPromptAddon(): string {
  return 'full body standing on ground, feet visible, no floating bust/portrait crop, consistent scale';
}
