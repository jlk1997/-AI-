/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Deterministic MiniMax seed for game workspaces — guarantees real PNG/MP3
 * on disk + game.json assets[] / audioTracks[] (no CLI hope / no placeholders).
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

import {
  artStyleProfile,
  resolveArtStyle,
  type ArtStyleProfile,
} from '@opengame/world-spec';

import {
  probeAudioBuffer,
  probePngBuffer,
  requireRealAssets,
} from './assetAuthenticity.js';
import { writeAudioWithFallback } from './audioFallback.js';
import {
  snapshotAssetFingerprintPrev,
  writeAssetFingerprint,
} from './assetFingerprint.js';
import {
  applyMattePolicy,
  isFullyOpaquePng,
  SCENE_PROMPT_SUFFIX,
  SPRITE_PROMPT_SUFFIX,
  slotMetaForId,
  shouldMatteAsset,
} from './assetMatte.js';
import {
  hasMinimaxCredentials,
  minimaxGenerateImagePng,
  takeProviderFailoverNotes,
  takeUserVisibleFailoverNotes,
  tryMinimaxGenerateMusicMp3,
  tryMinimaxGenerateSpeechMp3,
} from './minimaxClient.js';
import { composeWalkSheet, walkRealPoseCount } from './walkSheet.js';

export interface GameAssetPhaseResult {
  readonly files: string[];
  readonly patchedGameJson: boolean;
  readonly quality: 'minimax' | 'mixed-failover';
  /** Provider failover / soft-skip notes for agent timeline. */
  readonly failoverEvents: string[];
}

type ImageSlot = {
  id: string;
  file: string;
  prompt: string;
};

type AudioSlot = {
  id: string;
  file: string;
  kind: 'bgm' | 'sfx';
  promptOrText: string;
};

function readTitle(workspace: string): string {
  for (const rel of ['public/game.json', 'game.json']) {
    const p = path.join(workspace, rel);
    if (!fs.existsSync(p)) continue;
    try {
      const j = JSON.parse(fs.readFileSync(p, 'utf8')) as {
        meta?: { title?: string };
      };
      if (j.meta?.title?.trim()) return j.meta.title.trim();
    } catch {
      // ignore
    }
  }
  return 'OpenGame';
}

function readStyleHint(workspace: string, styleOverride?: string): string {
  if (styleOverride?.trim()) return styleOverride.trim().slice(0, 160);
  const gdd = path.join(workspace, 'GAME_DESIGN.md');
  if (fs.existsSync(gdd)) {
    try {
      const text = fs.readFileSync(gdd, 'utf8').slice(0, 2_000);
      const m = text.match(/art\s*style[:：]\s*(.+)/i);
      if (m?.[1]) return m[1].trim().slice(0, 120);
    } catch {
      // ignore
    }
  }
  return artStyleProfile().artStyle;
}

/**
 * Resolution / technique knobs for this run. The style picker decides the
 * sprite sheet size and whether pixel snapping is wanted — a painterly game
 * downsampled to 48x64 was the main reason generated art looked muddy.
 */
function styleProfileForRun(
  workspace: string,
  styleOverride?: string,
): ArtStyleProfile {
  return resolveArtStyle({ text: readStyleHint(workspace, styleOverride) });
}

function readReferenceImageHints(workspace: string): string[] {
  const p = path.join(workspace, 'public', 'REFERENCE_IMAGES.json');
  if (!fs.existsSync(p)) return [];
  try {
    const j = JSON.parse(fs.readFileSync(p, 'utf8')) as {
      hints?: string[];
      urls?: string[];
      localRefs?: string[];
    };
    return [
      ...(j.hints ?? []),
      ...(j.urls ?? []),
      ...(j.localRefs ?? []),
    ].filter((h): h is string => typeof h === 'string' && h.trim().length > 0);
  } catch {
    return [];
  }
}

