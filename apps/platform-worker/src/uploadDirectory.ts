/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

import { PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';

import type { WorkerEnv } from './env.js';
import { embedPngAuthorText, protectPlayJs } from './playBundleProtect.js';

async function walkFiles(rootDir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(current: string): Promise<void> {
    const entries = await fsp.readdir(current, { withFileTypes: true });
    for (const ent of entries) {
      const full = path.join(current, ent.name);
      if (ent.isDirectory()) {
        await walk(full);
      } else if (ent.isFile()) {
        out.push(full);
      }
    }
  }
  await walk(rootDir);
  return out;
}

function guessContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.map': 'application/json; charset=utf-8',
  };
  return map[ext] ?? 'application/octet-stream';
}

/**
 * Files that must never reach the play bundle.
 *
 * The uploaded prefix is what hosted playback serves to strangers, so it holds
 * the compiled build and nothing else. Source maps in particular would undo the
 * whole arrangement: they reconstruct the author's original TypeScript from the
 * minified bundle, which is exactly what a visitor is not supposed to receive.
 * A stray `.env` or `.ts` under `dist/` is rarer but far worse.
 */
const EXCLUDED_FROM_PLAY_BUNDLE = [
  /\.map$/i,
  /\.tsx?$/i,
  /(^|\/)\.env(\.|$)/i,
  /(^|\/)\.git(\/|$)/i,
  /(^|\/)node_modules(\/|$)/i,
  /\.(log|bak|orig|swp)$/i,
];

export function isExcludedFromPlayBundle(relPath: string): boolean {
  const norm = relPath.replace(/\\/g, '/');
  // `.d.ts` next to a bundle is a declaration file, not something a player runs.
  return EXCLUDED_FROM_PLAY_BUNDLE.some((re) => re.test(norm));
}

/** Text the play bundle may contain, and where a map reference could hide. */
const SOURCEMAP_REF_RE = /^[ \t]*(?:\/\/|\/\*)[#@]\s*sourceMappingURL=.*$/gm;

/**
 * Strips `sourceMappingURL` comments from the built bundle.
 *
 * Dropping the `.map` files on upload stops the maps being served, but the
 * pointer left in the JavaScript still tells anyone reading it that the author
 * builds with maps on, and turns every page load into a 404 in the console. The
 * pointer is worthless without its target, so it goes too.
 */
export function stripSourcemapRefs(text: string): string {
  return text.replace(SOURCEMAP_REF_RE, '').replace(/\n{3,}$/, '\n');
}

function isTextBundle(relPath: string): boolean {
  return /\.(js|mjs|cjs|css)$/i.test(relPath);
}

/**
 * Uploads every file under localDir to s3://bucket/s3Prefix/<relative path>,
 * minus anything that would leak the author's source. Returns the S3 key for
 * dist/index.html.
 */
export async function uploadDirectoryToS3(
  client: S3Client,
  env: WorkerEnv,
  s3Prefix: string,
  localDir: string,
  opts?: { readonly authorHandle?: string; readonly obfuscate?: boolean },
): Promise<{ readonly entryKey: string; readonly skipped: readonly string[] }> {
  const absLocal = path.resolve(localDir);
  const files = await walkFiles(absLocal);
  if (files.length === 0) {
    throw new Error(`no files to upload under ${localDir}`);
  }
  const prefix = s3Prefix.replace(/\/$/, '');
  const skipped: string[] = [];
  let entryKey = '';
  for (const abs of files) {
    const rel = path.relative(absLocal, abs).split(path.sep).join('/');
    if (isExcludedFromPlayBundle(rel)) {
      skipped.push(rel);
      continue;
    }
    const key = `${prefix}/${rel}`;
    const raw = await fsp.readFile(abs);
    let body: Buffer = raw;
    if (isTextBundle(rel)) {
      let text = stripSourcemapRefs(raw.toString('utf8'));
      if (/\.(js|mjs|cjs)$/i.test(rel)) {
        const obfuscate =
          opts?.obfuscate ?? process.env['PLATFORM_OBFUSCATE_PLAY_BUNDLE'] === 'true';
        // Vite already minified this. A regex comment-stripper used to eat
        // `"//cdn"` and leave `Uncaught SyntaxError: Invalid or unexpected token`.
        text = protectPlayJs(text, obfuscate);
      }
      body = Buffer.from(text, 'utf8');
    } else if (/\.png$/i.test(rel)) {
      body = embedPngAuthorText(raw, opts?.authorHandle ?? 'OpenGame');
    }
    await client.send(
      new PutObjectCommand({
        Bucket: env.s3Bucket,
        Key: key,
        Body: body,
        ContentType: guessContentType(abs),
      }),
    );
    if (rel === 'index.html') {
      entryKey = key;
    }
  }
  if (!entryKey) {
    throw new Error('vite build did not produce index.html at dist/index.html');
  }
  if (skipped.length > 0) {
    console.log(
      `[upload] kept ${skipped.length} source-revealing file(s) out of the play bundle: ${skipped
        .slice(0, 5)
        .join(', ')}`,
    );
  }
  return { entryKey, skipped };
}
