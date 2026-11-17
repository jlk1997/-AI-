/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DrizzleDb } from '@opengame/platform-db';
import { chatMessages } from '@opengame/platform-db';

/** Binds chat UI to platform jobs without re-parsing CLI stdout. */
export async function appendSessionTimeline(
  db: DrizzleDb,
  sessionId: string | null | undefined,
  content: string,
): Promise<void> {
  if (!sessionId) {
    return;
  }
  await db.insert(chatMessages).values({
    sessionId,
    role: 'assistant',
    content: content.slice(0, 8000),
  });
}
