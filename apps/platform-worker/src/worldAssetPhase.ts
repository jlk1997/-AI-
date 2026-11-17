/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * World ASSET phase — MiniMax real sprites + BGM/SFX (no solid placeholders).
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

import {
  resolveArtStyle,
  type ArtStyleProfile,
  type WorldSpec,
} from '@opengame/world-spec';
import {
  asciiToTileGids,
  buildWalkAtlasJson,
  defaultTilesetMeta,
  defaultWalkLayout,
  tilesetPrompt,
  walkCyclePrompts,
  type TileKind,
  type WalkDirection,
} from '@opengame/asset-forge';

import { probeAudioBuffer, probePngBuffer, requireRealAssets } from './assetAuthenticity.js';
import {
  applyMattePolicy,
  SCENE_PROMPT_SUFFIX,
  SPRITE_PROMPT_SUFFIX,
  slotMetaForId,
} from './assetMatte.js';
import { writeAudioWithFallback } from './audioFallback.js';
import { loadAudioQuotaSeed } from './audioQuotaSeed.js';
import {
  hasMinimaxCredentials,
  minimaxGenerateImagePng,
  takeProviderFailoverNotes,
  takeUserVisibleFailoverNotes,
  tryMinimaxGenerateMusicMp3,
  tryMinimaxGenerateSpeechMp3,
} from './minimaxClient.js';
import {
  composeWalkSheet,
  resampleKernel,
  walkRealPoseCount,
} from './walkSheet.js';

export interface WorldAssetPhaseResult {
  readonly files: string[];
  readonly briefPath: string;
  readonly quality: 'minimax' | 'mixed-failover';
  /** Provider failover / soft-skip notes for agent timeline. */
  readonly failoverEvents: string[];
}

type RoleSpec = {
  name: string;
  role: string;
  prompt: string;
  aspect?: string;
};

/** The picked art direction, or the closest match to a legacy style string. */
function styleProfileOf(world: WorldSpec): ArtStyleProfile {
  return resolveArtStyle({
    id: world.styleAnchor?.artStyleId,
    text: world.styleAnchor?.artStyle,
  });
}

function styleHint(world: WorldSpec): string {
  const a = world.styleAnchor;
  const profile = styleProfileOf(world);
  return [
    a?.artStyle || profile.artStyle,
    profile.promptSuffix,
    a?.mood ?? '',
    (a?.palette ?? []).slice(0, 4).join(', '),
  ]
    .filter(Boolean)
    .join(', ');
}

function isLivingTown(world: WorldSpec): boolean {
  if (world.presentation.narrativeSeed === 'society-gathering-observe') {
    return true;
  }
  const npcs = world.entities.filter((e) => e.kind === 'npc').length;
  const enemies = world.entities.filter((e) => e.kind === 'enemy').length;
  return npcs >= 8 && enemies === 0;
}

function roleSpecs(world: WorldSpec): RoleSpec[] {
  const style = styleHint(world);
  const title = world.meta.title;
  const all = [
    {
      name: 'player.png',
      role: 'player',
      aspect: '1:1',
      prompt: `Game character sprite sheet single frame, hero protagonist for "${title}", ${style}, SIDE VIEW facing right, idle pose, clear silhouette,${SPRITE_PROMPT_SUFFIX}`,
    },
    {
      name: 'npc.png',
      role: 'npc',
      aspect: '1:1',
      prompt: `Friendly NPC game sprite for "${title}", ${style}, SIDE VIEW facing right, centered portrait, readable at small size,${SPRITE_PROMPT_SUFFIX}`,
    },
    {
      name: 'enemy.png',
      role: 'enemy',
      aspect: '1:1',
      prompt: `Hostile enemy creature game sprite for "${title}", ${style}, SIDE VIEW facing right, menacing but readable,${SPRITE_PROMPT_SUFFIX}`,
    },
    {
      name: 'item.png',
      role: 'item',
      aspect: '1:1',
      prompt: `Collectible item icon for "${title}", glowing gem or tool, ${style}, centered,${SPRITE_PROMPT_SUFFIX}`,
    },
    {
      name: 'ground.png',
      role: 'tile',
      aspect: '1:1',
      prompt: `Seamless ground tile texture for "${title}" outdoor region, ${style}, top-down game tileset,${SCENE_PROMPT_SUFFIX}`,
    },
    {
      name: 'wall.png',
      role: 'wall',
      aspect: '1:1',
      prompt: `Seamless stone wall tile for "${title}" dungeon or town barrier, ${style}, top-down game tileset block,${SCENE_PROMPT_SUFFIX}`,
    },
  ];
  if (isLivingTown(world)) {
    return all.filter((r) => r.role !== 'enemy' && r.role !== 'item');
  }
  return all;
}

