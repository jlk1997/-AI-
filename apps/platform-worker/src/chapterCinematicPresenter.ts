/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Optional chapter highlight Presenter (LingBot-inspired).
 * Presentation only — never becomes gameplay / narrative SSOT.
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

import type { StoryBible } from './storyOutline.js';

function cinematicEnabled(): boolean {
  const v = process.env['PLATFORM_ENABLE_CHAPTER_CINEMATIC']?.trim().toLowerCase();
  // Default on for narrative archetypes when unset — cheap TS stub, no API cost.
  if (v === 'false' || v === '0' || v === 'off') return false;
  return true;
}

/**
 * Writes a zero-logic Presenter stub Scenes can optionally call for chapter
 * openers. Real LingBot/spatial runs stay on the world pipeline.
 */
export async function maybeWriteChapterCinematicPresenter(options: {
  readonly workspace: string;
  readonly bible: StoryBible;
  readonly archetype: string;
}): Promise<{ written: boolean; path: string | null }> {
  if (!cinematicEnabled()) return { written: false, path: null };
  if (options.archetype !== 'ui_heavy' && options.archetype !== 'top_down') {
    return { written: false, path: null };
  }

  const dir = path.join(options.workspace, 'src', 'presentation');
  await fsp.mkdir(dir, { recursive: true });
  const outPath = path.join(dir, 'ChapterCinematicPresenter.ts');
  if (fs.existsSync(outPath)) {
    return { written: false, path: outPath };
  }

  const chapterTitles = options.bible.chapters.map((c) => c.title);
  const body = `/**
 * GENERATED — chapter highlight Presenter (optional).
 * Inspired by LingBot-style cinematic openers. NOT the narrative SSOT —
 * truth lives in public/STORY_BIBLE.json + public/CONTENT_GRAPH.json.
 */
import Phaser from 'phaser';

const CHAPTER_TITLES = ${JSON.stringify(chapterTitles, null, 2)} as const;

export class ChapterCinematicPresenter {
  static async playOpener(
    scene: Phaser.Scene,
    chapterIndex = 0,
  ): Promise<void> {
    const title =
      CHAPTER_TITLES[Math.max(0, Math.min(chapterIndex, CHAPTER_TITLES.length - 1))] ??
      'Chapter';
    const w = scene.scale.width;
    const h = scene.scale.height;
    const veil = scene.add
      .rectangle(w / 2, h / 2, w, h, 0x020617, 0.72)
      .setScrollFactor(0)
      .setDepth(900);
    const label = scene.add
      .text(w / 2, h / 2, title, {
        fontSize: '28px',
        color: '#e2e8f0',
        fontStyle: 'bold',
        align: 'center',
        wordWrap: { width: w - 80, useAdvancedWrap: true },
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(901)
      .setAlpha(0);

    await new Promise<void>((resolve) => {
      scene.tweens.add({
        targets: label,
        alpha: 1,
        duration: 450,
        yoyo: true,
        hold: 700,
        onComplete: () => {
          veil.destroy();
          label.destroy();
          resolve();
        },
      });
    });
  }
}
`;
  await fsp.writeFile(outPath, body, 'utf8');
  return { written: true, path: outPath };
}
