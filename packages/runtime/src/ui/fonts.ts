/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared font stacks for runtime UI.
 *
 * Phaser's default text font is `"Courier New", Courier, monospace` and the
 * built-in UI used `Georgia, serif` / bare `sans-serif`. None of those name a
 * CJK face, so Chinese dialogue fell through to whatever generic the browser
 * picked — inconsistent weights and poor hinting at small sizes.
 *
 * Kept free of imports: HUD, Dialog and the DSL loader all pull from here, and
 * their unit tests run in a plain node environment where importing Phaser throws
 * on `window`. Anything that needs the Phaser value lives in `textDefaults.ts`.
 */

/** UI / body text, CJK face first. */
export const UI_FONT =
  '"Noto Sans SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Source Han Sans SC", "WenQuanYi Micro Hei", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/** Titles and endings — serif that still resolves CJK. */
export const DISPLAY_FONT =
  '"Noto Serif SC", "Songti SC", "SimSun", "Source Han Serif SC", Georgia, serif';

/**
 * Minimum legible size at 1x. CJK glyphs need roughly twice the height of Latin
 * to stay readable, so anything under this is unreadable rather than just small.
 */
export const MIN_CJK_PX = 15;

/** Clamp a pixel size up to {@link MIN_CJK_PX} and format it for Phaser. */
export function fontPx(px: number): string {
  return `${Math.max(MIN_CJK_PX, Math.round(px))}px`;
}

/**
 * Whether any family in a stack can actually draw Chinese glyphs.
 *
 * Measures a CJK string against a deliberately missing family: if the widths
 * match, every candidate fell through to the same fallback and the glyphs are
 * rendering as tofu boxes. Naming a font in a stack does not load it, so this is
 * the only way to know the host has one.
 */
export function cjkFontAvailable(stack: string = UI_FONT): boolean {
  if (typeof document === 'undefined') return true;
  try {
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) return true;
    const probe = '测试文字';
    const measure = (family: string): number => {
      ctx.font = `48px ${family}`;
      return ctx.measureText(probe).width;
    };
    const missing = measure('"__opengame_missing_face__", monospace');
    return measure(`${stack}, monospace`) !== missing;
  } catch {
    return true;
  }
}

/**
 * Wait for webfonts to settle before the first text is rasterised.
 *
 * Phaser measures and rasterises text once at creation, so a face that arrives
 * later leaves the label sized for the fallback. Races a timeout because a
 * stalled font request must not hold the game hostage.
 */
export async function ensureFontsReady(timeoutMs = 1500): Promise<void> {
  if (typeof document === 'undefined') return;
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
  if (!fonts?.ready) return;
  await Promise.race([
    fonts.ready.catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
  if (!cjkFontAvailable()) {
    // Surfaced so the headless smoke and vision QA can flag a host with no CJK
    // face instead of silently shipping a screenshot full of boxes.
    console.warn('[opengame] no CJK-capable font found — text may render as boxes');
  }
}
