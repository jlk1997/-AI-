/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Dev supervisor: keep platform-api listening on :3847 even if the child
 * crashes. Do NOT wrap `tsx watch` — that parent stays alive after the listen
 * child dies, which is exactly how Vite ends up with ECONNREFUSED.
 *
 * File edits: save still requires a process restart (child exit / Ctrl+C), or
 * rely on this loop after a crash. Prefer reliability over silent zombie watch.
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(here, '..');
const repoRoot = path.resolve(apiRoot, '../..');
const tsxCli = path.join(repoRoot, 'node_modules/tsx/dist/cli.cjs');
const entry = path.join(apiRoot, 'src/index.ts');
const envFile = path.join(repoRoot, '.env');

let generation = 0;
let child = null;
let shuttingDown = false;

function spawnOnce() {
  generation += 1;
  const gen = generation;
  console.log(
    `[platform-api] spawn #${gen} → tsx ${path.relative(repoRoot, entry)}`,
  );
  child = spawn(
    process.execPath,
    [
      '--max-old-space-size=8192',
      '--env-file',
      envFile,
      tsxCli,
      entry,
    ],
    {
      cwd: apiRoot,
      stdio: 'inherit',
      env: process.env,
      windowsHide: true,
    },
  );
  child.on('exit', (code, signal) => {
    child = null;
    if (shuttingDown) return;
    const reason = signal ? `signal ${signal}` : `code ${code ?? 0}`;
    console.error(
      `[platform-api] child exited (${reason}) — respawn in 1s (after exit #${gen})`,
    );
    setTimeout(spawnOnce, 1000);
  });
}

function shutdown() {
  shuttingDown = true;
  if (child && !child.killed) {
    child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(0), 500);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

spawnOnce();
