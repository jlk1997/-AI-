/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DrizzleDb } from '@opengame/platform-db';
import { jobFeedback } from '@opengame/platform-db';

import { patchBriefFromPrompt, saveBrief } from './briefService.js';
import { addNegativeFeedbackMemory, addProjectMemory } from './memoryService.js';
import { updateSessionSummary } from './sessionSummary.js';
import type { ConversationTurn, ProjectBrief } from './types.js';

export interface CuratorInput {
  readonly db: DrizzleDb;
  readonly projectId: string;
  readonly organizationId: string;
  readonly jobId: string;
  readonly sessionId: string | null;
  readonly userPrompt: string;
  readonly success: boolean;
  readonly conversationTurns: ConversationTurn[];
  readonly workspaceSummary?: string;
  readonly pipelineArchetype?: string | null;
}

export interface CuratorResult {
  readonly brief: ProjectBrief;
  readonly sessionSummary: string;
}

/** Post-job curation: update Brief, session summary, optional memory facts. */
export async function runCuratorPass(input: CuratorInput): Promise<CuratorResult> {
  let brief = await patchBriefFromPrompt(
    input.db,
    input.projectId,
    input.userPrompt,
  );
  if (input.pipelineArchetype) {
    const { version: _v, ...briefWithoutVersion } = brief;
    brief = await saveBrief(input.db, input.projectId, {
      ...briefWithoutVersion,
      archetype: input.pipelineArchetype,
    });
  }

  const outcome = input.success
    ? `生成成功: ${input.userPrompt.slice(0, 100)}`
    : `生成失败: ${input.userPrompt.slice(0, 100)}`;

  const sessionSummary = await updateSessionSummary(
    input.db,
    input.sessionId,
    input.conversationTurns,
    outcome,
  );

  if (input.success && input.workspaceSummary) {
    await addProjectMemory(input.db, {
      projectId: input.projectId,
      fact: `最近版本: ${input.workspaceSummary.slice(0, 500)}`,
      scope: 'project',
      sourceJobId: input.jobId,
    });
  }

  return { brief, sessionSummary };
}

export async function recordJobFeedback(
  db: DrizzleDb,
  options: {
    jobId: string;
    projectId: string;
    userId?: string;
    rating?: number;
    comment?: string;
  },
): Promise<void> {
  await db.insert(jobFeedback).values({
    jobId: options.jobId,
    projectId: options.projectId,
    userId: options.userId ?? null,
    rating: options.rating ?? null,
    comment: options.comment ?? null,
  });
  if (options.rating !== undefined && options.rating <= 2 && options.comment) {
    await addNegativeFeedbackMemory(
      db,
      options.projectId,
      options.comment,
      options.jobId,
    );
  }
}
