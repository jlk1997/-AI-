/**
 * Shared font stacks and text-rasterisation defaults for the world presenter.
 *
 * Phaser's default text font is `"Courier New", Courier, monospace`, which has
 * no CJK glyphs — every Chinese name, label and speech bubble rendered as tofu
 * boxes. Scenes must take their font from here rather than relying on the
 * default or a Latin-only stack like `Georgia, serif`.
 */

import Phaser from 'phaser';

/** UI / body text. Order puts the platform CJK face ahead of Latin fallbacks. */
export const UI_FONT =
  '"Noto Sans SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Source Han Sans SC", "WenQuanYi Micro Hei", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/** Titles and endings — a serif face that still resolves CJK. */
export const DISPLAY_FONT =
  '"Noto Serif SC", "Songti SC", "SimSun", "Source Han Serif SC", Georgia, serif';

/**
 * Minimum legible size at 1x. Several labels were 10-11px, which is unreadable
 * for CJK glyphs (they need roughly twice the height of Latin to stay legible).
 */
export const MIN_CJK_PX = 13;

/** Clamp a pixel size up to {@link MIN_CJK_PX} and format it for Phaser. */
export function fontPx(px: number): string {
  return `${Math.max(MIN_CJK_PX, Math.round(px))}px`;
}

/**
 * Device pixels per game pixel, for a Text object's internal canvas.
 *
 * `TextStyle.resolution` falls back to the Game Config resolution, which Phaser
 * 3.60 removed — so the effective default is 1. Every label was rasterised at 1x
 * and then upscaled by `Scale.FIT` (a 1280x720 backbuffer on a 2560px display is
 * doubled), which is what made speech bubbles and names look soft.
 *
 * Pixel styles stay at 1x on purpose: resampling a 3x glyph texture down with
 * NEAREST filtering is noisy, and chunky text is part of that aesthetic.
 */
export function textResolution(game?: Phaser.Game): number {
  if ((game?.config as { pixelArt?: boolean } | undefined)?.pixelArt) return 1;
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  const displayScale = game?.scale?.displayScale?.x;
  // displayScale converts display px -> game px, so its inverse is the upscale.
  const upscale =
    typeof displayScale === 'number' && displayScale > 0 ? 1 / displayScale : 1;
  // Capped at 3 to bound the memory each label's canvas texture costs.
  return Math.min(3, Math.max(1, Math.round(dpr * upscale * 100) / 100));
}

function withTextDefaults(
  style: Phaser.Types.GameObjects.Text.TextStyle | undefined,
  game?: Phaser.Game,
): Phaser.Types.GameObjects.Text.TextStyle {
  const next = { ...(style ?? {}) };
  if (!next.resolution) next.resolution = textResolution(game);
  // `font` is the shorthand carrying family and size together; if the caller set
  // it, respect it wholesale rather than fighting over precedence.
  if (next.font) return next;
  if (!next.fontFamily) next.fontFamily = UI_FONT;
  if (typeof next.fontSize === 'number') {
    next.fontSize = fontPx(next.fontSize);
  } else if (typeof next.fontSize === 'string') {
    const px = /^(\d+(?:\.\d+)?)px$/.exec(next.fontSize.trim());
    if (px) next.fontSize = fontPx(Number(px[1]));
  }
  return next;
}

let factoryPatched = false;

/**
 * Patch the shared Text factory so every label gets the CJK stack, the legible
 * floor and a high-DPI resolution. Phaser registers factory methods on the
 * prototype, so one patch covers all scenes; call it before `new Phaser.Game`.
 */
export function installTextDefaults(): void {
  if (factoryPatched) return;
  factoryPatched = true;
  type TextFactory = {
    text: (
      x: number,
      y: number,
      text: string | string[],
      style?: Phaser.Types.GameObjects.Text.TextStyle,
    ) => Phaser.GameObjects.Text;
    systems?: Phaser.Scenes.Systems;
  };
  type TextCreator = {
    text: (
      config: Phaser.Types.GameObjects.Text.TextConfig,
      addToScene?: boolean,
    ) => Phaser.GameObjects.Text;
    systems?: Phaser.Scenes.Systems;
  };
  try {
    const factoryProto = Phaser.GameObjects.GameObjectFactory
      .prototype as unknown as TextFactory;
    const addText = factoryProto.text;
    factoryProto.text = function patchedText(this: TextFactory, x, y, text, style) {
      return addText.call(this, x, y, text, withTextDefaults(style, this.systems?.game));
    };

    const creatorProto = Phaser.GameObjects.GameObjectCreator
      .prototype as unknown as TextCreator;
    const makeText = creatorProto.text;
    creatorProto.text = function patchedMakeText(
      this: TextCreator,
      config,
      addToScene,
    ) {
      return makeText.call(
        this,
        { ...config, style: withTextDefaults(config?.style, this.systems?.game) },
        addToScene,
      );
    };
  } catch {
    /* cosmetic — never block a boot over text defaults */
  }
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
 * stalled font request must not hold the presenter hostage.
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
