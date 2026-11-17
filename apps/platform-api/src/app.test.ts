/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';

import { createHonoApp } from './shell.js';

describe('createHonoApp', () => {
  it('responds on /health', async () => {
    const app = createHonoApp();
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status?: string };
    expect(body.status).toBe('ok');
  });
});
