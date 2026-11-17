/**
 * Ingest agent-test/docs/modules into rag_document_chunks for PLATFORM_RAG_USE_DB=true.
 * Usage: node --env-file .env scripts/ingest-module-docs.mjs
 */
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from '../packages/platform-db/dist/schema.js';
import { ingestMarkdownTree } from '../packages/platform-rag/dist/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const docsRoot = path.join(root, 'agent-test', 'docs', 'modules');
const dbUrl = process.env['PLATFORM_DATABASE_URL'];
if (!dbUrl) {
  console.error('PLATFORM_DATABASE_URL is required');
  process.exit(1);
}

const sql = postgres(dbUrl, { max: 1 });
const db = drizzle(sql, { schema });

const archetypes = ['ui_heavy', 'top_down', 'tower_defense', 'platformer', 'grid_logic'];
let total = 0;
for (const archetype of archetypes) {
  const dir = path.join(docsRoot, archetype);
  const n = await ingestMarkdownTree(db, {
    collection: 'docs_modules',
    rootDir: dir,
    archetype,
  });
  console.log(`ingested ${n} chunks for ${archetype}`);
  total += n;
}
await sql.end();
console.log(`done: ${total} chunks`);
