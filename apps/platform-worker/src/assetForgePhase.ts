/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Write Phaser walk atlas JSON + tilemap helpers into game workspaces.
 * When player.png exists, composite a 4×3 walk sheet (subject-ref MVP).
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

import {
  asciiToTileGids,
  buildWalkAtlasJson,
  defaultTilesetMeta,
  defaultWalkLayout,
  type WalkAtlasLayout,
} from '@opengame/asset-forge';
import {
  artStyleProfile,
  type ArtStyleProfile,
} from '@opengame/world-spec';

import { composeWalkSheet } from './walkSheet.js';

export async function writeAssetForgeArtifacts(
  workspace: string,
  options?: {
    readonly layoutAscii?: string;
    /** Decides frame/tile target sizes and the resampling kernel. */
    readonly styleProfile?: ArtStyleProfile;
  },
): Promise<{ atlasPath: string; tilemapPath: string; sheetPath?: string }> {
  const assetsDir = path.join(workspace, 'public', 'assets');
  await fsp.mkdir(assetsDir, { recursive: true });

  const style = options?.styleProfile ?? artStyleProfile();
  const layout = defaultWalkLayout(style.frameWidth, style.frameHeight);
  const atlas = buildWalkAtlasJson('player_walk.png', layout, 'walk');
  const atlasPath = path.join(assetsDir, 'player_walk.json');
  await fsp.writeFile(atlasPath, JSON.stringify(atlas, null, 2), 'utf8');

  let sheetPath: string | undefined;
  const playerPng = path.join(assetsDir, 'player.png');
  const walkPng = path.join(assetsDir, 'player_walk.png');
  if (fs.existsSync(playerPng) && !fs.existsSync(walkPng)) {
    try {
      sheetPath = await compositeWalkSheet(
        playerPng,
        walkPng,
        layout,
        style.pixelPerfect,
      );
    } catch {
      /* sharp optional — JSON atlas still useful */
    }
  } else if (fs.existsSync(walkPng)) {
    sheetPath = walkPng;
  }

  const meta = defaultTilesetMeta(style.tileSize);
  const ascii =
    options?.layoutAscii ??
    [
      '################################',
      '#..............................#',
      '#..===.........................#',
      '#..===....~~~~.................#',
      '#........~~~~..................#',
      '#..............****............#',
      '#..............................#',
      '################################',
    ].join('\n');
  const tilemap = asciiToTileGids(ascii, meta);
  const tilemapPath = path.join(assetsDir, 'region_tilemap.json');
  await fsp.writeFile(
    tilemapPath,
    JSON.stringify(
      { ...tilemap, tileSize: meta.tileSize, kinds: meta.kinds },
      null,
      2,
    ),
    'utf8',
  );

  // Procedural tileset strip when missing
  const tilesetPath = path.join(assetsDir, 'tileset.png');
  if (!fs.existsSync(tilesetPath)) {
    try {
      await writeProceduralTileset(tilesetPath, meta.tileSize);
    } catch {
      /* optional */
    }
  }

  await stampGameJsonArtStyle(workspace, style);

  return { atlasPath, tilemapPath, sheetPath };
}

/**
 * Record the resolved style on `game.json` meta so the runtime bootstrap can set
 * Phaser `pixelArt` / `roundPixels` correctly. Without this the CLI's generated
 * game.json carries no style and every game rendered with smoothing — including
 * the pixel styles that need nearest-neighbour.
 */
async function stampGameJsonArtStyle(
  workspace: string,
  style: ArtStyleProfile,
): Promise<void> {
  const candidates = [
    path.join(workspace, 'public', 'game.json'),
    path.join(workspace, 'game.json'),
  ];
  for (const gamePath of candidates) {
    if (!fs.existsSync(gamePath)) continue;
    try {
      const raw = await fsp.readFile(gamePath, 'utf8');
      const doc = JSON.parse(raw) as {
        meta?: Record<string, unknown>;
      };
      if (!doc.meta || typeof doc.meta !== 'object') continue;
      if (
        doc.meta['artStyleId'] === style.id &&
        doc.meta['pixelPerfect'] === style.pixelPerfect
      ) {
        continue;
      }
      doc.meta['artStyleId'] = style.id;
      doc.meta['pixelPerfect'] = style.pixelPerfect;
      await fsp.writeFile(gamePath, JSON.stringify(doc, null, 2), 'utf8');
    } catch {
      // A malformed game.json is the quality gate's problem, not ours.
    }
  }
}

/**
 * Fallback sheet built from the single `player.png` the CLI already has. No
 * model call happens here, so the cycle is derived: mirrored contacts on the
 * front/back rows and a lifted passing frame elsewhere.
 */
async function compositeWalkSheet(
  srcPng: string,
  destPng: string,
  layout: WalkAtlasLayout,
  pixelPerfect: boolean,
): Promise<string> {
  const base = await fsp.readFile(srcPng);
  await composeWalkSheet({
    dest: destPng,
    renders: new Map(),
    base,
    layout,
    pixelPerfect,
  });
  return destPng;
}

async function writeProceduralTileset(
  dest: string,
  tileSize: number,
): Promise<void> {
  const sharpMod = await import('sharp').catch(() => null);
  if (!sharpMod) return;
  const sharp = sharpMod.default;
  const kinds = 5;
  const colors = [
    { r: 45, g: 106, b: 79, alpha: 1 },
    { r: 139, g: 115, b: 85, alpha: 1 },
    { r: 27, g: 67, b: 50, alpha: 1 },
    { r: 29, g: 78, b: 137, alpha: 1 },
    { r: 64, g: 145, b: 108, alpha: 1 },
  ];
  const composites = await Promise.all(
    colors.map(async (c, i) => {
      const buf = await sharp({
        create: {
          width: tileSize,
          height: tileSize,
          channels: 4,
          background: c,
        },
      })
        .png()
        .toBuffer();
      return { input: buf, left: i * tileSize, top: 0 };
    }),
  );
  await sharp({
    create: {
      width: tileSize * kinds,
      height: tileSize,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .png()
    .toFile(dest);
}
