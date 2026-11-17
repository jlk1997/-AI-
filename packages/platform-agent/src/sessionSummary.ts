/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { eq } from 'drizzle-orm';
import type { DrizzleDb } from '@opengame/platform-db';
import { chatSessions } from '@opengame/platform-db';

import type { ConversationTurn } from './types.js';

const SUMMARY_INTERVAL_TURNS = 5;
const MAX_SUMMARY_CHARS = 2000;

export async function loadSessionSummary(
  db: DrizzleDb,
  sessionId: string | null | undefined,
): Promise<string | null> {
  if (!sessionId) return null;
  const [row] = await db
    .select({ summary: chatSessions.summary })
    .from(chatSessions)
    .where(eq(chatSessions.id, sessionId))
    .limit(1);
  return row?.summary ?? null;
}

export async function updateSessionSummary(
  db: DrizzleDb,
  sessionId: string | null | undefined,
  turns: ConversationTurn[],
  jobOutcome?: string,
): Promise<string> {
  if (!sessionId) return '';
  const existing = (await loadSessionSummary(db, sessionId)) ?? '';
  // Prefer user intents; drop Generate FSM / preview deployment noise
  const userTurns = turns.filter(
    (t) =>
      t.role === 'user' &&
      !/^Generate FSM|^World edited:|^World updated/i.test(t.content),
  );
  if (userTurns.length === 0 && !jobOutcome) return existing;

  const recentUsers = userTurns.slice(-SUMMARY_INTERVAL_TURNS);
  const bullets = recentUsers.map((t) => `- 用户: ${t.content.slice(0, 480)}`);
  if (
    jobOutcome &&
    !/^Generate FSM passed/i.test(jobOutcome) &&
    !/preview deployment created/i.test(jobOutcome)
  ) {
    bullets.push(`- 结果: ${jobOutcome.slice(0, 160)}`);
  } else if (jobOutcome) {
    bullets.push('- 结果: 生成/迭代完成（详见预览）');
  }

  // Always roll when we have user turns — never freeze on truncated 3-turn window
  const merged = [
    existing ? `先前摘要:\n${existing}` : '',
    '最近用户意图:',
    ...bullets,
  ]
    .filter(Boolean)
    .join('\n');
  const next = merged.slice(0, MAX_SUMMARY_CHARS);
  await db
    .update(chatSessions)
    .set({ summary: next })
    .where(eq(chatSessions.id, sessionId));
  return next;
}

export function formatSessionContextForPrompt(
  summary: string | null,
  turns: ConversationTurn[],
  recentFullTurns = 3,
): string {
  const parts: string[] = [];
  if (summary) {
    parts.push(`【会话摘要 / Session summary】\n${summary}`);
  }
  const recent = turns.slice(-recentFullTurns);
  if (recent.length > 0) {
    parts.push('【最近对话 / Recent turns】');
    for (const t of recent) {
      const label = t.role === 'user' ? '用户' : '助手';
      parts.push(`${label}: ${t.content.slice(0, 1500)}`);
    }
  }
  return parts.join('\n\n');
}

export function compressContextIfOverBudget(
  text: string,
  maxChars: number,
): string {
  if (text.length <= maxChars) return text;
  const head = text.slice(0, Math.floor(maxChars * 0.7));
  const tail = text.slice(-Math.floor(maxChars * 0.25));
  return `${head}\n…（上下文已压缩）…\n${tail}`;
}