async function writeAudioOrKeepPrior(
  full: string,
  rel: string,
  buf: Buffer | null,
  written: string[],
  failoverEvents: string[],
): Promise<void> {
  await writeAudioWithFallback({
    destPath: full,
    rel,
    fresh: buf,
    written,
    failoverEvents,
  });
}

/** Living-town SFX (and BGM fallback) copy the on-disk seed pack. */
async function writeTownSeedAudio(
  full: string,
  rel: string,
  written: string[],
): Promise<void> {
  if (fs.existsSync(full)) {
    const kept = probeAudioBuffer(await fsp.readFile(full));
    if (kept.ok) {
      written.push(`${rel} (kept)`);
      return;
    }
  }
  const seed = await loadAudioQuotaSeed(path.basename(full));
  if (seed && probeAudioBuffer(seed).ok) {
    await fsp.writeFile(full, seed);
    written.push(`${rel} (town-seed)`);
    return;
  }
  throw new Error(`World ASSET ${rel}: town audio seed pack missing`);
}

function imageGenConcurrency(): number {
  const n = Number(process.env['PLATFORM_ASSET_IMAGE_CONCURRENCY'] ?? 4);
  return Math.max(1, Math.min(8, Number.isFinite(n) ? n : 4));
}

async function mapPool<T>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  if (!items.length) return;
  let next = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), items.length) },
    async () => {
      for (;;) {
        const i = next;
        next += 1;
        if (i >= items.length) return;
        await fn(items[i]!, i);
      }
    },
  );
  await Promise.all(workers);
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

function bufferAfterMatte(
  original: Buffer,
  matted: { buffer: Buffer; note?: string },
  failoverEvents: string[],
  name: string,
): Buffer {
  if (matted.note) failoverEvents.push(matted.note);
  const matteProbe = probePngBuffer(matted.buffer);
  if (matteProbe.ok) return matted.buffer;
  const origProbe = probePngBuffer(original);
  if (origProbe.ok) {
    failoverEvents.push(
      `matte ${name}: ${matteProbe.reason ?? 'unusable'} — kept original`,
    );
    return original;
  }
  throw new Error(
    `World ASSET ${name}: ${matteProbe.reason ?? origProbe.reason}`,
  );
}

function npcSlug(id: string): string {
  return id
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 28);
}

