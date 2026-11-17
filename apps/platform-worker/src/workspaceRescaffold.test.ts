/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { clearWorkspaceContents } from './workspaceRescaffold.js';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('clearWorkspaceContents', () => {
  it('removes files but keeps the workspace directory', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-rescaffold-'));
    dirs.push(dir);
    fs.writeFileSync(path.join(dir, 'package.json'), '{}');
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'src', 'main.ts'), 'export {}');
    const removed = await clearWorkspaceContents(dir);
    expect(removed).toBe(2);
    expect(fs.existsSync(dir)).toBe(true);
    expect(fs.existsSync(path.join(dir, 'package.json'))).toBe(false);
    expect(fs.readdirSync(dir)).toEqual([]);
  });
});
