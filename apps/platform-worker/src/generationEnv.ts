/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { resolveOpenGameCliJs } from './opengameCli.js';

export type GenerationPaths = {
  readonly workRoot: string;
  readonly openGameCliJs: string;
  readonly gameTemplateDir: string;
  readonly gameDocsDir: string;
  readonly gameTemplatesParentDir: string;
};

export function readWorkRoot(): string {
  const workRoot = process.env['PLATFORM_WORK_ROOT']?.trim();
  if (!workRoot) {
    throw new Error('PLATFORM_WORK_ROOT is required for generate/build/bench jobs');
  }
  return path.resolve(workRoot);
}

/**
 * Validates paths required for real OpenGame generation (no stubs).
 */
export function readGenerationPaths(): GenerationPaths {
  const workRoot = readWorkRoot();
  const cliRaw = process.env['PLATFORM_OPENGAME_CLI']?.trim();
  const templateDir = process.env['PLATFORM_GAME_TEMPLATE_DIR']?.trim();
  const docsDir = process.env['PLATFORM_GAME_DOCS_DIR']?.trim();
  if (!cliRaw) {
    throw new Error(
      'PLATFORM_OPENGAME_CLI is required for generate jobs (absolute path to OpenGame dist/cli.js)',
    );
  }
  if (!templateDir || !fs.existsSync(templateDir)) {
    throw new Error(
      'PLATFORM_GAME_TEMPLATE_DIR must point to an existing template directory (e.g. .../agent-test/templates/core)',
    );
  }
  if (!docsDir || !fs.existsSync(docsDir)) {
    throw new Error(
      'PLATFORM_GAME_DOCS_DIR must point to an existing docs tree (e.g. .../agent-test/docs)',
    );
  }
  const gameTemplatesParentDir = process.env['PLATFORM_GAME_TEMPLATES_PARENT_DIR']?.trim();
  const parent =
    gameTemplatesParentDir && fs.existsSync(gameTemplatesParentDir)
      ? path.resolve(gameTemplatesParentDir)
      : path.resolve(templateDir, '..');
  const openGameCliJs = resolveOpenGameCliJs(cliRaw);
  return {
    workRoot,
    openGameCliJs,
    gameTemplateDir: path.resolve(templateDir),
    gameDocsDir: path.resolve(docsDir),
    gameTemplatesParentDir: parent,
  };
}

/** Optional GAME_* dirs for npm/bench subprocesses when set. */
export function readOptionalGameDocEnv(): {
  readonly gameTemplatesParentDir: string;
  readonly gameDocsDir: string;
} | null {
  const docsDir = process.env['PLATFORM_GAME_DOCS_DIR']?.trim();
  const templateDir = process.env['PLATFORM_GAME_TEMPLATE_DIR']?.trim();
  if (!docsDir || !fs.existsSync(docsDir)) {
    return null;
  }
  const gameTemplatesParentDir = process.env['PLATFORM_GAME_TEMPLATES_PARENT_DIR']?.trim();
  const parent =
    gameTemplatesParentDir && fs.existsSync(gameTemplatesParentDir)
      ? path.resolve(gameTemplatesParentDir)
      : templateDir && fs.existsSync(templateDir)
        ? path.resolve(templateDir, '..')
        : null;
  if (!parent) {
    return null;
  }
  return {
    gameTemplatesParentDir: parent,
    gameDocsDir: path.resolve(docsDir),
  };
}