async function compositeTilesetStrip(
  dest: string,
  tiles: ReadonlyArray<{ kind: TileKind; buffer: Buffer }>,
  tileSize: number,
  pixelPerfect: boolean,
): Promise<void> {
  const sharpMod = await import('sharp').catch(() => null);
  if (!sharpMod) return;
  const sharp = sharpMod.default;
  const composites = await Promise.all(
    tiles.map(async (t, i) => {
      const resized = await sharp(t.buffer)
        .resize(tileSize, tileSize, {
          fit: 'cover',
          kernel: resampleKernel(pixelPerfect),
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .png()
        .toBuffer();
      return { input: resized, left: i * tileSize, top: 0 };
    }),
  );
  await sharp({
    create: {
      width: tileSize * tiles.length,
      height: tileSize,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .png()
    .toFile(dest);
}

const TILE_KINDS: readonly TileKind[] = [
  'ground',
  'path',
  'wall',
  'water',
  'decor',
];

async function generateTownTileset(input: {
  readonly assetsDir: string;
  readonly style: string;
  readonly styleProfile: ArtStyleProfile;
  readonly written: string[];
  readonly failoverEvents: string[];
  readonly drainFailover: () => void;
  readonly allowFallback?: boolean;
}): Promise<void> {
  if (process.env['PLATFORM_SKIP_WALK_ATLAS'] === 'true') return;
  const destExisting = path.join(input.assetsDir, 'tileset.png');
  if (
    fs.existsSync(destExisting) &&
    TILE_KINDS.every((k) =>
      fs.existsSync(path.join(input.assetsDir, `${k}.png`)),
    )
  ) {
    input.written.push('assets/tileset.png (kept)');
    return;
  }
  const tileSize = input.styleProfile.tileSize;
  const tiles: Array<{ kind: TileKind; buffer: Buffer } | undefined> =
    new Array(TILE_KINDS.length);
  await mapPool([...TILE_KINDS], imageGenConcurrency(), async (kind, index) => {
    const fileName = `${kind}.png`;
    const existing = path.join(input.assetsDir, fileName);
    let buf: Buffer;
    if (fs.existsSync(existing)) {
      buf = await fsp.readFile(existing);
    } else {
      const png = await minimaxGenerateImagePng({
        allowFallback: input.allowFallback === true,
        prompt: `${tilesetPrompt(input.style, kind, tileSize)},${SCENE_PROMPT_SUFFIX}`,
        aspectRatio: '1:1',
      });
      input.drainFailover();
      const probe = probePngBuffer(png);
      if (!probe.ok) throw new Error(`World ASSET ${fileName}: ${probe.reason}`);
      const matted = await applyMattePolicy(png, fileName);
      buf = bufferAfterMatte(png, matted, input.failoverEvents, fileName);
      await fsp.writeFile(existing, buf);
      input.written.push(`assets/${fileName}`);
    }
    tiles[index] = { kind, buffer: buf };
  });
  const ordered = tiles.filter(
    (t): t is { kind: TileKind; buffer: Buffer } => Boolean(t),
  );
  const dest = path.join(input.assetsDir, 'tileset.png');
  try {
    await compositeTilesetStrip(
      dest,
      ordered,
      tileSize,
      input.styleProfile.pixelPerfect,
    );
    input.written.push('assets/tileset.png');
  } catch (err) {
    console.warn('[world-asset] tileset strip failed', err);
  }
}

async function generateNpcWalkAtlases(input: {
  readonly assetsDir: string;
  readonly world: WorldSpec;
  readonly style: string;
  readonly styleProfile: ArtStyleProfile;
  readonly written: string[];
  readonly failoverEvents: string[];
  readonly drainFailover: () => void;
  readonly onProgress?: (summary: string) => void;
  readonly allowFallback?: boolean;
}): Promise<Array<{ id: string; file: string; atlas: string }>> {
  if (process.env['PLATFORM_SKIP_WALK_ATLAS'] === 'true') return [];
  const npcs = input.world.entities
    .filter((e) => e.kind === 'npc');
  const portraitCapRaw = Number(process.env['OPENGAME_UNIQUE_PORTRAIT_MAX'] ?? 36);
  const portraitCap =
    Number.isFinite(portraitCapRaw) && portraitCapRaw > 0
      ? Math.floor(portraitCapRaw)
      : 36;
  const generatedNpcs = npcs.slice(0, portraitCap);
  const layout = defaultWalkLayout(
    input.styleProfile.frameWidth,
    input.styleProfile.frameHeight,
  );
  const dirs = ['down', 'left', 'right', 'up'] as const;
  const out: Array<{ id: string; file: string; atlas: string } | undefined> =
    new Array(npcs.length);
  await mapPool(generatedNpcs, imageGenConcurrency(), async (npc, index) => {
    const slug = npcSlug(npc.id);
    const portraitName = `${slug}.png`;
    const portraitPath = path.join(input.assetsDir, portraitName);
    const walkPng = path.join(input.assetsDir, `${slug}_walk.png`);
    const walkJson = path.join(input.assetsDir, `${slug}_walk.json`);
    const occupation = npc.identity?.occupation ?? npc.attrs?.['role'] ?? 'townsfolk';
    const traits = (npc.identity?.traits ?? []).slice(0, 3).join(', ');
    if (
      fs.existsSync(portraitPath) &&
      fs.existsSync(walkPng) &&
      fs.existsSync(walkJson)
    ) {
      console.log(
        `[world-asset] portrait ${index + 1}/${npcs.length} ${npc.name} (kept)`,
      );
      input.onProgress?.(
        `小镇立绘 ${index + 1}/${npcs.length} · ${npc.name}（已有，跳过出图）`,
      );
      input.written.push(`assets/${portraitName} (kept)`);
      input.written.push(`assets/${path.basename(walkPng)} (kept)`);
      out[index] = {
        id: npc.id,
        file: `./assets/${path.basename(walkPng)}`,
        atlas: `./assets/${path.basename(walkJson)}`,
      };
      return;
    }
    console.log(
      `[world-asset] portrait ${index + 1}/${npcs.length} ${npc.name}`,
    );
    input.onProgress?.(
      `小镇立绘 ${index + 1}/${npcs.length} · ${npc.name}`,
    );
    let portraitBuf: Buffer;
    if (fs.existsSync(portraitPath)) {
      portraitBuf = await fsp.readFile(portraitPath);
      input.written.push(`assets/${portraitName} (kept)`);
    } else {
      const portraitPrompt = `Game character sprite, ${npc.name} the ${occupation}, ${traits}, ${input.style}, SIDE VIEW facing right, idle pose, full body visible, face unobstructed, no badge, no watermark, no logo, no corner mark, clear silhouette,${SPRITE_PROMPT_SUFFIX}`;
      const png = await minimaxGenerateImagePng({
        allowFallback: input.allowFallback === true,
        prompt: portraitPrompt,
        aspectRatio: '1:1',
      });
      input.drainFailover();
      const probe = probePngBuffer(png);
      if (!probe.ok) {
        throw new Error(`World ASSET ${portraitName}: ${probe.reason}`);
      }
      const matted = await applyMattePolicy(png, portraitName);
      portraitBuf = bufferAfterMatte(
        png,
        matted,
        input.failoverEvents,
        portraitName,
      );
      await fsp.writeFile(portraitPath, portraitBuf);
      input.written.push(`assets/${portraitName}`);
    }

    const renders = new Map<WalkDirection, Buffer[]>();
    const skipWalkFrames =
      isLivingTown(input.world) ||
      process.env['PLATFORM_SKIP_WALK_FRAMES'] === 'true';
    if (!skipWalkFrames) {
      const ref = await localPngAsDataUrl(portraitPath);
      const prompts = walkCyclePrompts(
        input.style,
        `${npc.name} the ${occupation}, ${traits}`,
        {
          pixelPerfect: input.styleProfile.pixelPerfect,
          framesPerDir: layout.framesPerDir,
        },
      );
      const poses = walkRealPoseCount(layout.framesPerDir, 'npc');
      for (const dir of dirs) {
        const perDir: Buffer[] = [];
        for (let p = 0; p < poses; p++) {
          try {
            const frame = await minimaxGenerateImagePng({
              allowFallback: input.allowFallback === true,
              prompt: prompts[dir][p] ?? prompts[dir][0]!,
              aspectRatio: '1:1',
              subjectReferenceImageFile: ref,
            });
            input.drainFailover();
            const name = `${slug}_${dir}_${p}.png`;
            const framed = await applyMattePolicy(frame, name);
            perDir.push(
              bufferAfterMatte(frame, framed, input.failoverEvents, name),
            );
          } catch (err) {
            console.warn(`[world-asset] walk frame ${slug} ${dir} failed`, err);
            break;
          }
        }
        if (perDir.length) renders.set(dir, perDir);
      }
    }
    if (fs.existsSync(walkPng) && fs.existsSync(walkJson)) {
      input.written.push(`assets/${path.basename(walkPng)} (kept)`);
      out[index] = {
        id: npc.id,
        file: `./assets/${path.basename(walkPng)}`,
        atlas: `./assets/${path.basename(walkJson)}`,
      };
      return;
    }
    try {
      await composeWalkSheet({
        dest: walkPng,
        renders,
        base: portraitBuf,
        layout,
        pixelPerfect: input.styleProfile.pixelPerfect,
        allowFlop: skipWalkFrames ? false : undefined,
      });
      const atlas = buildWalkAtlasJson(path.basename(walkPng), layout, 'walk');
      await fsp.writeFile(walkJson, JSON.stringify(atlas, null, 2), 'utf8');
      input.written.push(`assets/${path.basename(walkPng)}`);
      input.written.push(`assets/${path.basename(walkJson)}`);
      out[index] = {
        id: npc.id,
        file: `./assets/${path.basename(walkPng)}`,
        atlas: `./assets/${path.basename(walkJson)}`,
      };
    } catch (err) {
      console.warn(`[world-asset] walk sheet ${slug} failed`, err);
    }
  });
  for (let index = generatedNpcs.length; index < npcs.length; index += 1) {
    const npc = npcs[index];
    const donor = generatedNpcs[index % Math.max(1, generatedNpcs.length)];
    if (!npc || !donor) continue;
    const slug = npcSlug(npc.id);
    const donorSlug = npcSlug(donor.id);
    const pairs: Array<[string, string]> = [
      [`${donorSlug}.png`, `${slug}.png`],
      [`${donorSlug}_walk.png`, `${slug}_walk.png`],
      [`${donorSlug}_walk.json`, `${slug}_walk.json`],
    ];
    let copiedWalk = false;
    for (const [fromName, toName] of pairs) {
      const from = path.join(input.assetsDir, fromName);
      const to = path.join(input.assetsDir, toName);
      if (!fs.existsSync(from) || fs.existsSync(to)) continue;
      await fsp.copyFile(from, to);
      input.written.push(`assets/${toName} (reused)`);
      if (toName.endsWith('_walk.png')) copiedWalk = true;
    }
    if (copiedWalk || fs.existsSync(path.join(input.assetsDir, `${slug}_walk.png`))) {
      out[index] = {
        id: npc.id,
        file: `./assets/${slug}_walk.png`,
        atlas: `./assets/${slug}_walk.json`,
      };
    }
  }
  return out.filter(
    (x): x is { id: string; file: string; atlas: string } => Boolean(x),
  );
}

function writeRegionTilemaps(
  assetsDir: string,
  world: WorldSpec,
  written: string[],
): void {
  const meta = defaultTilesetMeta(world.presentation.tileSize ?? 32);
  for (const region of world.space.regions) {
    if (!region.layoutAscii) continue;
    const tilemap = asciiToTileGids(region.layoutAscii, meta);
    const file = `region_${npcSlug(region.id)}_tilemap.json`;
    fs.writeFileSync(
      path.join(assetsDir, file),
      JSON.stringify(
        {
          regionId: region.id,
          ...tilemap,
          tileSize: meta.tileSize,
          kinds: meta.kinds,
        },
        null,
        2,
      ),
      'utf8',
    );
    written.push(`assets/${file}`);
  }
}

/**
 * Materialize MiniMax sprites + audio under public/assets.
 * Throws when real assets are required and MiniMax fails (no procedural fallback).
 */
export async function runWorldAssetPhase(
  workspace: string,
  world: WorldSpec,
  options?: {
    readonly onProgress?: (summary: string) => void;
    readonly allowImageFallback?: boolean;
  },
): Promise<WorldAssetPhaseResult> {
  const assetsDir = path.join(workspace, 'public', 'assets');
  await fsp.mkdir(assetsDir, { recursive: true });

  if (!hasMinimaxCredentials()) {
    throw new Error(
      'World ASSET: MiniMax API key missing (OPENGAME_IMAGE_API_KEY / MINIMAX_API_KEY). Real assets required — no placeholders.',
    );
  }
  if (
    !requireRealAssets() &&
    process.env['WORLD_ALLOW_PLACEHOLDER_ASSETS'] === 'true'
  ) {
    throw new Error(
      'WORLD_ALLOW_PLACEHOLDER_ASSETS is set but placeholders are removed from product path — unset it and use MiniMax.',
    );
  }

  const style = styleHint(world);
  const styleProfile = styleProfileOf(world);
  const written: string[] = [];
  const failoverEvents: string[] = [];
  const drainFailover = () => {
    takeProviderFailoverNotes();
    for (const n of takeUserVisibleFailoverNotes()) failoverEvents.push(n);
  };
  const roles = roleSpecs(world);
  const livingTown = isLivingTown(world);
  options?.onProgress?.(
    livingTown
      ? '小镇出图：地砖 + 居民立绘（不做四向走路片，避免卡一小时）'
      : 'World MiniMax ASSET：角色/地砖/BGM/SFX',
  );

  await mapPool(roles, imageGenConcurrency(), async (role) => {
    const dest = path.join(assetsDir, role.name);
    if (fs.existsSync(dest)) {
      written.push(`assets/${role.name} (kept)`);
      return;
    }
    const png = await minimaxGenerateImagePng({
      allowFallback: options?.allowImageFallback === true,
      prompt: role.prompt,
      aspectRatio: role.aspect ?? '1:1',
    });
    drainFailover();
    const probe = probePngBuffer(png);
    if (!probe.ok) {
      throw new Error(`World ASSET ${role.name}: ${probe.reason}`);
    }
    const matted = await applyMattePolicy(png, role.name);
    const buf = bufferAfterMatte(png, matted, failoverEvents, role.name);
    await fsp.writeFile(path.join(assetsDir, role.name), buf);
    written.push(
      matted.matted && buf === matted.buffer
        ? `assets/${role.name} (matte)`
        : `assets/${role.name}`,
    );
  });

  if (livingTown) {
    const npcFull = path.join(assetsDir, 'npc.png');
    if (fs.existsSync(npcFull)) {
      for (const alias of ['enemy.png', 'item.png'] as const) {
        const dest = path.join(assetsDir, alias);
        if (!fs.existsSync(dest)) {
          await fsp.copyFile(npcFull, dest);
          written.push(`assets/${alias} (town alias)`);
        }
      }
    }
  }

  await generateTownTileset({
    assetsDir,
    style,
    styleProfile,
    written,
    failoverEvents,
    drainFailover,
    allowFallback: options?.allowImageFallback === true,
  });
  const npcWalks = await generateNpcWalkAtlases({
    assetsDir,
    world,
    style,
    styleProfile,
    written,
    failoverEvents,
    drainFailover,
    onProgress: options?.onProgress,
    allowFallback: options?.allowImageFallback === true,
  });
  writeRegionTilemaps(assetsDir, world, written);

  if (livingTown) {
    const bgm = await tryMinimaxGenerateMusicMp3({
      allowFallback: options?.allowImageFallback === true,
      prompt: `Instrumental ambient background music for living town "${world.meta.title}", mood ${world.styleAnchor?.mood || 'calm daily life'}, loopable, ${style}`,
    });
    drainFailover();
    await writeAudioOrKeepPrior(
      path.join(assetsDir, 'bgm.mp3'),
      'assets/bgm.mp3',
      bgm,
      written,
      failoverEvents,
    );
    for (const name of ['sfx_win.mp3', 'sfx_lose.mp3'] as const) {
      await writeTownSeedAudio(
        path.join(assetsDir, name),
        `assets/${name}`,
        written,
      );
    }
  } else {
    const bgm = await tryMinimaxGenerateMusicMp3({
      allowFallback: options?.allowImageFallback === true,
      prompt: `Instrumental game background music for fantasy town "${world.meta.title}", mood ${world.styleAnchor?.mood || 'adventurous'}, loopable, ${style}`,
    });
    drainFailover();
    await writeAudioOrKeepPrior(
      path.join(assetsDir, 'bgm.mp3'),
      'assets/bgm.mp3',
      bgm,
      written,
      failoverEvents,
    );

    const sfxWin = await tryMinimaxGenerateSpeechMp3({
      allowFallback: options?.allowImageFallback === true,
      text: 'Victory! Quest complete.',
    });
    drainFailover();
    await writeAudioOrKeepPrior(
      path.join(assetsDir, 'sfx_win.mp3'),
      'assets/sfx_win.mp3',
      sfxWin,
      written,
      failoverEvents,
    );

    const sfxLose = await tryMinimaxGenerateSpeechMp3({
      allowFallback: options?.allowImageFallback === true,
      text: 'Defeat. Try again.',
    });
    drainFailover();
    await writeAudioOrKeepPrior(
      path.join(assetsDir, 'sfx_lose.mp3'),
      'assets/sfx_lose.mp3',
      sfxLose,
      written,
      failoverEvents,
    );
  }

  const quality =
    failoverEvents.length > 0 ? ('mixed-failover' as const) : ('minimax' as const);

  const brief = {
    schema: 'opengame-world-asset-brief-v1',
    assetQuality: quality,
    placeholderQuality: quality, // legacy field — must NOT be procedural-v2
    artStyle: world.styleAnchor?.artStyle || styleProfile.artStyle,
    artStyleId: styleProfile.id,
    mood: world.styleAnchor?.mood ?? '',
    palette: world.styleAnchor?.palette ?? [],
    narrativeSeed: world.presentation.narrativeSeed ?? world.meta.id,
    provider: quality === 'mixed-failover' ? 'minimax+ark' : 'minimax',
    mattePolicy: 'scene-opaque-sprite-auto',
    failoverEvents,
    assets: [
      ...roles.map((r) => {
        const meta = slotMetaForId(r.role);
        return {
          file: `./assets/${r.name}`,
          role: r.role,
          source: 'minimax-image',
          matte: meta.matte,
          assetRole: meta.role,
          ...(meta.pose ? { pose: meta.pose } : {}),
        };
      }),
      ...(fs.existsSync(path.join(assetsDir, 'tileset.png'))
        ? [
            {
              file: './assets/tileset.png',
              role: 'tileset',
              source: 'minimax-image',
            },
          ]
        : []),
    ],
    // Legacy presenter field — same MiniMax files (not procedural placeholders)
    placeholders: roles.map((r) => ({
      file: `./assets/${r.name}`,
      role: r.role,
      source: 'minimax-image',
    })),
    audio: [
      { file: './assets/bgm.mp3', id: 'bgm', role: 'bgm' },
      { file: './assets/sfx_win.mp3', id: 'sfx_win', role: 'sfx' },
      { file: './assets/sfx_lose.mp3', id: 'sfx_lose', role: 'sfx' },
    ],
    entities: world.entities
      .filter((e) => e.kind !== 'prop')
      .map((e) => {
        const walk = npcWalks.find((w) => w.id === e.id);
        const ownPortrait = `./assets/${npcSlug(e.id)}.png`;
        const fallback =
          e.kind === 'enemy' ? './assets/enemy.png' : './assets/item.png';
        return {
          id: e.id,
          kind: e.kind,
          name: e.name,
          // Still portrait, never the shared npc.png or a walk sheet.
          suggestedAsset:
            e.kind === 'npc' || e.kind === 'player'
              ? ownPortrait
              : (walk?.file ?? fallback),
          ...(walk
            ? { walkSheet: walk.file, walkAtlas: walk.atlas }
            : {}),
        };
      }),
    npcWalks,
  };
  const briefPath = path.join(workspace, 'public', 'ASSET_BRIEF.json');
  await fsp.writeFile(briefPath, JSON.stringify(brief, null, 2), 'utf8');
  written.push('ASSET_BRIEF.json');

  return { files: written, briefPath, quality, failoverEvents };
}

/**
 * L3 region poster via MiniMax (no solid-color fallback).
 * Returns relative `./spatial/{regionId}.png`.
 */
export async function writeSpatialPosterPng(
  workspace: string,
  regionId: string,
  _rgb?: [number, number, number],
  opts?: { readonly prompt?: string; readonly styleHint?: string },
): Promise<string> {
  if (!hasMinimaxCredentials()) {
    throw new Error(
      `L3 poster ${regionId}: MiniMax required — solid placeholder posters disabled`,
    );
  }
  const spatialDir = path.join(workspace, 'public', 'spatial');
  await fsp.mkdir(spatialDir, { recursive: true });
  const prompt =
    opts?.prompt ||
    `Cinematic establishing shot of game region ${regionId}, ${opts?.styleHint || 'fantasy game art'}, vertical poster, high detail, no text UI`;
  const png = await minimaxGenerateImagePng({
    allowFallback: false,
    prompt,
    aspectRatio: '9:16',
  });
  takeProviderFailoverNotes(); // drain so game/world phases do not inherit poster notes
  const probe = probePngBuffer(png);
  if (!probe.ok) throw new Error(`L3 poster ${regionId}: ${probe.reason}`);
  const file = path.join(spatialDir, `${regionId}.png`);
  await fsp.writeFile(file, png);
  return `./spatial/${regionId}.png`;
}