async function writeReferenceImagesManifest(
  workspace: string,
  hints: readonly string[],
): Promise<void> {
  const dir = path.join(workspace, 'public');
  await fsp.mkdir(dir, { recursive: true });
  const urls = hints.filter((h) => /^https?:\/\//i.test(h));
  const localRefs = hints.filter(
    (h) =>
      /^(\.\/)?refs\//i.test(h) ||
      /[/\\]refs[/\\]/i.test(h) ||
      h.startsWith('assets/refs/'),
  );
  const text = hints.filter(
    (h) =>
      !/^https?:\/\//i.test(h) &&
      !localRefs.includes(h) &&
      !h.startsWith('data:'),
  );
  await fsp.writeFile(
    path.join(dir, 'REFERENCE_IMAGES.json'),
    JSON.stringify(
      {
        schema: 'opengame-reference-images-v1',
        hints: text.slice(0, 6),
        urls: urls.slice(0, 4),
        localRefs: localRefs.slice(0, 4),
        note: 'Text/URL/local refs injected into MiniMax image prompts (subject_reference multimodal later).',
        at: new Date().toISOString(),
      },
      null,
      2,
    ),
    'utf8',
  );
}

/**
 * Persist chat uploads (data URLs / http / short text) → public/refs + REFERENCE_IMAGES.json.
 * Returns hint strings for MiniMax prompts (never truncate base64 into the prompt).
 */
export async function persistChatReferenceImages(
  workspace: string,
  images: readonly string[] | undefined,
): Promise<string[]> {
  if (!images?.length) return readReferenceImageHints(workspace);
  const dir = path.join(workspace, 'public', 'refs');
  await fsp.mkdir(dir, { recursive: true });
  const hints: string[] = [];
  let i = 0;
  for (const raw of images.slice(0, 4)) {
    const data = /^data:image\/([\w+.-]+);base64,(.+)$/i.exec(raw.trim());
    if (data) {
      const kind = data[1]!.toLowerCase().replace('jpeg', 'jpg');
      const ext = ['png', 'jpg', 'webp', 'gif'].includes(kind) ? kind : 'png';
      const name = `ref_${i}.${ext}`;
      await fsp.writeFile(path.join(dir, name), Buffer.from(data[2]!, 'base64'));
      hints.push(`./refs/${name}`);
      i += 1;
      continue;
    }
    if (/^https?:\/\//i.test(raw.trim())) {
      hints.push(raw.trim().slice(0, 512));
      continue;
    }
    if (raw.trim().length >= 8 && raw.trim().length <= 400 && !raw.includes('base64,')) {
      hints.push(raw.trim());
    }
  }
  if (hints.length) {
    await writeReferenceImagesManifest(workspace, [
      ...hints,
      ...readReferenceImageHints(workspace),
    ]);
  }
  return hints;
}

async function needsRegenPng(full: string): Promise<boolean> {
  if (!fs.existsSync(full)) return true;
  const probe = probePngBuffer(await fsp.readFile(full));
  return !probe.ok;
}

async function needsRegenAudio(full: string): Promise<boolean> {
  if (!fs.existsSync(full)) return true;
  const probe = probeAudioBuffer(await fsp.readFile(full));
  return !probe.ok;
}

function upsertAsset(
  assets: Array<Record<string, unknown>>,
  id: string,
  kind: 'image' | 'audio',
  url: string,
): void {
  const idx = assets.findIndex(
    (a) => String(a['id'] ?? '') === id || String(a['url'] ?? '') === url,
  );
  const row = { id, kind, url };
  if (idx >= 0) assets[idx] = { ...assets[idx], ...row };
  else assets.push(row);
}

function upsertAudioTrack(
  tracks: Array<Record<string, unknown>>,
  assetId: string,
  role: string,
  loop: boolean,
): void {
  const idx = tracks.findIndex(
    (t) => String(t['assetId'] ?? t['id'] ?? '') === assetId,
  );
  const row = { assetId, role, loop, volume: role === 'bgm' ? 0.45 : 0.8 };
  if (idx >= 0) tracks[idx] = { ...tracks[idx], ...row };
  else tracks.push(row);
}

const GAME_IMAGE_IDS = [
  'player',
  'player_run',
  'background',
  'enemy',
  'item',
] as const;
const GAME_AUDIO_IDS = ['bgm', 'sfx_win', 'sfx_lose'] as const;

/** Cap narrative MiniMax slots (cost vs cast coverage). Overridable via env. */
function readAssetCap(envKey: string, fallback: number): number {
  const raw = process.env[envKey]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

function maxNarrativeNpcs(): number {
  return Math.max(1, Math.min(12, readAssetCap('PLATFORM_ASSET_MAX_NPCS', 6)));
}
function maxChapterBackgrounds(): number {
  return readAssetCap('PLATFORM_ASSET_MAX_CHAPTER_BGS', 2);
}
function maxRegionBackgrounds(): number {
  return readAssetCap('PLATFORM_ASSET_MAX_REGION_BGS', 2);
}

/** Parallel MiniMax image calls (player_run stays ordered after player). */
function imageGenConcurrency(): number {
  return Math.max(1, Math.min(8, readAssetCap('PLATFORM_ASSET_IMAGE_CONCURRENCY', 4)));
}

async function mapPool<T>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  let next = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), items.length) },
    async () => {
      while (true) {
        const i = next;
        next += 1;
        if (i >= items.length) return;
        await fn(items[i]!, i);
      }
    },
  );
  await Promise.all(workers);
}

function slugAssetId(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 24);
}

