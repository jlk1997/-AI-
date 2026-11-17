/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Fingerprint MiniMax game art after style force-regen so artStyle ChangePlan
 * cannot pass on GDD text alone while PNGs stay unchanged / unused.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

const ART_FILES = [
  'player.png',
  'player_run.png',
  'background.png',
  'enemy.png',
  'item.png',
] as const;

export interface AssetFingerprint {
  readonly schema: 'opengame-asset-fingerprint-v1';
  readonly at: string;
  readonly artStyle?: string | null;
  readonly hashes: Record<string, string>;
  readonly bytes: Record<string, number>;
}

export function assetFingerprintPath(workspace: string): string {
  return path.join(workspace, 'public', 'ASSET_FINGERPRINT.json');
}

export function assetFingerprintPrevPath(workspace: string): string {
  return path.join(workspace, 'public', 'ASSET_FINGERPRINT_PREV.json');
}

async function hashFile(full: string): Promise<{ hash: string; bytes: number } | null> {
  if (!fs.existsSync(full)) return null;
  const buf = await fsp.readFile(full);
  return {
    hash: crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16),
    bytes: buf.length,
  };
}

async function listNarrativeArtFiles(assetsDir: string): Promise<string[]> {
  if (!fs.existsSync(assetsDir)) return [];
  try {
    const names = await fsp.readdir(assetsDir);
    return names.filter(
      (n) =>
        /^npc_[a-z0-9_]+\.png$/i.test(n) ||
          /^bg_chapter_\d+\.png$/i.test(n) ||
          /^bg_region_[a-z0-9_]+\.png$/i.test(n),
    );
  } catch {
    return [];
  }
}

export async function computeAssetFingerprint(
  workspace: string,
  artStyle?: string | null,
): Promise<AssetFingerprint> {
  const assetsDir = path.join(workspace, 'public', 'assets');
  const hashes: Record<string, string> = {};
  const bytes: Record<string, number> = {};
  const files = [
    ...ART_FILES,
    ...(await listNarrativeArtFiles(assetsDir)),
  ];
  for (const file of [...new Set(files)]) {
    const hit = await hashFile(path.join(assetsDir, file));
    if (hit) {
      hashes[file] = hit.hash;
      bytes[file] = hit.bytes;
    }
  }
  return {
    schema: 'opengame-asset-fingerprint-v1',
    at: new Date().toISOString(),
    artStyle: artStyle?.trim() || null,
    hashes,
    bytes,
  };
}

/** Snapshot current fingerprint to PREV before a style force-regen. */
export async function snapshotAssetFingerprintPrev(
  workspace: string,
): Promise<void> {
  const cur = assetFingerprintPath(workspace);
  if (fs.existsSync(cur)) {
    await fsp.copyFile(cur, assetFingerprintPrevPath(workspace));
    return;
  }
  const computed = await computeAssetFingerprint(workspace);
  if (Object.keys(computed.hashes).length === 0) return;
  await fsp.mkdir(path.join(workspace, 'public'), { recursive: true });
  await fsp.writeFile(
    assetFingerprintPrevPath(workspace),
    JSON.stringify(computed, null, 2),
    'utf8',
  );
}

export async function writeAssetFingerprint(
  workspace: string,
  artStyle?: string | null,
): Promise<AssetFingerprint> {
  const fp = await computeAssetFingerprint(workspace, artStyle);
  await fsp.mkdir(path.join(workspace, 'public'), { recursive: true });
  await fsp.writeFile(
    assetFingerprintPath(workspace),
    JSON.stringify(fp, null, 2),
    'utf8',
  );
  return fp;
}

export function readAssetFingerprint(
  workspace: string,
): AssetFingerprint | null {
  const p = assetFingerprintPath(workspace);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as AssetFingerprint;
  } catch {
    return null;
  }
}

export function readAssetFingerprintPrev(
  workspace: string,
): AssetFingerprint | null {
  const p = assetFingerprintPrevPath(workspace);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as AssetFingerprint;
  } catch {
    return null;
  }
}

