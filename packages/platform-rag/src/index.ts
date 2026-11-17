/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { eq, sql } from 'drizzle-orm';
import type { DrizzleDb } from '@opengame/platform-db';
import { ragDocumentChunks } from '@opengame/platform-db';

import type { RagChunk, RagQueryOptions } from './keywordSearch.js';
import { formatRagChunksForPrompt, queryRagR1 } from './keywordSearch.js';

export async function ingestMarkdownTree(
  db: DrizzleDb,
  options: {
    collection: string;
    rootDir: string;
    archetype?: string;
  },
): Promise<number> {
  let count = 0;
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!/\.(md|json|txt)$/i.test(e.name)) continue;
      const content = await fs.readFile(full, 'utf8');
      const rel = path.relative(options.rootDir, full).replace(/\\/g, '/');
      await db
        .insert(ragDocumentChunks)
        .values({
          collection: options.collection,
          sourcePath: rel,
          archetype: options.archetype ?? null,
          title: e.name,
          content: content.slice(0, 12000),
        })
        .onConflictDoUpdate({
          target: [ragDocumentChunks.collection, ragDocumentChunks.sourcePath],
          set: {
            content: content.slice(0, 12000),
            title: e.name,
          },
        });
      count += 1;
    }
  }
  await walk(options.rootDir);
  return count;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Phase R2: DB chunks with optional embedding vectors (JSON arrays). */
export async function queryRagR2(
  db: DrizzleDb,
  options: {
    query: string;
    queryEmbedding?: number[];
    archetype?: string;
    collection?: string;
    maxChunks?: number;
  },
): Promise<RagChunk[]> {
  const rows = await db
    .select()
    .from(ragDocumentChunks)
    .where(
      options.collection
        ? eq(ragDocumentChunks.collection, options.collection)
        : sql`true`,
    )
    .limit(200);

  const queryLower = options.query.toLowerCase();
  const scored: RagChunk[] = [];
  for (const row of rows) {
    if (options.archetype && row.archetype && row.archetype !== options.archetype) {
      continue;
    }
    let score = row.content.toLowerCase().includes(queryLower.slice(0, 20)) ? 2 : 0;
    const emb = row.embedding as number[] | null;
    if (options.queryEmbedding && emb?.length) {
      score += cosineSimilarity(options.queryEmbedding, emb) * 10;
    }
    if (score <= 0) continue;
    scored.push({
      source: row.sourcePath,
      title: row.title ?? row.sourcePath,
      content: row.content,
      score,
    });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, options.maxChunks ?? 4);
}

export async function queryRagHybrid(
  db: DrizzleDb | null,
  fileOpts: RagQueryOptions,
): Promise<string[]> {
  const r1 = await queryRagR1(fileOpts);
  let chunks = r1;
  if (db && process.env['PLATFORM_RAG_USE_DB'] === 'true') {
    const r2 = await queryRagR2(db, {
      query: fileOpts.query,
      archetype: fileOpts.archetype,
      collection: 'docs_modules',
      maxChunks: fileOpts.maxChunks,
    });
    if (r2.length > 0) chunks = r2;
  }
  return formatRagChunksForPrompt(chunks);
}

export { queryRagR1, formatRagChunksForPrompt };
export { ingestCommunityGame, queryCommunityTemplateHints } from './communityRag.js';
export type { CommunityGameRagInput } from './communityRag.js';
export type { RagChunk, RagQueryOptions };
