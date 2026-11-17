/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

export interface RagQueryOptions {
  readonly gameDocsDir: string;
  readonly templatesParentDir: string;
  readonly runtimePocDir?: string;
  readonly archetype?: string;
  readonly query: string;
  readonly maxChunks?: number;
  readonly maxChunkChars?: number;
}

export interface RagChunk {
  readonly source: string;
  readonly title: string;
  readonly content: string;
  readonly score: number;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s，,。.!?\n]+/)
    .filter((t) => t.length > 1);
}

function scoreChunk(queryTokens: string[], content: string, archetype?: string): number {
  const lower = content.toLowerCase();
  let score = 0;
  for (const t of queryTokens) {
    if (lower.includes(t)) score += 2;
  }
  if (archetype && lower.includes(archetype)) score += 3;
  return score;
}

async function readIfExists(filePath: string, maxChars: number): Promise<string | null> {
  try {
    const raw = await fsp.readFile(filePath, 'utf8');
    return raw.slice(0, maxChars);
  } catch {
    return null;
  }
}

async function collectCandidateFiles(opts: RagQueryOptions): Promise<string[]> {
  const files: string[] = [];
  const archetype = opts.archetype ?? 'platformer';
  const moduleDocs = path.join(opts.gameDocsDir, 'modules', archetype);
  for (const name of [`${archetype}.md`, 'design_rules.md', 'template_api.md']) {
    const p = path.join(moduleDocs, name);
    if (fs.existsSync(p)) files.push(p);
  }
  const packagesRoot = path.join(opts.templatesParentDir, '..', '..', 'packages');
  for (const pkg of ['module-dialogue', 'module-combat', 'module-world', 'module-td', 'module-platform']) {
    const readme = path.join(packagesRoot, pkg, 'README.md');
    if (fs.existsSync(readme)) files.push(readme);
  }
  const starterReadme = path.join(
    opts.templatesParentDir,
    '..',
    '..',
    'examples',
    'platform-rpg-starter',
    'README.md',
  );
  if (fs.existsSync(starterReadme)) files.push(starterReadme);
  const platformDocs = [
    path.join(opts.gameDocsDir, '..', '..', 'docs', 'platform', 'planner-playbook.md'),
  ];
  for (const p of platformDocs) {
    if (fs.existsSync(p)) files.push(p);
  }
  const pocNames = ['snake', 'flappy', '2048'];
  const pocRoot =
    opts.runtimePocDir ??
    path.join(opts.templatesParentDir, '..', '..', 'packages', 'runtime', 'examples', 'poc');
  for (const poc of pocNames) {
    const gameJson = path.join(pocRoot, poc, 'game.json');
    if (fs.existsSync(gameJson)) files.push(gameJson);
    const ts = path.join(pocRoot, poc, `${poc}.ts`);
    if (fs.existsSync(ts)) files.push(ts);
  }
  return files;
}

/** Phase R1: keyword + archetype filtered file retrieval (no vector DB). */
export async function queryRagR1(opts: RagQueryOptions): Promise<RagChunk[]> {
  const maxChunks = opts.maxChunks ?? 4;
  const maxChunkChars = opts.maxChunkChars ?? 2500;
  const queryTokens = tokenize(opts.query);
  const files = await collectCandidateFiles(opts);
  const chunks: RagChunk[] = [];

  for (const file of files) {
    const content = await readIfExists(file, maxChunkChars);
    if (!content) continue;
    const score = scoreChunk(queryTokens, content, opts.archetype);
    if (score <= 0 && queryTokens.length > 2) continue;
    chunks.push({
      source: file,
      title: path.basename(file),
      content,
      score: score || 1,
    });
  }

  chunks.sort((a, b) => b.score - a.score);
  const filtered = chunks.filter((c) => scoreChunk(queryTokens, c.content, opts.archetype) > 0 || chunks.length <= 2);
  return (filtered.length > 0 ? filtered : chunks).slice(0, maxChunks);
}

export function formatRagChunksForPrompt(chunks: RagChunk[]): string[] {
  return chunks.map(
    (c) => `[${c.title} @ ${c.source}]\n${c.content}`,
  );
}
