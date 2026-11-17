/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Playwright runner for playtest agent — one action → re-read __ogPlayProbe.
 */

import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';

export async function runPlaytestBrowser(args: {
  readonly distDir: string;
  readonly actions: string[];
}): Promise<{
  probes: Array<Record<string, unknown>>;
  reachedEnding: boolean;
}> {
  const indexHtml = path.join(args.distDir, 'index.html');
  if (!fs.existsSync(indexHtml)) {
    return { probes: [], reachedEnding: false };
  }

  let playwright: typeof import('playwright') | null = null;
  try {
    playwright = await import('playwright');
  } catch {
    return { probes: [], reachedEnding: false };
  }

  const port = 19100 + Math.floor(Math.random() * 800);
  const server = http.createServer((req, res) => {
    const urlPath = req.url?.split('?')[0] ?? '/';
    const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\//, '');
    const filePath = path.join(args.distDir, rel);
    if (!filePath.startsWith(args.distDir) || !fs.existsSync(filePath)) {
      res.statusCode = 404;
      res.end('not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const types: Record<string, string> = {
      '.html': 'text/html',
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.png': 'image/png',
    };
    res.setHeader('Content-Type', types[ext] ?? 'application/octet-stream');
    fs.createReadStream(filePath).pipe(res);
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(port, '127.0.0.1', () => resolve());
    server.on('error', reject);
  });

  const probes: Array<Record<string, unknown>> = [];
  let reachedEnding = false;
  let browser: import('playwright').Browser | null = null;

  try {
    browser = await playwright.chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/index.html`, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });
    await page.waitForTimeout(1200);

    for (const action of args.actions) {
      if (action === 'done') break;
      await page.keyboard.press(action).catch(() => undefined);
      await page.waitForTimeout(180);
      const probe = await page
        .evaluate(() => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const w = globalThis as any;
          const fn = w.__ogPlayProbe as
            | (() => Record<string, unknown>)
            | undefined;
          return typeof fn === 'function' ? fn() : {};
        })
        .catch(() => ({} as Record<string, unknown>));
      probes.push(probe);
      const scene = String(probe['sceneKey'] ?? '');
      if (/ending|victory|gameover/i.test(scene) || probe['won'] === true) {
        reachedEnding = true;
        break;
      }
    }
  } finally {
    await browser?.close().catch(() => undefined);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  return { probes, reachedEnding };
}
