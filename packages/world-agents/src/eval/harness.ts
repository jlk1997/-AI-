/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Programmatic emergence eval. The report card is the gate: a town that does
 * not spread news, form ties, gather in the evening, live different days or
 * say new lines fails, and CI should fail with it.
 */

import {
  createSocietyTownWorld,
  gatheringInvitationText,
  gatheringSeedText,
} from '@opengame/world-spec';

import { societyStateFromSpec } from '../specBridge.js';
import { runSocietyHours, type SocietyEvent } from '../tick.js';
import { scoreOpinionDynamics } from '../opinionDynamics.js';
import {
  buildEmergenceReportCard,
  gateEmergenceReportCard,
  maybeLlmJudgeReportCard,
  type EmergenceGateResult,
  type EmergenceReportCard,
  type EmergenceThresholds,
} from './metrics.js';

export interface EmergenceEvalOptions {
  readonly hours?: number;
  readonly dtHours?: number;
  readonly seedText?: string;
  readonly invitationText?: string;
  readonly thresholds?: Partial<EmergenceThresholds>;
  /** Optional model — CI stays heuristic (0 LLM talks). */
  readonly llm?: import('../reflect.js').LlmTextFn;
  readonly maxLlmConversationsPerStep?: number;
  readonly maxPlanLlmCallsPerStep?: number;
}

export interface EmergenceEvalResult extends EmergenceGateResult {
  readonly hours: number;
  readonly elapsedMs: number;
  readonly eventCounts: Record<string, number>;
  readonly dialogues: number;
  readonly groupTalks: number;
  readonly driveReplans: number;
  readonly destinations: number;
  readonly residents: number;
  readonly regions: number;
  readonly opinion: import('../opinionDynamics.js').OpinionDynamicsScore;
}

export async function runEmergenceEval(
  options: EmergenceEvalOptions = {},
): Promise<EmergenceEvalResult> {
  const hours = Math.max(1, options.hours ?? 24);
  const dtHours = options.dtHours ?? 0.25;
  const spec = createSocietyTownWorld({ title: '生活小镇' });
  const seedText = options.seedText ?? gatheringSeedText('铁砧', spec);
  const invitationText = options.invitationText ?? gatheringInvitationText(spec);
  const state = societyStateFromSpec(spec, { seedText });
  const t0 = Date.now();
  const events = await runSocietyHours(state, hours, {
    dtHours,
    maxConversationsPerStep: 4,
    maxLlmConversationsPerStep:
      options.maxLlmConversationsPerStep ?? (options.llm ? 2 : 0),
    maxPlanLlmCallsPerStep:
      options.maxPlanLlmCallsPerStep ?? (options.llm ? 1 : 0),
    maxReactLlmCallsPerStep: options.llm ? 1 : 0,
    ...(options.llm ? { llm: options.llm } : {}),
  });
  const elapsedMs = Date.now() - t0;
  const eventCounts: Record<string, number> = {};
  for (const e of events) {
    eventCounts[e.kind] = (eventCounts[e.kind] ?? 0) + 1;
  }
  // Failed beats are emitted as visible markers; they are not conversations.
  const dialogues = events.filter(
    (e) => e.kind === 'dialogue' && e.payload['skipped'] !== true,
  );
  const groupTalks = dialogues.filter(
    (e) => ((e.payload['participants'] as string[] | undefined)?.length ?? 2) >= 3,
  );
  const driveReplans = events.filter(
    (e) => e.kind === 'plan' && e.payload['replan'] === true,
  );
  const destinations = new Set(
    events
      .filter((e) => e.kind === 'action')
      .map((e) => e.payload['goalPlace'])
      .filter((v): v is string => typeof v === 'string' && v.length > 0),
  );
  const card: EmergenceReportCard = await maybeLlmJudgeReportCard(
    buildEmergenceReportCard({
      state,
      events,
      seedText,
      invitationText,
    }),
    { state, events, llm: options.llm },
  );
  const gate = gateEmergenceReportCard(card, options.thresholds);
  return {
    ...gate,
    hours,
    elapsedMs,
    eventCounts,
    dialogues: dialogues.length,
    groupTalks: groupTalks.length,
    driveReplans: driveReplans.length,
    destinations: destinations.size,
    residents: state.agents.length,
    regions: state.regionBounds?.size ?? 0,
    opinion: scoreOpinionDynamics({
      events,
      awareRateByHour: [{ hour: hours, rate: card.informationSpread.rate }],
    }),
  };
}

export function formatEmergenceEval(result: EmergenceEvalResult): string {
  const sustain = result.card.dialogueSustain;
  const lines = [
    `residents=${result.residents} regions=${result.regions} hours=${result.hours} ms=${result.elapsedMs}`,
    `dialogues=${result.dialogues} groupTalks=${result.groupTalks} driveReplans=${result.driveReplans} destinations=${result.destinations}`,
    `concurrentTalks=${sustain.maxConcurrentTalks} parallelWindows=${sustain.parallelWindows} sustain=${sustain.firstWindowDialogues}→${sustain.lastWindowDialogues} per ${sustain.compareWindowHours.toFixed(1)}h`,
    result.card.summary,
    result.ok ? 'gate: PASS' : `gate: FAIL — ${result.failures.join('; ')}`,
  ];
  return lines.join('\n');
}

/** Kept so callers that only want the events of a harness run can inspect them. */
export type { SocietyEvent };
