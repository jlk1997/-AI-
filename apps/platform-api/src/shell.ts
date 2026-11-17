/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { Hono } from 'hono';

export function createHonoApp(): Hono {
  const app = new Hono();
  app.get('/health', (c) => c.json({ status: 'ok' }));
  return app;
}
