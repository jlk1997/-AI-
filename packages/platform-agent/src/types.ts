/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

export type IntentKind = 'create' | 'iterate' | 'reset';

export interface ProjectBrief {
  readonly title?: string;
  readonly genre?: string;
  readonly archetype?: string;
  readonly gameplay?: string;
  readonly story?: string;
  readonly artStyle?: string;
  readonly audioStyle?: string;
  readonly constraints?: string[];
  readonly avoid?: string[];
  readonly version: number;
}

export interface IterationDelta {
  readonly intent: IntentKind;
  readonly summary: string;
  readonly changes: string[];
}

export interface ConversationTurn {
  readonly role: string;
  readonly content: string;
}

export interface ContextBudget {
  readonly maxTotalChars?: number;
  readonly maxRagChars?: number;
  readonly maxSummaryChars?: number;
  readonly recentTurnsFull?: number;
}

export interface ContextStackInput {
  readonly userPrompt: string;
  readonly isIteration: boolean;
  readonly brief: ProjectBrief | null;
  readonly memories: string[];
  readonly sessionSummary: string | null;
  readonly conversationTurns: ConversationTurn[];
  readonly workspaceSummaryText: string;
  readonly ragChunks: string[];
  readonly gameParamsText?: string;
  readonly iterationDelta?: IterationDelta;
}

export interface ContextStackResult {
  readonly promptPrefix: string;
  readonly intent: IntentKind;
  readonly layers: Record<string, { chars: number }>;
}

/**
 * The prompt prefix is only the *situation*; the durable platform contract now
 * reaches the CLI as workspace system context instead. 32k of prefix plus a
 * 10k contract was routinely walking round 1 into its wall-clock timeout, so the
 * retrieval layers are sized to inform rather than to restate.
 */
export const DEFAULT_CONTEXT_BUDGET: ContextBudget = {
  maxTotalChars: 18000,
  maxRagChars: 3000,
  maxSummaryChars: 2000,
  recentTurnsFull: 3,
};

/** Tighter budget for FIX iterations — skip RAG-heavy chatter. */
export const FIX_CONTEXT_BUDGET: ContextBudget = {
  maxTotalChars: 8000,
  maxRagChars: 0,
  maxSummaryChars: 800,
  recentTurnsFull: 0,
};
