/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { asc, eq } from 'drizzle-orm';
import type { DrizzleDb } from '@opengame/platform-db';
import { chatMessages } from '@opengame/platform-db';

const DEFAULT_MAX_TURNS = 12;
const MAX_CHARS_PER_MESSAGE = 2000;
const MAX_TOTAL_CHARS = 12000;

export interface ConversationTurn {
  readonly role: string;
  readonly content: string;
}

/**
 * Loads recent chat turns; when session has summary, prefer fewer full turns.
 */
export async function loadConversationHistory(
  db: DrizzleDb,
  sessionId: string | null | undefined,
  maxTurns: number = DEFAULT_MAX_TURNS,
): Promise<ConversationTurn[]> {
  if (!sessionId) return [];
  const rows = await db
    .select({
      role: chatMessages.role,
      content: chatMessages.content,
    })
    .from(chatMessages)
    .where(eq(chatMessages.sessionId, sessionId))
    .orderBy(asc(chatMessages.createdAt));

  const trimmed = rows
    .filter((r) => r.role === 'user' || r.role === 'assistant')
    .map((r) => ({
      role: r.role,
      content: r.content.slice(0, MAX_CHARS_PER_MESSAGE),
    }));

  const cap = maxTurns;
  if (trimmed.length <= cap) return trimmed;
  return trimmed.slice(-cap);
}

/** Prefer summary + last N turns (Phase B summarization path). */
export async function loadConversationForContext(
  db: DrizzleDb,
  sessionId: string | null | undefined,
  recentFullTurns = 3,
): Promise<{
  turns: ConversationTurn[];
  /** User turns for rolling session summary (not truncated to 3). */
  summaryTurns: ConversationTurn[];
  useSummaryOnly: boolean;
}> {
  const turns = await loadConversationHistory(db, sessionId, 40);
  const summaryTurns = turns
    .filter((t) => t.role === 'user')
    .slice(-12)
    .map((t) => ({
      role: t.role,
      // Prefer user intents over Job FSM noise for memory
      content: t.content.slice(0, MAX_CHARS_PER_MESSAGE),
    }));
  if (turns.length > recentFullTurns + 2) {
    return {
      turns: turns.slice(-recentFullTurns),
      summaryTurns,
      useSummaryOnly: true,
    };
  }
  return { turns, summaryTurns, useSummaryOnly: false };
}

export function formatConversationForPrompt(turns: ConversationTurn[]): string {
  if (turns.length === 0) return '';
  const lines: string[] = ['【对话历史 / Conversation history】'];
  let total = 0;
  for (const t of turns) {
    const label = t.role === 'user' ? '用户' : '助手';
    const block = `${label}: ${t.content}`;
    if (total + block.length > MAX_TOTAL_CHARS) {
      lines.push('…（更早消息已截断）');
      break;
    }
    lines.push(block);
    total += block.length;
  }
  return lines.join('\n');
}
