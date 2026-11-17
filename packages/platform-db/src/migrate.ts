/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Walks `migrations/*.sql` in lexical order and applies each idempotently.
 * Files must stay `IF NOT EXISTS` / guarded so reruns are safe.
 * `schema_migrations` (from 0025+) is an audit log, not a skip list.
 */
async function main(): Promise<void> {
  const url = process.env['PLATFORM_DATABASE_URL'];
  if (!url) {
    throw new Error('PLATFORM_DATABASE_URL is required');
  }
  const dir = path.join(__dirname, '..', 'migrations');
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  if (files.length === 0) {
    throw new Error(`No migrations found in ${dir}`);
  }
  const sql = postgres(url, { max: 1 });
  try {
    for (const file of files) {
      const fullPath = path.join(dir, file);
      const body = fs.readFileSync(fullPath, 'utf8');
      await sql.unsafe(body);
      const id = file.replace(/\.sql$/i, '');
      await sql.unsafe(
        `INSERT INTO schema_migrations (id) VALUES ('${id.replace(/'/g, "''")}') ON CONFLICT (id) DO NOTHING`,
      ).catch(() => {
        /* table exists only after 0025; earlier files still apply */
      });
      console.log('Applied migration:', file);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