function styleTokens(style: string): string[] {
  return style
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, ' ')
    .trim()
    .split(/\s+/)
    .filter((t) => t.length >= 2)
    .slice(0, 6);
}

/** Gate issues when ChangePlan artStyle did not land as new visible assets. */
export async function issuesFromArtStyleFingerprint(
  workspace: string,
  artStyle: string,
): Promise<string[]> {
  const issues: string[] = [];
  const fp = readAssetFingerprint(workspace);
  if (!fp || Object.keys(fp.hashes).length < 2) {
    issues.push(
      'ChangePlan artStyle: 缺少 ASSET_FINGERPRINT.json（force 重生后应写入 player/background 等哈希）',
    );
    return issues;
  }
  const want = styleTokens(artStyle);
  const got = (fp.artStyle ?? '').toLowerCase();
  if (want.length > 0 && !want.some((t) => got.includes(t))) {
    issues.push(
      `ChangePlan artStyle: 指纹 artStyle「${fp.artStyle ?? ''}」未对齐「${artStyle}」`,
    );
  }
  for (const f of ['player.png', 'background.png'] as const) {
    if (!fp.hashes[f]) {
      issues.push(`ChangePlan artStyle: 指纹缺少 ${f}`);
    }
  }

  const narrativeKeys = Object.keys(fp.hashes).filter(
    (k) => /^npc_/i.test(k) || /^bg_chapter_/i.test(k) || /^bg_region_/i.test(k),
  );

  const prev = readAssetFingerprintPrev(workspace);
  if (prev && Object.keys(prev.hashes).length > 0) {
    const coreChanged = (['player.png', 'background.png'] as const).some(
      (f) => fp.hashes[f] && prev.hashes[f] && fp.hashes[f] !== prev.hashes[f],
    );
    const narrativeChanged = narrativeKeys.some(
      (f) => fp.hashes[f] && prev.hashes[f] && fp.hashes[f] !== prev.hashes[f],
    );
    // If PREV had narrative slots, at least one must change with style regen
    const prevNarrative = Object.keys(prev.hashes).filter(
      (k) => /^npc_/i.test(k) || /^bg_chapter_/i.test(k) || /^bg_region_/i.test(k),
    );
    const changed =
      coreChanged ||
      (prevNarrative.length > 0 ? narrativeChanged : coreChanged);
    if (!changed) {
      const live = await computeAssetFingerprint(workspace, artStyle);
      const liveCore = (['player.png', 'background.png'] as const).some(
        (f) =>
          live.hashes[f] &&
          prev.hashes[f] &&
          live.hashes[f] !== prev.hashes[f],
      );
      const liveNarrative = prevNarrative.some(
        (f) =>
          live.hashes[f] &&
          prev.hashes[f] &&
          live.hashes[f] !== prev.hashes[f],
      );
      if (!liveCore && !(prevNarrative.length > 0 && liveNarrative)) {
        issues.push(
          'ChangePlan artStyle: 资产哈希相对 PREV 未变化 — 赛博/画风 force 重生未落地（含 NPC/章节背景）',
        );
      }
    }
  }

  // Scene must display MiniMax textures (not color-block-only)
  const scenesDir = path.join(workspace, 'src', 'scenes');
  if (fs.existsSync(scenesDir)) {
    let blob = '';
    for (const f of await fsp.readdir(scenesDir)) {
      if (!f.endsWith('.ts')) continue;
      blob += await fsp.readFile(path.join(scenesDir, f), 'utf8');
    }
    if (
      blob.length > 0 &&
      !/spriteOrRect|preloadGameArt|textures\.exists\(\s*['"](?:og_)?(?:player|bg|enemy)/i.test(
        blob,
      )
    ) {
      issues.push(
        'ChangePlan artStyle: Scene 未见 spriteOrRect/preloadGameArt — 画风重生后仍可能不可见',
      );
    }
  }

  return issues;
}
