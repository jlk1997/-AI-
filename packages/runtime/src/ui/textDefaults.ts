/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Scene-wide defaults for Phaser Text objects.
 *
 * Separate from `fonts.ts` because this module has to import the Phaser *value*
 * to patch its factory, and Phaser touches `window` on import — which breaks the
 * plain-node unit tests that legitimately want only the font constants.
 */

import Phaser from 'phaser';

import { UI_FONT, fontPx } from './fonts.js';

/**
 * How many device pixels one game pixel occupies.
 *
 * `Scale.FIT` stretches a 1280x720 backbuffer to the container, so on a 2560px
 * wide display every game pixel covers two device pixels — before the device
 * pixel ratio is even applied.
 */
function renderScaleOf(game: Phaser.Game | undefined): number {
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  const displayScale = game?.scale?.displayScale?.x;
  // displayScale converts display px -> game px, so its inverse is the upscale.
  const upscale =
    typeof displayScale === 'number' && displayScale > 0 ? 1 / displayScale : 1;
  return dpr * upscale;
}

/**
 * Resolution for a Text object's internal canvas.
 *
 * `TextStyle.resolution` defaults to 0, meaning "use the Game Config
 * resolution" — but Phaser 3.60 removed that config knob, so the effective
 * default is 1. Every label was therefore rasterised at 1x and then upscaled by
 * the Scale manager, which is what made generated text look soft next to the
 * sprites.
 *
 * Pixel-art styles are left at 1x on purpose: a 3x glyph texture resampled down
 * with NEAREST filtering is noisy, and chunky text is part of that aesthetic.
 */
export function textResolution(game?: Phaser.Game): number {
  if ((game?.config as { pixelArt?: boolean } | undefined)?.pixelArt) return 1;
  // Capped at 3 to bound the memory each label's canvas texture costs.
  return Math.min(3, Math.max(1, Math.round(renderScaleOf(game) * 100) / 100));
}

/**
 * Fill in family, minimum size and rasterisation resolution on a text style.
 * Anything the caller set explicitly wins.
 */
export function withTextDefaults(
  style: Phaser.Types.GameObjects.Text.TextStyle | undefined,
  game?: Phaser.Game,
): Phaser.Types.GameObjects.Text.TextStyle {
  const next = { ...(style ?? {}) };
  if (!next.resolution) next.resolution = textResolution(game);
  // `font` is the shorthand carrying family and size together; if the caller
  // set it, respect it wholesale rather than fighting over precedence.
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

interface TextFactoryProto {
  text: (
    x: number,
    y: number,
    text: string | string[],
    style?: Phaser.Types.GameObjects.Text.TextStyle,
  ) => Phaser.GameObjects.Text;
  systems?: Phaser.Scenes.Systems;
}

interface TextCreatorProto {
  text: (
    config: Phaser.Types.GameObjects.Text.TextConfig,
    addToScene?: boolean,
  ) => Phaser.GameObjects.Text;
  systems?: Phaser.Scenes.Systems;
}

/**
 * Patch the shared Text factory so every label in every scene gets a CJK family
 * and a high-DPI resolution, including labels created by game code we did not
 * write. Phaser registers factory methods on the prototype, so one patch covers
 * all scenes; call it before the first `new Phaser.Game`.
 */
export function installTextDefaults(): void {
  if (factoryPatched) return;
  factoryPatched = true;
  try {
    const factoryProto = Phaser.GameObjects.GameObjectFactory
      .prototype as unknown as TextFactoryProto;
    const addText = factoryProto.text;
    factoryProto.text = function patchedText(this: TextFactoryProto, x, y, text, style) {
      return addText.call(this, x, y, text, withTextDefaults(style, this.systems?.game));
    };

    const creatorProto = Phaser.GameObjects.GameObjectCreator
      .prototype as unknown as TextCreatorProto;
    const makeText = creatorProto.text;
    creatorProto.text = function patchedMakeText(
      this: TextCreatorProto,
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