/** Planned npc_* / bg_chapter_* / bg_region_* ids from STORY_BIBLE + game.json. */
export function listExpectedNarrativeAssetSlots(workspace: string): string[] {
  const ids: string[] = [];
  const biblePath = path.join(workspace, 'public', 'STORY_BIBLE.json');
  if (fs.existsSync(biblePath)) {
    try {
      const bible = JSON.parse(fs.readFileSync(biblePath, 'utf8')) as {
        npcs?: Array<{ id?: string }>;
        chapters?: Array<{ id?: string; title?: string }>;
      };
      const npcs = (bible.npcs ?? [])
        .map((n) => n.id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
        .slice(0, maxNarrativeNpcs());
      for (const npcId of npcs) {
        ids.push(`npc_${slugAssetId(npcId)}`);
      }
      const chapters = bible.chapters ?? [];
      for (let i = 1; i < chapters.length && i <= maxChapterBackgrounds(); i++) {
        const pad = String(i + 1).padStart(2, '0');
        ids.push(`bg_chapter_${pad}`);
      }
    } catch {
      /* optional */
    }
  }
  const gamePath = path.join(workspace, 'public', 'game.json');
  if (fs.existsSync(gamePath)) {
    try {
      const game = JSON.parse(fs.readFileSync(gamePath, 'utf8')) as {
        scenes?: Array<{
          id?: string;
          customModule?: string;
          layoutOnly?: boolean;
        }>;
      };
      const all = game.scenes ?? [];
      const layoutPool = all.filter((s) => s.layoutOnly === true);
      const pool = layoutPool.length > 0 ? layoutPool : all;
      const regionIds = pool
        .map((s) => s.id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
        .filter(
          (id) =>
            !/Scene$/i.test(id) &&
            !/title|menu|gameover|victory|ending|battle|chapter|tdscene/i.test(
              id,
            ),
        )
        .slice(0, maxRegionBackgrounds());
      for (const id of regionIds) {
        const slug = slugAssetId(id);
        if (slug) ids.push(`bg_region_${slug}`);
      }
    } catch {
      /* optional */
    }
  }
  return [...new Set(ids)];
}

/** Discover npc_* / bg_chapter_* / bg_region_* already on disk. */
async function discoverNarrativeAssetIds(workspace: string): Promise<string[]> {
  const ids = new Set<string>();
  const assetsDir = path.join(workspace, 'public', 'assets');
  if (fs.existsSync(assetsDir)) {
    try {
      for (const name of await fsp.readdir(assetsDir)) {
        const m = name.match(
          /^(npc_[a-z0-9_]+|bg_chapter_\d+|bg_region_[a-z0-9_]+)\.png$/i,
        );
        if (m?.[1]) ids.add(m[1].toLowerCase());
      }
    } catch {
      /* optional */
    }
  }
  for (const id of listExpectedNarrativeAssetSlots(workspace)) {
    const file = path.join(assetsDir, `${id}.png`);
    if (fs.existsSync(file)) ids.add(id);
  }
  return [...ids];
}

function resolveEntityAssetId(
  tags: string[],
  id: string,
  imageIds: readonly string[],
): string | null {
  const blob = `${tags.join(' ')} ${id}`;
  if (
    imageIds.includes('player') &&
    (/player|hero|protagonist/.test(blob) || tags.includes('player'))
  ) {
    return 'player';
  }
  if (
    imageIds.includes('enemy') &&
    (/enemy|hazard|mob|monster|foe|boss|creep/.test(blob) ||
      tags.includes('enemy') ||
      tags.includes('hazard'))
  ) {
    return 'enemy';
  }
  if (
    imageIds.includes('item') &&
    (/item|coin|gem|pickup|loot|collect|powerup|chest/.test(blob) ||
      tags.includes('item') ||
      tags.includes('collectible'))
  ) {
    return 'item';
  }
  return null;
}

function wireEntitySprites(
  dsl: Record<string, unknown>,
  imageIds: readonly string[],
): number {
  const scenes = Array.isArray(dsl['scenes']) ? dsl['scenes'] : [];
  let wired = 0;
  for (const scene of scenes) {
    if (!scene || typeof scene !== 'object') continue;
    const entities = (scene as Record<string, unknown>)['entities'];
    if (!Array.isArray(entities)) continue;
    for (const ent of entities) {
      if (!ent || typeof ent !== 'object') continue;
      const e = ent as Record<string, unknown>;
      const tags = Array.isArray(e['tags'])
        ? e['tags'].map((t) => String(t).toLowerCase())
        : [];
      const id = String(e['id'] ?? '').toLowerCase();
      const want = resolveEntityAssetId(tags, id, imageIds);
      if (!want) continue;
      const sprite =
        e['sprite'] && typeof e['sprite'] === 'object'
          ? ({ ...(e['sprite'] as Record<string, unknown>) } as Record<
              string,
              unknown
            >)
          : ({ x: 0, y: 0 } as Record<string, unknown>);
      const current = String(sprite['assetId'] ?? '');
      // Always bind resolved MiniMax slot (overwrite wrong/stale assetId)
      if (current !== want) {
        sprite['assetId'] = want;
        // Drop shape so gate/runtime treat this as a real sprite (color kept for tint)
        delete sprite['shape'];
        e['sprite'] = sprite;
        wired += 1;
      } else if (sprite['shape']) {
        delete sprite['shape'];
        e['sprite'] = sprite;
        wired += 1;
      }
    }
  }
  return wired;
}

async function patchGameJson(
  workspace: string,
  imageIds: string[],
  audioIds: string[],
): Promise<boolean> {
  const gamePath = path.join(workspace, 'public', 'game.json');
  if (!fs.existsSync(gamePath)) return false;
  let dsl: Record<string, unknown>;
  try {
    dsl = JSON.parse(await fsp.readFile(gamePath, 'utf8')) as Record<
      string,
      unknown
    >;
  } catch {
    return false;
  }
  const assets = Array.isArray(dsl['assets'])
    ? ([...dsl['assets']] as Array<Record<string, unknown>>)
    : [];
  const audioTracks = Array.isArray(dsl['audioTracks'])
    ? ([...dsl['audioTracks']] as Array<Record<string, unknown>>)
    : [];

  for (const id of imageIds) {
    upsertAsset(assets, id, 'image', `./assets/${id}.png`);
  }
  for (const id of audioIds) {
    upsertAsset(assets, id, 'audio', `./assets/${id}.mp3`);
    upsertAudioTrack(
      audioTracks,
      id,
      id === 'bgm' ? 'bgm' : 'sfx',
      id === 'bgm',
    );
  }
  // Coin juice alias — reuse sfx_win without an extra MiniMax call
  if (audioIds.includes('sfx_win') || assets.some((a) => a['id'] === 'sfx_win')) {
    upsertAsset(assets, 'sfx_coin', 'audio', './assets/sfx_win.mp3');
    upsertAudioTrack(audioTracks, 'sfx_coin', 'sfx', false);
  }

  wireEntitySprites(dsl, imageIds);

  // Strip unimplemented DSL so preview never depends on dead fields
  delete dsl['gameFlow'];
  delete dsl['spawners'];
  delete dsl['entities_templates'];
  if (dsl['sceneConfig']) delete dsl['sceneConfig'];

  dsl['assets'] = assets;
  dsl['audioTracks'] = audioTracks;
  await fsp.writeFile(gamePath, JSON.stringify(dsl, null, 2), 'utf8');
  return true;
}

/** Copy public game.json + assets into vite dist so preview matches disk. */
export async function syncPublicAssetsToDist(
  workspace: string,
): Promise<string[]> {
  const dist = path.join(workspace, 'dist');
  if (!fs.existsSync(dist)) return [];
  const copied: string[] = [];
  const gameSrc = path.join(workspace, 'public', 'game.json');
  if (fs.existsSync(gameSrc)) {
    await fsp.copyFile(gameSrc, path.join(dist, 'game.json'));
    copied.push('dist/game.json');
  }
  const briefSrc = path.join(workspace, 'public', 'ASSET_BRIEF.json');
  if (fs.existsSync(briefSrc)) {
    await fsp.copyFile(briefSrc, path.join(dist, 'ASSET_BRIEF.json'));
    copied.push('dist/ASSET_BRIEF.json');
  }
  // Runtime bootstrap always probes ./og_intent.json; keep an empty stub so
  // first-generate previews / smoke do not console-404 and fail the gate.
  const intentSrc = path.join(workspace, 'public', 'og_intent.json');
  if (!fs.existsSync(intentSrc)) {
    await fsp.mkdir(path.dirname(intentSrc), { recursive: true });
    await fsp.writeFile(intentSrc, '{}\n', 'utf8');
  }

  for (const name of [
    'CHANGE_PLAN.json',
    'og_intent.json',
    'JUICE_BASELINE.json',
    'ARCADE_KERNEL.json',
    'BOARD_KERNEL.json',
    'MECHANIC.json',
    'GAME_INTENT.json',
    'CAPABILITY.json',
    'REFERENCE_IMAGES.json',
    'RESET_STAMP.json',
    'ASSET_FINGERPRINT.json',
    'ASSET_FINGERPRINT_PREV.json',
    'RECOVERY.json',
    'WORLD_SEED.json',
    'WORLD_LINEAGE.json',
    'STORY_BIBLE.json',
    'CONTENT_GRAPH.json',
    'SYSTEMS.json',
    'CONTENT.json',
    'VISION_QA.json',
    'PLAYTEST_REPORT.json',
  ]) {
    const src = path.join(workspace, 'public', name);
    if (!fs.existsSync(src)) continue;
    await fsp.copyFile(src, path.join(dist, name));
    copied.push(`dist/${name}`);
  }
  // Multi-chapter story JSON for preview/smoke after vite build
  const storySrc = path.join(workspace, 'public', 'story');
  const storyDest = path.join(dist, 'story');
  if (fs.existsSync(storySrc)) {
    await fsp.mkdir(storyDest, { recursive: true });
    for (const name of await fsp.readdir(storySrc)) {
      const from = path.join(storySrc, name);
      const st = await fsp.stat(from);
      if (!st.isFile()) continue;
      await fsp.copyFile(from, path.join(storyDest, name));
      copied.push(`dist/story/${name}`);
    }
  }
  const assetsSrc = path.join(workspace, 'public', 'assets');
  const assetsDest = path.join(dist, 'assets');
  if (fs.existsSync(assetsSrc)) {
    await fsp.mkdir(assetsDest, { recursive: true });
    for (const name of await fsp.readdir(assetsSrc)) {
      const from = path.join(assetsSrc, name);
      const st = await fsp.stat(from);
      if (!st.isFile()) continue;
      await fsp.copyFile(from, path.join(assetsDest, name));
      copied.push(`dist/assets/${name}`);
    }
  }
  return copied;
}

async function resolveSubjectReferenceImageFile(
  workspace: string,
  hints: readonly string[],
): Promise<string | undefined> {
  const disabled =
    process.env['PLATFORM_MINIMAX_SUBJECT_REF'] === 'false' ||
    process.env['PLATFORM_MINIMAX_SUBJECT_REF'] === '0';
  if (disabled) return undefined;

  const http = hints.find((h) => /^https?:\/\//i.test(h));
  if (http) return http.slice(0, 2048);

  const localHint = hints.find(
    (h) =>
      /^(\.\/)?refs\//i.test(h) ||
      /[/\\]refs[/\\]/i.test(h) ||
      h.startsWith('assets/refs/'),
  );
  const candidates: string[] = [];
  if (localHint) {
    const rel = localHint.replace(/^\.\//, '').replace(/^assets\//, '');
    candidates.push(path.join(workspace, 'public', rel));
    candidates.push(path.join(workspace, 'public', 'refs', path.basename(rel)));
  }
  const refsDir = path.join(workspace, 'public', 'refs');
  if (fs.existsSync(refsDir)) {
    for (const f of await fsp.readdir(refsDir)) {
      if (/\.(png|jpe?g|webp)$/i.test(f)) {
        candidates.push(path.join(refsDir, f));
        break;
      }
    }
  }
  for (const full of candidates) {
    if (!fs.existsSync(full)) continue;
    try {
      const buf = await fsp.readFile(full);
      if (buf.length < 32 || buf.length > 4_000_000) continue;
      const ext = path.extname(full).toLowerCase().replace('.', '') || 'png';
      const mime =
        ext === 'jpg' || ext === 'jpeg'
          ? 'image/jpeg'
          : ext === 'webp'
            ? 'image/webp'
            : 'image/png';
      return `data:${mime};base64,${buf.toString('base64')}`;
    } catch {
      // try next
    }
  }
  return undefined;
}

async function localPngAsDataUrl(full: string): Promise<string | undefined> {
  if (!fs.existsSync(full)) return undefined;
  try {
    const buf = await fsp.readFile(full);
    if (buf.length < 32 || buf.length > 4_000_000) return undefined;
    return `data:image/png;base64,${buf.toString('base64')}`;
  } catch {
    return undefined;
  }
}

/**
 * Materialize MiniMax player/background + BGM/SFX under public/assets and
 * wire public/game.json. Skips files that already pass authenticity probes.
 */
export async function runGameAssetPhase(
  workspace: string,
  opts?: {
    readonly force?: boolean;
    readonly patchOnly?: boolean;
    /**
     * Write the asset files but leave `public/game.json` alone — for running
     * concurrently with a CLI round that owns the DSL. Wire it afterwards with
     * `patchOnly`.
     */
    readonly deferPatch?: boolean;
    readonly styleOverride?: string;
    /** Skip auto-matte for sprite slots (portraits / keep plate). */
    readonly keepBackground?: boolean;
    readonly referenceImageHints?: readonly string[];
  },
): Promise<GameAssetPhaseResult> {
  if (
    process.env['PLATFORM_ALLOW_PLACEHOLDER_ASSETS'] === 'true' ||
    process.env['WORLD_ALLOW_PLACEHOLDER_ASSETS'] === 'true'
  ) {
    throw new Error(
      'PLATFORM/WORLD_ALLOW_PLACEHOLDER_ASSETS is set — placeholders removed from product path; unset and use MiniMax',
    );
  }
  // Product default: when real-asset policy is on OR caller forces, MiniMax is mandatory.
  // Opportunistic: if policy off but credentials exist, still seed (never silent skip with key).
  const must =
    requireRealAssets() ||
    opts?.force === true ||
    process.env['PLATFORM_GAME_MINIMAX_ASSETS'] === 'true';
  if (!must && !hasMinimaxCredentials()) {
    return {
      files: [],
      patchedGameJson: false,
      quality: 'minimax',
      failoverEvents: [],
    };
  }
  if (!hasMinimaxCredentials()) {
    throw new Error(
      'Game ASSET: MiniMax API key missing — real assets required, no placeholders',
    );
  }

  if (opts?.patchOnly) {
    const narrativeIds = await discoverNarrativeAssetIds(workspace);
    const patched = await patchGameJson(
      workspace,
      [...GAME_IMAGE_IDS, ...narrativeIds],
      [...GAME_AUDIO_IDS],
    );
    return {
      files: patched
        ? [`game.json (patched${narrativeIds.length ? `+${narrativeIds.length} narrative` : ''})`]
        : [],
      patchedGameJson: patched,
      quality: 'minimax',
      failoverEvents: [],
    };
  }

  const assetsDir = path.join(workspace, 'public', 'assets');
  await fsp.mkdir(assetsDir, { recursive: true });

  const title = readTitle(workspace);
  const style = readStyleHint(workspace, opts?.styleOverride);
  const styleProfile = styleProfileForRun(workspace, opts?.styleOverride);
  const refHints = [
    ...(opts?.referenceImageHints ?? []),
    ...readReferenceImageHints(workspace),
  ].filter(Boolean);
  const refUrls = refHints.filter((h) => /^https?:\/\//i.test(h));
  const refLocal = refHints.filter(
    (h) =>
      /^(\.\/)?refs\//i.test(h) ||
      /[/\\]refs[/\\]/i.test(h) ||
      h.startsWith('assets/refs/'),
  );
  const refText = refHints.filter(
    (h) =>
      !/^https?:\/\//i.test(h) &&
      !refLocal.includes(h) &&
      !h.startsWith('data:'),
  );
  const refHintParts: string[] = [];
  if (refText.length) {
    refHintParts.push(
      `Match reference mood/palette described as: ${refText.join('; ').slice(0, 220)}`,
    );
  }
  if (refUrls.length) {
    refHintParts.push(
      `Visually consistent with reference image(s) at: ${refUrls.slice(0, 2).join(' | ')}. Echo palette, materials, and silhouette language; do not copy logos or watermarks.`,
    );
  }
  if (refLocal.length) {
    refHintParts.push(
      `User uploaded reference image(s) saved as ${refLocal.slice(0, 2).join(', ')} — match that upload's palette, materials, and silhouette language closely.`,
    );
  }
  const refHint = refHintParts.length ? ` ${refHintParts.join(' ')}` : '';
  if (refHints.length) {
    await writeReferenceImagesManifest(workspace, refHints);
  }
  const written: string[] = [];
  const failoverEvents: string[] = [];
  const drainFailover = () => {
    // Drop internal silent-rotate notes; only pool-exhausted messages are product-facing.
    takeProviderFailoverNotes();
    for (const n of takeUserVisibleFailoverNotes()) failoverEvents.push(n);
  };

  if (opts?.force || opts?.styleOverride) {
    await snapshotAssetFingerprintPrev(workspace);
  }

  const subjectRef = await resolveSubjectReferenceImageFile(
    workspace,
    refHints,
  );
  if (subjectRef) {
    written.push(
      subjectRef.startsWith('data:')
        ? 'subject_reference:local-ref'
        : 'subject_reference:url',
    );
  }

  const images: ImageSlot[] = [
    {
      id: 'player',
      file: 'player.png',
      prompt: `Game protagonist character sprite for "${title}", ${style},${refHint} SIDE VIEW facing right, idle pose, clear silhouette,${SPRITE_PROMPT_SUFFIX}`,
    },
    {
      id: 'background',
      file: 'background.png',
      prompt: `Full-bleed game background scene for "${title}", ${style},${refHint} atmospheric environment,${SCENE_PROMPT_SUFFIX}`,
    },
    {
      id: 'enemy',
      file: 'enemy.png',
      prompt: `Hostile enemy creature game sprite for "${title}", ${style},${refHint} SIDE VIEW facing right, menacing but readable at small size,${SPRITE_PROMPT_SUFFIX}`,
    },
    {
      id: 'item',
      file: 'item.png',
      prompt: `Collectible item or coin icon for "${title}", ${style},${refHint} glowing gem or coin, centered, readable,${SPRITE_PROMPT_SUFFIX}`,
    },
    {
      id: 'player_run',
      file: 'player_run.png',
      prompt: `Same protagonist as the game hero for "${title}", ${style},${refHint} SIDE VIEW facing right, RUNNING / walking stride pose, clear limbs,${SPRITE_PROMPT_SUFFIX}`,
    },
  ];

  // Narrative extras: per-NPC portraits + per-chapter backgrounds (shared style string)
  try {
    const biblePath = path.join(workspace, 'public', 'STORY_BIBLE.json');
    if (fs.existsSync(biblePath)) {
      const bible = JSON.parse(fs.readFileSync(biblePath, 'utf8')) as {
        npcs?: Array<{ id?: string; role?: string }>;
        chapters?: Array<{ id?: string; title?: string }>;
      };
      const npcs = (bible.npcs ?? [])
        .map((n) => n.id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
        .slice(0, maxNarrativeNpcs());
      for (const npcId of npcs) {
        const slug = npcId.toLowerCase().replace(/[^a-z0-9_]/g, '_');
        images.push({
          id: `npc_${slug}`,
          file: `npc_${slug}.png`,
          prompt: `NPC portrait bust for character "${npcId}" in "${title}", ${style},${refHint} facing camera, clear silhouette, consistent style fingerprint,${SPRITE_PROMPT_SUFFIX}`,
        });
      }
      const chapters = bible.chapters ?? [];
      for (let i = 1; i < chapters.length && i <= maxChapterBackgrounds(); i++) {
        const ch = chapters[i]!;
        const pad = String(i + 1).padStart(2, '0');
        const chTitle = ch.title ?? `Chapter ${i + 1}`;
        images.push({
          id: `bg_chapter_${pad}`,
          file: `bg_chapter_${pad}.png`,
          prompt: `Full-bleed background for chapter "${chTitle}" in "${title}", ${style},${refHint} same art direction as main background, distinct location beat for chapter ${i + 1},${SCENE_PROMPT_SUFFIX}`,
        });
      }
    }
  } catch {
    // optional narrative slots
  }

  // Region backgrounds from multi-scene game.json (World multi-region)
  try {
    const expected = listExpectedNarrativeAssetSlots(workspace).filter((id) =>
      id.startsWith('bg_region_'),
    );
    for (const id of expected) {
      if (images.some((i) => i.id === id)) continue;
      const label = id.replace(/^bg_region_/, '').replace(/_/g, ' ');
      images.push({
        id,
        file: `${id}.png`,
        prompt: `Full-bleed overworld region background "${label}" for "${title}", ${style},${refHint} same art direction as main background, readable landmark silhouette,${SCENE_PROMPT_SUFFIX}`,
      });
    }
  } catch {
    /* optional */
  }

  const materializeImage = async (slot: ImageSlot): Promise<void> => {
    const full = path.join(assetsDir, slot.file);
    if (!opts?.force && !(await needsRegenPng(full))) {
      // Heal opaque sprite leftovers without a full MiniMax regen.
      if (
        !opts?.keepBackground &&
        shouldMatteAsset(slot.id) &&
        fs.existsSync(full)
      ) {
        try {
          const existing = await fsp.readFile(full);
          if (await isFullyOpaquePng(existing)) {
            const healed = await applyMattePolicy(existing, slot.id, {
              force: true,
            });
            if (healed.note) failoverEvents.push(healed.note);
            if (healed.matted && !(await isFullyOpaquePng(healed.buffer))) {
              await fsp.writeFile(full, healed.buffer);
              written.push(`assets/${slot.file} (kept+rematte)`);
              return;
            }
          }
        } catch (err) {
          failoverEvents.push(
            `rematte ${slot.file}: ${err instanceof Error ? err.message.slice(0, 80) : String(err)}`,
          );
        }
      }
      written.push(`assets/${slot.file} (kept)`);
      return;
    }
    // player_run consistency: prefer just-written player.png as subject ref
    let runRef = subjectRef;
    if (slot.id === 'player_run') {
      runRef =
        (await localPngAsDataUrl(path.join(assetsDir, 'player.png'))) ??
        subjectRef;
    }
    const png = await minimaxGenerateImagePng({
      prompt: slot.prompt,
      aspectRatio:
        slot.id === 'background' ||
        slot.id.startsWith('bg_chapter_') ||
        slot.id.startsWith('bg_region_')
          ? '16:9'
          : '1:1',
      subjectReferenceImageFile:
        slot.id === 'player' ||
        slot.id === 'enemy' ||
        slot.id === 'player_run' ||
        slot.id.startsWith('npc_')
          ? runRef
          : undefined,
    });
    drainFailover();
    const probe = probePngBuffer(png);
    if (!probe.ok) {
      throw new Error(`Game ASSET ${slot.file}: ${probe.reason}`);
    }
    const matted = await applyMattePolicy(png, slot.id, {
      keepBackground: opts?.keepBackground,
    });
    if (matted.note) failoverEvents.push(matted.note);
    const finalProbe = probePngBuffer(matted.buffer);
    if (!finalProbe.ok) {
      throw new Error(`Game ASSET ${slot.file} after matte: ${finalProbe.reason}`);
    }
    await fsp.writeFile(full, matted.buffer);
    written.push(
      matted.matted ? `assets/${slot.file} (matte)` : `assets/${slot.file}`,
    );
  };

  // Parallel images; player_run waits so subject_reference can use player.png.
  const independentImages = images.filter((s) => s.id !== 'player_run');
  const runSlot = images.find((s) => s.id === 'player_run');
  await mapPool(independentImages, imageGenConcurrency(), (slot) =>
    materializeImage(slot),
  );
  if (runSlot) await materializeImage(runSlot);

  // Ensure player_run exists (idle fallback) so Boot/pose wiring never 404s.
  const runFull = path.join(assetsDir, 'player_run.png');
  const playerFull = path.join(assetsDir, 'player.png');
  if (!fs.existsSync(runFull) && fs.existsSync(playerFull)) {
    await fsp.copyFile(playerFull, runFull);
    written.push('assets/player_run.png (copied-from-player)');
  }

  // 4-dir walk frames via MiniMax subjectReference → pack player_walk.png
  if (
    fs.existsSync(playerFull) &&
    process.env['PLATFORM_SKIP_WALK_ATLAS'] !== 'true'
  ) {
    try {
      const { walkCyclePrompts, defaultWalkLayout, buildWalkAtlasJson } =
        await import('@opengame/asset-forge');
      const layout = defaultWalkLayout(
        styleProfile.frameWidth,
        styleProfile.frameHeight,
      );
      const prompts = walkCyclePrompts(style, `protagonist of "${title}"`, {
        pixelPerfect: styleProfile.pixelPerfect,
        framesPerDir: layout.framesPerDir,
      });
      const playerRef =
        (await localPngAsDataUrl(playerFull)) ?? subjectRef;
      const dirs = ['down', 'left', 'right', 'up'] as const;
      const poses = walkRealPoseCount(layout.framesPerDir);
      const renders = new Map<(typeof dirs)[number], Buffer[]>();
      for (const dir of dirs) {
        const perDir: Buffer[] = [];
        for (let p = 0; p < poses; p++) {
          // Distinct stride per pose; composeWalkSheet fills any remaining slot.
          const png = await minimaxGenerateImagePng({
            prompt: prompts[dir][p] ?? prompts[dir][0]!,
            aspectRatio: '1:1',
            subjectReferenceImageFile: playerRef,
          });
          drainFailover();
          perDir.push(png);
        }
        if (perDir.length) renders.set(dir, perDir);
      }
      if (renders.size === dirs.length) {
        const walkPath = path.join(assetsDir, 'player_walk.png');
        await composeWalkSheet({
          dest: walkPath,
          renders,
          layout,
          pixelPerfect: styleProfile.pixelPerfect,
        });
        const atlas = buildWalkAtlasJson('player_walk.png', layout, 'walk');
        await fsp.writeFile(
          path.join(assetsDir, 'player_walk.json'),
          JSON.stringify(atlas, null, 2),
          'utf8',
        );
        written.push(
          `assets/player_walk.png (minimax-4dir x${poses}pose)`,
        );
        written.push('assets/player_walk.json');
      }
    } catch (err) {
      failoverEvents.push(
        `walk-atlas: ${err instanceof Error ? err.message.slice(0, 100) : String(err)}`,
      );
    }
  }

  const audios: AudioSlot[] = [
    {
      id: 'bgm',
      file: 'bgm.mp3',
      kind: 'bgm',
      promptOrText: `Instrumental game BGM for "${title}", ${style}, looping-friendly, no vocals`,
    },
    {
      id: 'sfx_win',
      file: 'sfx_win.mp3',
      kind: 'sfx',
      promptOrText: 'Victory! You win!',
    },
    {
      id: 'sfx_lose',
      file: 'sfx_lose.mp3',
      kind: 'sfx',
      promptOrText: 'Defeat. Try again.',
    },
  ];

  const materializeAudio = async (slot: AudioSlot): Promise<void> => {
    const full = path.join(assetsDir, slot.file);
    if (!opts?.force && !(await needsRegenAudio(full))) {
      written.push(`assets/${slot.file} (kept)`);
      return;
    }
    const buf =
      slot.kind === 'bgm'
        ? await tryMinimaxGenerateMusicMp3({ prompt: slot.promptOrText })
        : await tryMinimaxGenerateSpeechMp3({ text: slot.promptOrText });
    drainFailover();
    await writeAudioWithFallback({
      destPath: full,
      rel: `assets/${slot.file}`,
      fresh: buf,
      written,
      failoverEvents,
    });
  };

  await mapPool(audios, 2, (slot) => materializeAudio(slot));

  const patched = opts?.deferPatch
    ? false
    : await patchGameJson(
        workspace,
        images.map((i) => i.id),
        audios.map((a) => a.id),
      );

  const roleOf = (id: string) =>
    id === 'background' || id.startsWith('bg_')
      ? 'tile'
      : id === 'item'
        ? 'item'
        : id === 'player_run' || id.startsWith('npc_')
          ? 'player'
          : id;

  const quality =
    failoverEvents.length > 0 ? ('mixed-failover' as const) : ('minimax' as const);

  const brief = {
    schema: 'opengame-game-asset-brief-v1',
    assetQuality: quality,
    provider: quality === 'mixed-failover' ? 'minimax+ark' : 'minimax',
    failoverEvents,
    title,
    mattePolicy: 'scene-opaque-sprite-auto',
    /** ArtDirector-style storyboard — narrative slots already generated above. */
    storyboard: {
      schema: 'opengame-storyboard-v1',
      npcs: images
        .filter((i) => i.id.startsWith('npc_'))
        .map((i) => ({
          id: i.id,
          file: `./assets/${i.file}`,
          prompt: i.prompt.slice(0, 280),
        })),
      chapters: images
        .filter((i) => i.id.startsWith('bg_chapter_'))
        .map((i) => ({
          id: i.id,
          file: `./assets/${i.file}`,
          prompt: i.prompt.slice(0, 280),
        })),
      regions: images
        .filter((i) => i.id.startsWith('bg_region_'))
        .map((i) => ({
          id: i.id,
          file: `./assets/${i.file}`,
          prompt: i.prompt.slice(0, 280),
        })),
      expectedSlots: listExpectedNarrativeAssetSlots(workspace),
      regionBgmPlan: listExpectedNarrativeAssetSlots(workspace)
        .filter((id) => id.startsWith('bg_region_'))
        .map((id) => ({
          id: id.replace(/^bg_region_/, 'bgm_region_'),
          note: 'Optional — wire if audio file exists; World falls back to bgm volume by region',
        })),
    },
    assets: [
      ...images.map((i) => {
        const meta = slotMetaForId(i.id);
        return {
          id: i.id,
          role: roleOf(i.id),
          file: `./assets/${i.file}`,
          kind: 'image',
          source: 'minimax-image',
          matte: meta.matte,
          assetRole: meta.role,
          ...(meta.pose ? { pose: meta.pose } : {}),
        };
      }),
      ...audios.map((a) => ({
        id: a.id,
        role: a.id === 'bgm' ? 'bgm' : 'sfx',
        file: `./assets/${a.file}`,
        kind: 'audio',
        source: a.kind === 'bgm' ? 'minimax-music' : 'minimax-speech',
      })),
    ],
    // World-presenter compatible aliases
    placeholders: images.map((i) => ({
      role: roleOf(i.id),
      file: `./assets/${i.file}`,
      source: 'minimax-image',
    })),
    audio: audios.map((a) => ({
      id: a.id,
      role: a.id === 'bgm' ? 'bgm' : 'sfx',
      file: `./assets/${a.file}`,
    })),
  };
  await fsp.writeFile(
    path.join(workspace, 'public', 'ASSET_BRIEF.json'),
    JSON.stringify(brief, null, 2),
    'utf8',
  );
  written.push('ASSET_BRIEF.json');

  await writeAssetFingerprint(workspace, style);
  written.push('ASSET_FINGERPRINT.json');

  return {
    files: written,
    patchedGameJson: patched,
    quality,
    failoverEvents,
  };
}
