/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

export * from './schema.js';
export * from './societyPersist.js';
export * from './deepStore.js';

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema.js';

export type DrizzleDb = ReturnType<typeof createDrizzle>;

export function createDrizzle(client: postgres.Sql) {
  return drizzle(client, { schema });
}

export function createPostgresClient(databaseUrl: string): postgres.Sql {
  return postgres(databaseUrl, { max: 10 });
}
