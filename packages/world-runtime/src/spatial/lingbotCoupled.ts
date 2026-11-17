/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Couples L1 Spec simulation with optional L3 LingBot presentation frames.
 * Gameplay authority always comes from WorldSimulator / WorldGameEngine.
 */

import type { WorldSpec } from '@opengame/world-spec';

import type { WorldActionKind } from './lingbotActionBridge.js';
import {
  LingBotSessionClient,
  type LingBotSessionState,
} from './lingbotSession.js';

export interface CoupledStepResult {
  readonly action: WorldActionKind;
  /** Presentation frame from LingBot sidecar (optional). */
  readonly frameUrl?: string;
  readonly session?: LingBotSessionState;
  readonly skippedLingBot: boolean;
  readonly reason?: string;
}

/**
 * Open a LingBot visual session for a world region (no-op if sidecar down / license unset).
 * If env says real but sidecar readyReal=false, opens mock so the experiment UI still works.
 */
export async function openWorldVisualSession(
  world: WorldSpec,
  regionId?: string,
  client = new LingBotSessionClient(),
): Promise<LingBotSessionState | null> {
  if (process.env['LINGBOT_ACCEPT_NC_LICENSE'] !== 'true') {
    return null;
  }
  const health = await client.health();
  if (!health.ok) return null;
  const rid = regionId ?? world.space.startRegionId;
  const region = world.space.regions.find((r) => r.id === rid);
  const want =
    world.presentation?.lingbotMode ??
    (process.env['LINGBOT_MODE'] as 'mock' | 'real' | undefined) ??
    'mock';
  const mode: 'mock' | 'real' =
    want === 'real' && health.readyReal === false ? 'mock' : want === 'real' ? 'real' : 'mock';
  return client.createSession({
    prompt: [
      world.meta.title,
      region?.description,
      world.meta.summary,
      world.styleAnchor.artStyle,
    ]
      .filter(Boolean)
      .join(' — '),
    regionId: rid,
    worldTitle: world.meta.title,
    styleAnchor: world.styleAnchor,
    mode,
  });
}

/**
 * After Spec has already applied `action`, optionally advance LingBot visuals.
 */
export async function presentActionOnLingBot(
  session: LingBotSessionState | null,
  action: WorldActionKind,
  client = new LingBotSessionClient(),
): Promise<CoupledStepResult> {
  if (!session?.sessionId) {
    return { action, skippedLingBot: true, reason: 'no session' };
  }
  try {
    const next = await client.stepAction(session.sessionId, action);
    return {
      action,
      frameUrl: next.frameUrl,
      session: next,
      skippedLingBot: false,
    };
  } catch (err) {
    return {
      action,
      skippedLingBot: true,
      reason: err instanceof Error ? err.message : String(err),
      session,
    };
  }
}
