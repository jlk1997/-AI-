/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { resolveBenchCommand } from './resolveBenchCommand.js';

const dirs: string[] = [];

function tmpWorkspace(scripts?: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-bench-'));
  dirs.push(dir);
  if (scripts) {
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'tmp', scripts }, null, 2),
    );
  }
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('resolveBenchCommand', () => {
  it('prefers PLATFORM_BENCH_COMMAND over package scripts', () => {
    const dir = tmpWorkspace({ 'test:ci': 'vitest run', test: 'vitest' });
    const resolved = resolveBenchCommand(dir, ' npm run custom-bench ');
    expect(resolved).toEqual({
      ok: true,
      command: 'npm run custom-bench',
      source: 'env',
    });
  });

  it('falls back to test:ci then test', () => {
    const ci = tmpWorkspace({ 'test:ci': 'vitest run', test: 'vitest' });
    expect(resolveBenchCommand(ci, null)).toMatchObject({
      ok: true,
      command: 'npm run test:ci',
      source: 'test:ci',
    });
    const testOnly = tmpWorkspace({ test: 'vitest' });
    expect(resolveBenchCommand(testOnly, '')).toMatchObject({
      ok: true,
      command: 'npm test',
      source: 'test',
    });
  });

  it('fails honestly when there is nothing to run', () => {
    const empty = tmpWorkspace();
    expect(resolveBenchCommand(empty, null).ok).toBe(false);
    const noScripts = tmpWorkspace({ build: 'vite build' });
    const missed = resolveBenchCommand(noScripts, undefined);
    expect(missed.ok).toBe(false);
    if (!missed.ok) expect(missed.reason).toMatch(/No placeholder scores/);
  });
});
