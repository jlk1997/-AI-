/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn } from 'node:child_process';

const MAX_CAPTURE_BYTES = 8 * 1024 * 1024;

export type RunProcessResult = {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
};

/**
 * Runs a shell command (single string) with optional cwd and env merge.
 * Output is captured up to MAX_CAPTURE_BYTES per stream.
 */
export function runShellCommand(
  command: string,
  options: {
    readonly cwd: string;
    readonly env: NodeJS.ProcessEnv;
  },
): Promise<RunProcessResult> {
  return new Promise((resolve, reject) => {
    const chunksOut: Buffer[] = [];
    const chunksErr: Buffer[] = [];
    let outLen = 0;
    let errLen = 0;
    const child = spawn(command, {
      cwd: options.cwd,
      env: options.env,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout?.on('data', (d: Buffer) => {
      if (outLen < MAX_CAPTURE_BYTES) {
        chunksOut.push(d);
        outLen += d.length;
      }
    });
    child.stderr?.on('data', (d: Buffer) => {
      if (errLen < MAX_CAPTURE_BYTES) {
        chunksErr.push(d);
        errLen += d.length;
      }
    });
    child.on('error', reject);
    child.on('close', (exitCode) => {
      resolve({
        exitCode,
        stdout: Buffer.concat(chunksOut, outLen).toString('utf8'),
        stderr: Buffer.concat(chunksErr, errLen).toString('utf8'),
      });
    });
  });
}

/**
 * Runs argv[0] with argv.slice(1), no shell (safe argument passing).
 * On Windows, resolves bare `npm` / `npx` to `*.cmd` so spawn does not ENOENT.
 */
export function runArgv(
  argv: readonly string[],
  options: {
    readonly cwd: string;
    readonly env: NodeJS.ProcessEnv;
    /** Optional: stream stdout chunks for live agent logs. */
    readonly onStdoutChunk?: (chunk: string) => void;
    /** Kill the child after this many ms (hard timeout). */
    readonly timeoutMs?: number;
    /** When aborted, kill the child (user cancel / job cancelled). */
    readonly abortSignal?: AbortSignal;
  },
): Promise<RunProcessResult> {
  if (argv.length === 0) {
    return Promise.reject(new Error('argv must not be empty'));
  }
  let [cmd, ...args] = argv;
  if (
    process.platform === 'win32' &&
    (cmd === 'npm' || cmd === 'npx')
  ) {
    cmd = `${cmd}.cmd`;
  }
  return new Promise((resolve, reject) => {
    if (options.abortSignal?.aborted) {
      resolve({
        exitCode: 130,
        stdout: '',
        stderr: '[platform-worker] process aborted before start (job cancelled)',
      });
      return;
    }
    const chunksOut: Buffer[] = [];
    const chunksErr: Buffer[] = [];
    let outLen = 0;
    let errLen = 0;
    let timedOut = false;
    let aborted = false;
    const child = spawn(cmd, args, {
      cwd: options.cwd,
      env: options.env,
      // npm.cmd requires a shell on some Windows setups
      shell: process.platform === 'win32' && /\.cmd$/i.test(cmd),
      stdio: ['ignore', 'pipe', 'pipe'],
      // Own process group so a timeout can kill CLI grandchildren
      // (playwright install, npm) and not only the node parent.
      detached: process.platform !== 'win32',
    });
    const killChild = () => {
      const pid = child.pid;
      try {
        if (pid && process.platform !== 'win32') {
          process.kill(-pid, 'SIGTERM');
        } else {
          child.kill('SIGTERM');
        }
      } catch {
        try {
          child.kill('SIGTERM');
        } catch {
          // already gone
        }
      }
      setTimeout(() => {
        try {
          if (pid && process.platform !== 'win32') process.kill(-pid, 'SIGKILL');
        } catch {
          // group already gone
        }
        try {
          child.kill('SIGKILL');
        } catch {
          // already gone
        }
      }, 5_000).unref?.();
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (options.timeoutMs && options.timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        killChild();
      }, options.timeoutMs);
    }
    const onAbort = () => {
      aborted = true;
      killChild();
    };
    if (options.abortSignal) {
      options.abortSignal.addEventListener('abort', onAbort, { once: true });
    }
    child.stdout?.on('data', (d: Buffer) => {
      if (outLen < MAX_CAPTURE_BYTES) {
        chunksOut.push(d);
        outLen += d.length;
      }
      options.onStdoutChunk?.(d.toString('utf8'));
    });
    child.stderr?.on('data', (d: Buffer) => {
      if (errLen < MAX_CAPTURE_BYTES) {
        chunksErr.push(d);
        errLen += d.length;
      }
    });
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      options.abortSignal?.removeEventListener('abort', onAbort);
      reject(err);
    });
    child.on('close', (exitCode) => {
      if (timer) clearTimeout(timer);
      options.abortSignal?.removeEventListener('abort', onAbort);
      const stderr = Buffer.concat(chunksErr, errLen).toString('utf8');
      if (aborted) {
        resolve({
          exitCode: 130,
          stdout: Buffer.concat(chunksOut, outLen).toString('utf8'),
          stderr: `${stderr}\n[platform-worker] process aborted (job cancelled)`,
        });
        return;
      }
      resolve({
        exitCode: timedOut ? 124 : exitCode,
        stdout: Buffer.concat(chunksOut, outLen).toString('utf8'),
        stderr: timedOut
          ? `${stderr}\n[platform-worker] process timed out after ${options.timeoutMs}ms (killed)`
          : stderr,
      });
    });
  });
}
