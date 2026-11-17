/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DrizzleDb } from '@opengame/platform-db';
import { ragDocumentChunks } from '@opengame/platform-db';

export interface CommunityGameRagInput {
  slug: string;
  title: string;
  description?: string;
  category?: string;
  tags?: string[];
}

export async function ingestCommunityGame(
  db: DrizzleDb,
  game: CommunityGameRagInput,
): Promise<void> {
  const content = [
    `Title: ${game.title}`,
    game.category ? `Category: ${game.category}` : '',
    game.tags?.length ? `Tags: ${game.tags.join(', ')}` : '',
    game.description ?? '',
  ]
    .filter(Boolean)
    .join('\n');

  await db
    .insert(ragDocumentChunks)
    .values({
      collection: 'community_templates',
      sourcePath: `community/${game.slug}`,
      archetype: game.category ?? null,
      title: game.title,
      content: content.slice(0, 12000),
    })
    .onConflictDoUpdate({
      target: [ragDocumentChunks.collection, ragDocumentChunks.sourcePath],
      set: {
        content: content.slice(0, 12000),
        title: game.title,
        archetype: game.category ?? null,
      },
    });
}

export async function queryCommunityTemplateHints(
  db: DrizzleDb,
  query: string,
  max = 5,
): Promise<Array<{ title: string; slug: string; snippet: string }>> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const rows = await db
    .select({
      title: ragDocumentChunks.title,
      sourcePath: ragDocumentChunks.sourcePath,
      content: ragDocumentChunks.content,
    })
    .from(ragDocumentChunks)
    .limit(100);

  const hits: Array<{ title: string; slug: string; snippet: string; score: number }> =
    [];
  for (const row of rows) {
    if (row.sourcePath && !row.sourcePath.startsWith('community/')) continue;
    const hay = `${row.title ?? ''} ${row.content}`.toLowerCase();
    let score = 0;
    for (const token of q.split(/\s+/).filter(Boolean)) {
      if (hay.includes(token)) score += 1;
    }
    if (score <= 0) continue;
    const slug = row.sourcePath.replace(/^community\//, '');
    hits.push({
      title: row.title ?? slug,
      slug,
      snippet: row.content.slice(0, 120),
      score,
    });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, max).map(({ title, slug, snippet }) => ({ title, slug, snippet }));
}
