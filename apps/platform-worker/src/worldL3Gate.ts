/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared L3 playable-media assertion for world generate / edit / rebuild.
 */

import type { AgentEventStream } from './agentEvents.js';
import {
  runWorldQualityGate,
  type WorldQualityResult,
} from './worldQualityGate.js';
import type { WorldSpec } from '@opengame/world-spec';

export function assertWorldL3Playable(
  world: WorldSpec,
  stream?: AgentEventStream,
): WorldQualityResult {
  const gate = runWorldQualityGate(world, { probePlayability: false });
  const l3Issues = gate.issues.filter(
    (i) =>
      i.includes('L3') ||
      i.includes('可播') ||
      i.includes('spatialAssets') ||
      i.includes('lingbotMode'),
  );
  // Align with worldPipeline FIX gate: on unless explicitly false/soft
  const soft =
    process.env['WORLD_QUALITY_GATE'] === 'soft' ||
    process.env['WORLD_QUALITY_GATE_STRICT'] === 'false';
  const enforce =
    !soft &&
    process.env['WORLD_QUALITY_GATE'] !== 'false' &&
    process.env['WORLD_QUALITY_GATE'] !== '0';
  if (l3Issues.length > 0 && enforce) {
    void stream?.emit('qa', 'QA', {
      summary: 'L3 spatial 复检失败',
      details: { issues: l3Issues },
    });
    throw new Error(`World L3 gate failed: ${l3Issues.join('; ')}`);
  }
  return gate;
}
