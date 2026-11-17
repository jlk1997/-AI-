/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Visual QA gate — structural heuristic (+ optional VLM screenshot) for FIX prompts.
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

import {
  formatVisionQaForFixPrompt,
  scoreVision,
  type VisionLlmCaller,
  type VisionQaResult,
} from '@opengame/vision-qa';

export async function runVisionQaGate(
  workspace: string,
  options?: {
    readonly screenshotBase64?: string;
    readonly screenshotMimeType?: string;
    readonly callVision?: VisionLlmCaller;
  },
): Promise<VisionQaResult> {
  const srcDir = path.join(workspace, 'src');
  let sceneSource = '';
  try {
    const files = await walkTs(srcDir);
    sceneSource = (
      await Promise.all(files.map((f) => fsp.readFile(f, 'utf8')))
    ).join('\n');
  } catch {
    /* empty */
  }

  const hasWalkPng = fs.existsSync(
    path.join(workspace, 'public', 'assets', 'player_walk.png'),
  );
  const hasAtlasJson = fs.existsSync(
    path.join(workspace, 'public', 'assets', 'player_walk.json'),
  );
  // Real art signal: PNG sheet, not JSON metadata alone
  const hasAtlas =
    hasWalkPng ||
    (/load\.atlas|player_walk|ensureWalkAnims/i.test(sceneSource) &&
      hasAtlasJson);
  const hasTilemap =
    /tilemap|Tilemap|asciiToTileGids|region_tilemap|createTilemap/i.test(
      sceneSource,
    ) ||
    fs.existsSync(path.join(workspace, 'public', 'assets', 'tileset.png')) ||
    fs.existsSync(
      path.join(workspace, 'public', 'assets', 'region_tilemap.json'),
    );
  const usesGameUiKit = /GameUiKit|addDialoguePanel|addTitleStrip/.test(
    sceneSource,
  );
  const usesWordWrap = /wordWrap/.test(sceneSource);
  const usesFixedHeightDialogue =
    /fixedHeight/.test(sceneSource) && /dialogue|Dialogue/i.test(sceneSource);
  const hasDebugRects =
    /0x7c3a1d|decoration.*house|Town roofline/i.test(sceneSource) ||
    (/rectangle\([^)]+0\.[4-9]/.test(sceneSource) &&
      /house|decoration/.test(sceneSource));

  let callVision = options?.callVision;
  if (!callVision && options?.screenshotBase64) {
    callVision = await createDefaultVisionCaller();
  }

  return scoreVision({
    sceneSource,
    hasAtlas,
    hasTilemap,
    usesGameUiKit,
    usesWordWrap,
    usesFixedHeightDialogue,
    hasDebugRects,
    screenshotBase64: options?.screenshotBase64,
    screenshotMimeType: options?.screenshotMimeType,
    callVision,
  });
}

export function visionQaFixBlock(result: VisionQaResult): string {
  if (result.ok) return '';
  return `\n\n${formatVisionQaForFixPrompt(result)}\n`;
}

async function createDefaultVisionCaller(): Promise<
  VisionLlmCaller | undefined
> {
  const apiKey =
    process.env['OPENGAME_VISION_API_KEY']?.trim() ||
    process.env['OPENGAME_REASONING_API_KEY']?.trim() ||
    process.env['OPENAI_API_KEY']?.trim();
  if (!apiKey) return undefined;
  const baseUrl = (
    process.env['OPENGAME_VISION_BASE_URL']?.trim() ||
    process.env['OPENGAME_REASONING_BASE_URL']?.trim() ||
    process.env['OPENAI_BASE_URL']?.trim() ||
    'https://api.openai.com/v1'
  ).replace(/\/$/, '');
  const model =
    process.env['OPENGAME_VISION_MODEL']?.trim() ||
    process.env['OPENAI_VISION_MODEL']?.trim() ||
    'gpt-4o-mini';

  return async ({ prompt, imageBase64, mimeType }) => {
    const content: Array<Record<string, unknown>> = [
      { type: 'text', text: prompt },
    ];
    if (imageBase64) {
      content.push({
        type: 'image_url',
        image_url: {
          url: `data:${mimeType ?? 'image/png'};base64,${imageBase64}`,
        },
      });
    }
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [{ role: 'user', content }],
      }),
    });
    if (!res.ok) throw new Error(`vision HTTP ${res.status}`);
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return data.choices?.[0]?.message?.content ?? '';
  };
}

async function walkTs(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walkTs(p)));
    else if (e.isFile() && e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}
