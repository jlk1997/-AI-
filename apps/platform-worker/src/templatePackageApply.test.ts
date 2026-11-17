/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { resolveOfficialTemplateDir } from './templatePackageApply.js';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('resolveOfficialTemplateDir', () => {
  it('maps official://core to the env template directory', () => {
    const core = fs.mkdtempSync(path.join(os.tmpdir(), 'og-core-'));
    dirs.push(core);
    expect(resolveOfficialTemplateDir('official://core', core)).toBe(core);
    expect(resolveOfficialTemplateDir('official://', core)).toBe(core);
  });

  it('accepts a file URL or an existing absolute directory', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-tpl-'));
    dirs.push(dir);
    expect(resolveOfficialTemplateDir(pathToFileURL(dir).href, '/unused')).toBe(dir);
    expect(resolveOfficialTemplateDir(dir, '/unused')).toBe(dir);
    expect(resolveOfficialTemplateDir('s3://bucket/templates/a.tgz', dir)).toBeNull();
  });
});
