/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { desc, eq } from 'drizzle-orm';
import type { DrizzleDb } from '@opengame/platform-db';
import { organizationPreferences, projectMemories } from '@opengame/platform-db';

export async function listProjectMemories(
  db: DrizzleDb,
  projectId: string,
  limit = 30,
): Promise<Array<{ id: string; scope: string; fact: string; createdAt: Date }>> {
  return db
    .select({
      id: projectMemories.id,
      scope: projectMemories.scope,
      fact: projectMemories.fact,
      createdAt: projectMemories.createdAt,
    })
    .from(projectMemories)
    .where(eq(projectMemories.projectId, projectId))
    .orderBy(desc(projectMemories.createdAt))
    .limit(limit);
}

export async function addProjectMemory(
  db: DrizzleDb,
  options: {
    projectId: string;
    fact: string;
    scope?: string;
    sourceJobId?: string;
    meta?: Record<string, unknown>;
  },
): Promise<void> {
  await db.insert(projectMemories).values({
    projectId: options.projectId,
    fact: options.fact.slice(0, 4000),
    scope: options.scope ?? 'project',
    sourceJobId: options.sourceJobId ?? null,
    meta: options.meta ?? null,
  });
}

export async function addNegativeFeedbackMemory(
  db: DrizzleDb,
  projectId: string,
  comment: string,
  jobId?: string,
): Promise<void> {
  await addProjectMemory(db, {
    projectId,
    fact: `用户不满意: ${comment}`,
    scope: 'negative',
    sourceJobId: jobId,
  });
}

export function formatMemoriesForPrompt(
  facts: string[],
  maxChars = 3000,
): string {
  if (facts.length === 0) return '';
  const lines = ['【项目记忆 / Project memories】'];
  let total = 0;
  for (const f of facts) {
    const line = `- ${f}`;
    if (total + line.length > maxChars) break;
    lines.push(line);
    total += line.length;
  }
  return lines.join('\n');
}

export async function loadOrgPreferences(
  db: DrizzleDb,
  organizationId: string,
): Promise<Record<string, unknown>> {
  const [row] = await db
    .select()
    .from(organizationPreferences)
    .where(eq(organizationPreferences.organizationId, organizationId))
    .limit(1);
  return (row?.preferencesJson as Record<string, unknown>) ?? {};
}

export async function saveOrgPreferences(
  db: DrizzleDb,
  organizationId: string,
  preferences: Record<string, unknown>,
): Promise<void> {
  await db
    .insert(organizationPreferences)
    .values({
      organizationId,
      preferencesJson: preferences,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: organizationPreferences.organizationId,
      set: {
        preferencesJson: preferences,
        updatedAt: new Date(),
      },
    });
}
