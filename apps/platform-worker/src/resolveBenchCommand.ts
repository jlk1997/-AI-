/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Honest bench command: env override, else workspace `test:ci`, else `test`.
 * Never invent scores when there is nothing to run.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export type BenchCommandSource = 'env' | 'test:ci' | 'test';

export type BenchCommandResolution =
  | { readonly ok: true; readonly command: string; readonly source: BenchCommandSource }
  | { readonly ok: false; readonly reason: string };

export function readWorkspaceScripts(
  workspaceDir: string,
): Record<string, string> | null {
  const pkgPath = path.join(workspaceDir, 'package.json');
  if (!fs.existsSync(pkgPath)) return null;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
      scripts?: Record<string, string>;
    };
    return pkg.scripts ?? {};
  } catch {
    return {};
  }
}

export function resolveBenchCommand(
  workspaceDir: string,
  envCommand?: string | null,
): BenchCommandResolution {
  const override = envCommand?.trim();
  if (override) {
    return { ok: true, command: override, source: 'env' };
  }
  const scripts = readWorkspaceScripts(workspaceDir);
  if (scripts === null) {
    return {
      ok: false,
      reason:
        'Project workspace has no package.json; run a successful generate job first (or set PLATFORM_BENCH_COMMAND).',
    };
  }
  if (scripts['test:ci']) {
    return { ok: true, command: 'npm run test:ci', source: 'test:ci' };
  }
  if (scripts['test']) {
    return { ok: true, command: 'npm test', source: 'test' };
  }
  return {
    ok: false,
    reason:
      'Workspace has no test:ci or test script, and PLATFORM_BENCH_COMMAND is unset. No placeholder scores.',
  };
}
