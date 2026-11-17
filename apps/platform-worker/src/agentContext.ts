/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DrizzleDb } from '@opengame/platform-db';
import {
  assembleContextStack,
  extractIterationDelta,
  formatBriefForPrompt,
  listProjectMemories,
  loadLatestBrief,
  loadSessionSummary,
  persistContextSnapshots,
  runCuratorPass,
  syncBriefToWorkspace,
  formatSessionContextForPrompt,
} from '@opengame/platform-agent';
import { queryRagHybrid } from '@opengame/platform-rag';

import type { WorkspaceGameSummary } from './workspaceContext.js';
import type { ConversationTurn } from './conversationHistory.js';
import { parseContextBudget } from './contextBudget.js';

export interface AgentContextInput {
  readonly db: DrizzleDb;
  readonly projectId: string;
  readonly organizationId: string;
  readonly sessionId: string | null;
  readonly userPrompt: string;
  readonly isIteration: boolean;
  readonly workspaceSummary: WorkspaceGameSummary;
  readonly conversationTurns: ConversationTurn[];
  readonly gameParamsText?: string;
  readonly gameDocsDir: string;
  readonly templatesParentDir: string;
  readonly archetype?: string;
  readonly workspace: string;
}

export interface AgentContextOutput {
  readonly promptPrefix: string;
  readonly intent: 'create' | 'iterate' | 'reset';
  readonly effectiveIteration: boolean;
  readonly layers: Record<string, { chars: number }>;
  readonly sessionSummary: string | null;
  readonly briefText: string;
}

export async function buildAgentContext(
  input: AgentContextInput,
): Promise<AgentContextOutput> {
  const [brief, memories, sessionSummary] = await Promise.all([
    loadLatestBrief(input.db, input.projectId),
    listProjectMemories(input.db, input.projectId, 20),
    loadSessionSummary(input.db, input.sessionId),
  ]);

  const ragChunks = await queryRagHybrid(input.db, {
    gameDocsDir: input.gameDocsDir,
    templatesParentDir: input.templatesParentDir,
    archetype: input.archetype ?? brief?.archetype,
    query: input.userPrompt,
    maxChunks: 3,
  });

  const delta = extractIterationDelta(input.userPrompt, input.isIteration);
  const stack = assembleContextStack(
    {
      userPrompt: input.userPrompt,
      isIteration: input.isIteration,
      brief,
      memories: memories.map((m: { fact: string }) => m.fact),
      sessionSummary,
      conversationTurns: input.conversationTurns,
      workspaceSummaryText: input.workspaceSummary.summaryText,
      ragChunks,
      gameParamsText: input.gameParamsText,
      iterationDelta: delta,
    },
    parseContextBudget(),
  );

  const forceReset = stack.intent === 'reset';
  const effectiveIteration =
    !forceReset && stack.intent === 'iterate' && input.isIteration;

  if (brief) {
    await syncBriefToWorkspace(input.workspace, brief);
  }

  return {
    promptPrefix: stack.promptPrefix,
    intent: stack.intent,
    effectiveIteration,
    layers: stack.layers,
    sessionSummary,
    briefText: formatBriefForPrompt(brief),
  };
}

export async function finalizeAgentContext(
  db: DrizzleDb,
  options: {
    jobId: string;
    projectId: string;
    organizationId: string;
    sessionId: string | null;
    userPrompt: string;
    success: boolean;
    conversationTurns: ConversationTurn[];
    /** Prefer longer user-intent list for summary rolling. */
    summaryTurns?: ConversationTurn[];
    workspaceSummary?: string;
    pipelineArchetype?: string | null;
    layers: Record<string, { chars: number }>;
  },
): Promise<void> {
  await persistContextSnapshots(db, options.jobId, options.layers);
  await runCuratorPass({
    db,
    projectId: options.projectId,
    organizationId: options.organizationId,
    jobId: options.jobId,
    sessionId: options.sessionId,
    userPrompt: options.userPrompt,
    success: options.success,
    conversationTurns: options.summaryTurns?.length
      ? options.summaryTurns
      : options.conversationTurns,
    workspaceSummary: options.workspaceSummary,
    pipelineArchetype: options.pipelineArchetype,
  });
}

export { formatSessionContextForPrompt };
