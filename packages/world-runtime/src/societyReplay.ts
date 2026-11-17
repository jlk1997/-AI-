/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared society replay payload for presenter + worker export.
 */

export type SocietyReplayEvent = {
  readonly id: string;
  readonly simTime: number;
  readonly kind: string;
  readonly agentId?: string | null;
  readonly payload: Record<string, unknown>;
};

export type SocietyReplayAgent = {
  readonly id: string;
  readonly name: string;
  readonly regionId: string;
  readonly x: number;
  readonly y: number;
  readonly currentAction: string;
};

export type SocietyReplayPayload = {
  readonly version: 1;
  readonly worldId?: string;
  readonly projectId?: string;
  readonly simTime: number;
  readonly agents: SocietyReplayAgent[];
  readonly events: SocietyReplayEvent[];
  readonly report?: {
    readonly summary?: string;
    readonly informationSpread?: { rate: number };
    readonly relationshipFormation?: { newRelations: number };
    readonly coordination?: { attendanceRate: number };
  } | null;
};

export function emptySocietyReplay(
  partial?: Partial<SocietyReplayPayload>,
): SocietyReplayPayload {
  return {
    version: 1,
    simTime: 0,
    agents: [],
    events: [],
    report: null,
    ...partial,
  };
}
