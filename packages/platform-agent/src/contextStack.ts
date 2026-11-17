/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DrizzleDb } from '@opengame/platform-db';
import { contextSnapshots } from '@opengame/platform-db';

import { formatBriefForPrompt } from './briefService.js';
import { formatDeltaForPrompt, extractIterationDelta, resolveEffectiveIntent } from './intentService.js';
import { formatMemoriesForPrompt } from './memoryService.js';
import { compressContextIfOverBudget, formatSessionContextForPrompt } from './sessionSummary.js';
import type { ContextBudget, ContextStackInput, ContextStackResult } from './types.js';
import { DEFAULT_CONTEXT_BUDGET } from './types.js';

export function assembleContextStack(
  input: ContextStackInput,
  budget: ContextBudget = DEFAULT_CONTEXT_BUDGET,
): ContextStackResult {
  const delta =
    input.iterationDelta ??
    extractIterationDelta(input.userPrompt, input.isIteration);
  const intent = resolveEffectiveIntent(delta, input.isIteration);

  const layers: Record<string, { chars: number }> = {};

  const l1 =
    input.ragChunks.length > 0
      ? `【知识检索 / RAG】\n${input.ragChunks.join('\n\n---\n\n')}`.slice(
          0,
          budget.maxRagChars ?? 6000,
        )
      : '';
  layers.L1 = { chars: l1.length };

  const l2Parts = [
    formatBriefForPrompt(input.brief),
    formatMemoriesForPrompt(input.memories),
  ].filter(Boolean);
  const l2 = l2Parts.join('\n\n');
  layers.L2 = { chars: l2.length };

  const l3 = formatSessionContextForPrompt(
    input.sessionSummary,
    input.conversationTurns,
    budget.recentTurnsFull ?? 3,
  ).slice(0, budget.maxSummaryChars ?? 2000);
  layers.L3 = { chars: l3.length };

  const l4 = input.workspaceSummaryText
    ? `【工作区状态 / Workspace】\n${input.workspaceSummaryText}`
    : '';
  layers.L4 = { chars: l4.length };

  const l5Parts = [
    formatDeltaForPrompt(delta),
    input.gameParamsText ?? '',
    `【用户本轮需求】\n${input.userPrompt}`,
  ].filter(Boolean);
  const l5 = l5Parts.join('\n\n');
  layers.L5 = { chars: l5.length };

  let prefix = [l1, l2, l3, l4, l5].filter(Boolean).join('\n\n');
  prefix = compressContextIfOverBudget(prefix, budget.maxTotalChars ?? 32000);

  return { promptPrefix: prefix, intent, layers };
}

export async function persistContextSnapshots(
  db: DrizzleDb,
  jobId: string,
  layers: Record<string, { chars: number }>,
  samples?: Record<string, string>,
): Promise<void> {
  for (const [layer, meta] of Object.entries(layers)) {
    await db.insert(contextSnapshots).values({
      jobId,
      layer,
      charCount: meta.chars,
      contentJson: samples?.[layer]
        ? { sample: samples[layer]!.slice(0, 4000) }
        : null,
    });
  }
}

export type { ContextStackInput, ContextStackResult, ContextBudget };
export { DEFAULT_CONTEXT_BUDGET } from './types.js';
