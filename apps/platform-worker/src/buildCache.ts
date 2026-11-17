/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Fingerprint-based caches for the generate self-heal loop.
 *
 * Every FIX round used to redo the same heavy work: `npm run build` in the
 * linked `packages/runtime` (even when nothing there changed), a full Playwright
 * smoke against a byte-identical `dist/`, a MiniMax asset top-up over unchanged
 * PNGs, and a `tsc --noEmit` + `vite build` for a workspace the CLI never
 * touched (hard timeout, or an edit it reverted). On a 4-round job that is
 * minutes of pure repetition.
 *
 * These helpers are all mtime/size based on purpose: content hashing a Phaser
 * bundle costs more than the check saves, and mtime is exactly what a rebuild
 * would have touched.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

const CACHE_DIR = '.opengame-cache';
const RUNTIME_MARKER = '.opengame-src-fingerprint';

function hashOf(parts: readonly string[]): string {
  return crypto
    .createHash('sha256')
    .update(parts.join('|'))
    .digest('hex')
    .slice(0, 20);
}

/** Collects `rel:size:mtime` for every file under `dir`, sorted for stability. */
function statTree(
  dir: string,
  options: {
    readonly base?: string;
    readonly skipDirs?: readonly string[];
    readonly maxFiles?: number;
  } = {},
): string[] {
  const base = options.base ?? dir;
  const skip = new Set(options.skipDirs ?? ['node_modules', '.git', CACHE_DIR]);
  const maxFiles = options.maxFiles ?? 4000;
  const out: string[] = [];
  const walk = (current: string): void => {
    if (out.length >= maxFiles) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (out.length >= maxFiles) return;
      if (entry.isDirectory()) {
        if (skip.has(entry.name)) continue;
        walk(path.join(current, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      const full = path.join(current, entry.name);
      try {
        const st = fs.statSync(full);
        const rel = path.relative(base, full).replace(/\\/g, '/');
        out.push(`${rel}:${st.size}:${Math.round(st.mtimeMs)}`);
      } catch {
        // vanished mid-walk — treat as changed by omitting it
      }
    }
  };
  walk(dir);
  return out.sort();
}

function statPart(root: string, rel: string): string {
  try {
    const st = fs.statSync(path.join(root, rel));
    return `${rel}:${st.size}:${Math.round(st.mtimeMs)}`;
  } catch {
    return `${rel}:missing`;
  }
}

function cacheFilePath(workspace: string, name: string): string {
  return path.join(workspace, CACHE_DIR, `${name}.json`);
}

export function readCacheEntry<T>(workspace: string, name: string): T | null {
  const p = cacheFilePath(workspace, name);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as T;
  } catch {
    return null;
  }
}

export function writeCacheEntry(
  workspace: string,
  name: string,
  value: unknown,
): void {
  try {
    fs.mkdirSync(path.join(workspace, CACHE_DIR), { recursive: true });
    fs.writeFileSync(
      cacheFilePath(workspace, name),
      JSON.stringify(value, null, 2),
      'utf8',
    );
  } catch {
    // cache is best-effort; a miss just costs time, never correctness
  }
}

function dropCacheEntry(workspace: string, name: string): void {
  try {
    fs.rmSync(cacheFilePath(workspace, name), { force: true });
  } catch {
    // best-effort
  }
}

/* -------------------------------------------------------------------------- */
/* Linked @opengame/runtime rebuild                                            */
/* -------------------------------------------------------------------------- */

export function runtimePackageSourceFingerprint(linkedDir: string): string {
  const parts: string[] = [];
  for (const rel of ['package.json', 'tsconfig.json']) {
    parts.push(statPart(linkedDir, rel));
  }
  const srcDir = path.join(linkedDir, 'src');
  if (fs.existsSync(srcDir)) {
    parts.push(...statTree(srcDir, { base: linkedDir }));
  }
  return hashOf(parts);
}

/**
 * True when `dist/` was built from exactly this source tree, so `npm run build`
 * in the linked runtime would be a no-op.
 */
export function linkedRuntimeBuildIsFresh(linkedDir: string): boolean {
  const types = path.join(linkedDir, 'dist', 'index.d.ts');
  if (!fs.existsSync(types)) return false;
  const marker = path.join(linkedDir, 'dist', RUNTIME_MARKER);
  if (!fs.existsSync(marker)) return false;
  try {
    return (
      fs.readFileSync(marker, 'utf8').trim() ===
      runtimePackageSourceFingerprint(linkedDir)
    );
  } catch {
    return false;
  }
}

export function recordLinkedRuntimeBuild(linkedDir: string): void {
  try {
    const distDir = path.join(linkedDir, 'dist');
    if (!fs.existsSync(distDir)) return;
    fs.writeFileSync(
      path.join(distDir, RUNTIME_MARKER),
      runtimePackageSourceFingerprint(linkedDir),
      'utf8',
    );
  } catch {
    // best-effort
  }
}

/* -------------------------------------------------------------------------- */
/* Playability smoke                                                           */
/* -------------------------------------------------------------------------- */

export function distFingerprint(workspace: string): string {
  const distDir = path.join(workspace, 'dist');
  if (!fs.existsSync(distDir)) return 'missing';
  return hashOf(statTree(distDir, { base: distDir, maxFiles: 2000 }));
}

/* -------------------------------------------------------------------------- */
/* Preview upload                                                              */
/* -------------------------------------------------------------------------- */

export interface UploadedDistEntry {
  readonly fingerprint: string;
  readonly jobId: string;
  readonly distPrefix: string;
  readonly entryKey: string;
  readonly at: string;
}

/**
 * Bytes already in object storage for this job.
 *
 * A single job publishes several times — the early skeleton, the baseline
 * delivery, then one upload per escalation round — and rounds that only tighten
 * a gate often leave `dist/` byte-identical. Re-uploading a Phaser bundle plus
 * every PNG costs seconds of wall clock for nothing.
 *
 * Scoped to one job on purpose: reusing a key from an earlier job would trust
 * objects that a retention policy may since have removed.
 */
export function reusableDistUpload(
  workspace: string,
  jobId: string,
): UploadedDistEntry | null {
  const entry = readCacheEntry<UploadedDistEntry>(workspace, 'dist-upload');
  if (!entry || entry.jobId !== jobId) return null;
  const fingerprint = distFingerprint(workspace);
  if (fingerprint === 'missing' || entry.fingerprint !== fingerprint) return null;
  return entry;
}

export function recordDistUpload(
  workspace: string,
  entry: Omit<UploadedDistEntry, 'fingerprint' | 'at'>,
): void {
  writeCacheEntry(workspace, 'dist-upload', {
    ...entry,
    fingerprint: distFingerprint(workspace),
    at: new Date().toISOString(),
  } satisfies UploadedDistEntry);
}

export interface CachedSmokeEntry {
  readonly key: string;
  readonly ok: boolean;
  readonly issues: string[];
  readonly at: string;
}

/**
 * Smoke results are keyed by `dist` fingerprint *and* gate tier: the same bytes
 * can legitimately pass the baseline tier and fail once progress signals are
 * required.
 */
export function smokeCacheKey(workspace: string, tierId: string): string {
  return `${tierId}:${distFingerprint(workspace)}`;
}

export function readCachedSmoke(
  workspace: string,
  key: string,
): CachedSmokeEntry | null {
  const entry = readCacheEntry<CachedSmokeEntry>(workspace, 'smoke');
  if (!entry || entry.key !== key) return null;
  return entry;
}

export function writeCachedSmoke(
  workspace: string,
  key: string,
  result: { readonly ok: boolean; readonly issues: readonly string[] },
): void {
  writeCacheEntry(workspace, 'smoke', {
    key,
    ok: result.ok,
    issues: [...result.issues],
    at: new Date().toISOString(),
  } satisfies CachedSmokeEntry);
}

/* -------------------------------------------------------------------------- */
/* MiniMax asset top-up                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Changes whenever a generated asset or the DSL that references it moves, which
 * is exactly when a top-up pass could have something to do.
 */
export function assetTopUpFingerprint(workspace: string): string {
  const parts: string[] = [];
  const assetsDir = path.join(workspace, 'public', 'assets');
  if (fs.existsSync(assetsDir)) {
    parts.push(...statTree(assetsDir, { base: assetsDir, maxFiles: 500 }));
  } else {
    parts.push('assets:missing');
  }
  for (const rel of ['public/game.json', 'game.json']) {
    const full = path.join(workspace, rel);
    if (!fs.existsSync(full)) continue;
    parts.push(statPart(workspace, rel));
  }
  return hashOf(parts);
}

export function assetTopUpIsFresh(workspace: string, key: string): boolean {
  const entry = readCacheEntry<{ key?: string }>(workspace, 'asset-topup');
  return Boolean(entry?.key && entry.key === key);
}

export function recordAssetTopUp(workspace: string): void {
  writeCacheEntry(workspace, 'asset-topup', {
    key: assetTopUpFingerprint(workspace),
    at: new Date().toISOString(),
  });
}

/* -------------------------------------------------------------------------- */
/* Workspace typecheck + vite build                                            */
/* -------------------------------------------------------------------------- */

/** Files that change what `tsc` or `vite` do regardless of `src/` contents. */
const BUILD_CONFIG_FILES = [
  'package.json',
  'tsconfig.json',
  'tsconfig.opengame-worker.json',
  'vite.config.ts',
  'vite.config.js',
  'vite.config.mts',
  'index.html',
] as const;

export interface WorkspaceBuildKey {
  /** `src/` plus configs — the typechecker's inputs. */
  readonly source: string;
  /** Source plus `public/` — the bundle's inputs, since vite copies public/. */
  readonly bundle: string;
}

export interface BuildSkipDecision {
  readonly skipTypecheck: boolean;
  readonly skipBuild: boolean;
}

interface WorkspaceBuildEntry {
  readonly source?: string;
  readonly bundle?: string;
  readonly at?: string;
}

export function workspaceBuildKey(workspace: string): WorkspaceBuildKey {
  const parts: string[] = [];
  const srcDir = path.join(workspace, 'src');
  if (fs.existsSync(srcDir)) {
    parts.push(...statTree(srcDir, { base: workspace }));
  } else {
    parts.push('src:missing');
  }
  for (const rel of BUILD_CONFIG_FILES) {
    if (!fs.existsSync(path.join(workspace, rel))) continue;
    parts.push(statPart(workspace, rel));
  }
  const source = hashOf(parts);
  const publicDir = path.join(workspace, 'public');
  const publicParts = fs.existsSync(publicDir)
    ? statTree(publicDir, { base: workspace, maxFiles: 1500 })
    : ['public:missing'];
  return { source, bundle: hashOf([source, ...publicParts]) };
}

/**
 * A round that changed nothing must not spend budget reproducing a
 * byte-identical `dist/`. `PLATFORM_BUILD_CACHE=false` forces every round to
 * build, for when a stale skip is the suspect.
 */
export function buildSkipDecision(
  workspace: string,
  key: WorkspaceBuildKey,
): BuildSkipDecision {
  if (process.env['PLATFORM_BUILD_CACHE'] === 'false') {
    return { skipTypecheck: false, skipBuild: false };
  }
  const entry = readCacheEntry<WorkspaceBuildEntry>(workspace, 'workspace-build');
  if (!entry?.source) return { skipTypecheck: false, skipBuild: false };
  const skipTypecheck = entry.source === key.source;
  const distReady = fs.existsSync(path.join(workspace, 'dist', 'index.html'));
  return {
    skipTypecheck,
    skipBuild: skipTypecheck && entry.bundle === key.bundle && distReady,
  };
}

/** Record the inputs that produced the `dist/` now on disk. */
export function recordWorkspaceBuild(
  workspace: string,
  key: WorkspaceBuildKey,
): void {
  writeCacheEntry(workspace, 'workspace-build', {
    source: key.source,
    bundle: key.bundle,
    at: new Date().toISOString(),
  } satisfies WorkspaceBuildEntry);
}

export function clearWorkspaceBuildCache(workspace: string): void {
  dropCacheEntry(workspace, 'workspace-build');
}
