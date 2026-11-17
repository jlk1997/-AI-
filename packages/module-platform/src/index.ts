/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import Phaser from 'phaser';

/** CJK-safe UI stack — avoids default Latin metrics clipping Chinese glyphs. */
export const UI_FONT =
  '"Noto Sans SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Source Han Sans SC", system-ui, "Segoe UI", sans-serif';

/** Headline stack for titles / endings — serif that still resolves CJK. */
export const DISPLAY_FONT =
  '"Noto Serif SC", "Songti SC", SimSun, "Source Han Serif SC", Georgia, serif';

/**
 * Floor size for canvas text. A Chinese glyph packs far more strokes into the
 * same box than a Latin letter, so anything smaller renders as a smudge on the
 * 960x540 canvas the generated games use.
 */
export const MIN_TEXT_PX = 14;

/** Clamp a Phaser `fontSize` up to {@link MIN_TEXT_PX}, leaving em/rem alone. */
function legibleFontSize(
  size: string | number | undefined,
): string | number | undefined {
  if (size == null) return `${MIN_TEXT_PX}px`;
  if (typeof size === 'number') return Math.max(MIN_TEXT_PX, size);
  const px = /^\s*(\d+(?:\.\d+)?)px\s*$/.exec(size);
  if (!px) return size;
  return `${Math.max(MIN_TEXT_PX, Number(px[1]))}px`;
}

/**
 * Device pixels per game pixel, for a Text object's internal canvas.
 *
 * `TextStyle.resolution` falls back to the Game Config resolution, which Phaser
 * 3.60 removed — so the effective default is 1. Labels were rasterised at 1x and
 * then upscaled by `Scale.FIT`, which is what made text look soft next to the
 * sprites. Pixel-art games stay at 1x: resampling a 3x glyph texture down with
 * NEAREST is noisy, and chunky text belongs to that look.
 */
export function textResolution(game?: Phaser.Game): number {
  if ((game?.config as { pixelArt?: boolean } | undefined)?.pixelArt) return 1;
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  const displayScale = game?.scale?.displayScale?.x;
  const upscale =
    typeof displayScale === 'number' && displayScale > 0 ? 1 / displayScale : 1;
  // Capped at 3 to bound the memory each label's canvas texture costs.
  return Math.min(3, Math.max(1, Math.round(dpr * upscale * 100) / 100));
}

export interface PlatformLevelConfig {
  readonly width: number;
  readonly height: number;
  readonly gravityY?: number;
}

/** Arcade physics + light juice helpers for side-scrolling / arcade Scenes. */
export class PlatformSceneHelper {
  static applyArcadePhysics(scene: Phaser.Scene, config: PlatformLevelConfig): void {
    const body = scene.physics.world;
    body.setBounds(0, 0, config.width, config.height);
    if (typeof config.gravityY === 'number') {
      body.gravity.y = config.gravityY;
    }
  }

  /**
   * Static ground: invisible physics slab + tiled visual strip (no full-bleed stretch).
   */
  static createGround(
    scene: Phaser.Scene,
    x: number,
    y: number,
    width: number,
    height: number,
    color = 0x334155,
    textureKey?: string,
  ): Phaser.GameObjects.Rectangle {
    const bodyRect = scene.add.rectangle(x, y, width, height, color, textureKey ? 0 : 1);
    scene.physics.add.existing(bodyRect, true);

    if (textureKey && scene.textures.exists(textureKey)) {
      const tileW = Math.max(48, Math.min(96, height * 2));
      const count = Math.max(1, Math.ceil(width / tileW));
      const startX = x - width / 2 + tileW / 2;
      for (let i = 0; i < count; i++) {
        scene.add
          .image(startX + i * tileW, y, textureKey)
          .setDisplaySize(tileW + 2, height)
          .setTint(0x94a3b8)
          .setDepth(-1);
      }
    }
    return bodyRect;
  }

  /** Two-layer parallax backdrop from a MiniMax background texture. */
  static addParallaxBackground(
    scene: Phaser.Scene,
    textureKey: string,
    width = 960,
    height = 540,
  ): { far: Phaser.GameObjects.Image; mid: Phaser.GameObjects.Image } | null {
    if (!scene.textures.exists(textureKey)) return null;
    const far = scene.add
      .image(width / 2, height / 2, textureKey)
      .setDisplaySize(width * 1.15, height * 1.15)
      .setScrollFactor(0.25)
      .setDepth(-100)
      .setAlpha(0.95);
    const mid = scene.add
      .image(width / 2 + 40, height / 2 + 10, textureKey)
      .setDisplaySize(width * 1.05, height * 1.05)
      .setScrollFactor(0.55)
      .setDepth(-90)
      .setAlpha(0.4)
      .setTint(0xcbd5e1);
    return { far, mid };
  }

  /** Align arcade body to current display size (images after setDisplaySize). */
  static syncBodyToDisplay(
    go: Phaser.GameObjects.GameObject,
    displayW: number,
    displayH: number,
  ): void {
    const body = (
      go as Phaser.GameObjects.GameObject & {
        body?: Phaser.Physics.Arcade.Body | Phaser.Physics.Arcade.StaticBody;
      }
    ).body;
    if (!body) return;
    body.setSize(displayW, displayH);
    if ('updateFromGameObject' in body && typeof body.updateFromGameObject === 'function') {
      body.updateFromGameObject();
    }
  }

  static followPlayer(
    scene: Phaser.Scene,
    player: Phaser.GameObjects.GameObject,
    boundsW = 960,
    boundsH = 540,
  ): void {
    scene.cameras.main.setBounds(0, 0, boundsW, boundsH);
    scene.cameras.main.startFollow(player, true, 0.14, 0.14);
    scene.cameras.main.setDeadzone(120, 80);
  }

  static playSfx(scene: Phaser.Scene, key: string, volume = 0.55): void {
    try {
      if (scene.cache.audio.exists(key)) {
        scene.sound.play(key, { volume });
        return;
      }
      if (key === 'sfx_coin' && scene.cache.audio.exists('sfx_win')) {
        scene.sound.play('sfx_win', { volume: Math.min(0.4, volume) });
      }
    } catch {
      // autoplay / missing — ignore
    }
  }

  static burst(
    scene: Phaser.Scene,
    x: number,
    y: number,
    color = 0xfbbf24,
    count = 8,
  ): void {
    for (let i = 0; i < count; i++) {
      const r = 2 + Math.random() * 4;
      const c = scene.add.circle(x, y, r, color).setDepth(50);
      scene.tweens.add({
        targets: c,
        x: x + (Math.random() - 0.5) * 90,
        y: y + (Math.random() - 0.5) * 90 - 20,
        alpha: 0,
        scale: 0.2,
        duration: 260 + Math.random() * 220,
        onComplete: () => c.destroy(),
      });
    }
  }

  static shake(scene: Phaser.Scene, duration = 140, intensity = 0.006): void {
    try {
      scene.cameras.main.shake(duration, intensity);
    } catch {
      // optional
    }
  }

  /** ESC / P pause overlay: Resume · Restart · Mute BGM. */
  static installPauseMenu(
    scene: Phaser.Scene,
    options?: { readonly restartKey?: string },
  ): void {
    const restartKey = options?.restartKey ?? scene.scene.key;
    let open = false;
    const nodes: Phaser.GameObjects.GameObject[] = [];

    const close = (): void => {
      open = false;
      scene.physics?.world?.resume();
      scene.tweens.resumeAll();
      for (const n of nodes) n.destroy();
      nodes.length = 0;
    };

    const openMenu = (): void => {
      if (open) {
        close();
        return;
      }
      open = true;
      scene.physics?.world?.pause();
      scene.tweens.pauseAll();
      const { width, height } = scene.scale;
      const dim = scene.add
        .rectangle(width / 2, height / 2, width, height, 0x020617, 0.72)
        .setScrollFactor(0)
        .setDepth(5000)
        .setInteractive();
      const title = scene.add
        .text(width / 2, height * 0.32, 'Paused', {
          fontFamily: DISPLAY_FONT,
          fontSize: '36px',
          color: '#f8fafc',
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(5001);
      const hint = scene.add
        .text(
          width / 2,
          height * 0.42,
          'ESC / P resume · R restart · M mute BGM',
          { fontFamily: UI_FONT, fontSize: '16px', color: '#94a3b8' },
        )
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(5001);
      nodes.push(dim, title, hint);
      dim.on('pointerdown', () => close());
    };

    const onEsc = (): void => {
      if (!scene.scene.isActive()) return;
      openMenu();
    };
    const onP = (): void => {
      if (!scene.scene.isActive()) return;
      openMenu();
    };
    const onR = (): void => {
      if (!scene.scene.isActive() || !open) return;
      close();
      try {
        scene.input.keyboard?.resetKeys();
      } catch {
        /* optional */
      }
      // Prefer jumping to a Title/hub scene over soft-restarting a half-dead Level.
      if (restartKey && restartKey !== scene.scene.key) {
        scene.scene.start(restartKey);
        return;
      }
      scene.scene.restart();
    };
    const onM = (): void => {
      if (!scene.scene.isActive()) return;
      try {
        const bgm = scene.sound.get('bgm');
        if (bgm && 'isPlaying' in bgm) {
          if ((bgm as Phaser.Sound.BaseSound).isPlaying) {
            (bgm as Phaser.Sound.BaseSound).pause();
          } else {
            (bgm as Phaser.Sound.BaseSound).resume();
          }
        } else {
          scene.sound.mute = !scene.sound.mute;
        }
      } catch {
        scene.sound.mute = !scene.sound.mute;
      }
    };

    scene.input.keyboard?.on('keydown-ESC', onEsc);
    scene.input.keyboard?.on('keydown-P', onP);
    scene.input.keyboard?.on('keydown-R', onR);
    scene.input.keyboard?.on('keydown-M', onM);

    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      scene.input.keyboard?.off('keydown-ESC', onEsc);
      scene.input.keyboard?.off('keydown-P', onP);
      scene.input.keyboard?.off('keydown-R', onR);
      scene.input.keyboard?.off('keydown-M', onM);
      close();
    });
  }

  /** Standard MiniMax audio keys used by engine kernels. */
  static preloadGameAudio(scene: Phaser.Scene): void {
    scene.load.audio('bgm', './assets/bgm.mp3');
    scene.load.audio('sfx_win', './assets/sfx_win.mp3');
    scene.load.audio('sfx_lose', './assets/sfx_lose.mp3');
    scene.load.audio('sfx_coin', './assets/sfx_win.mp3');
  }

  /**
   * MiniMax art pack — idle/run player + enemy/item/bg with og_* aliases.
   */
  static preloadGameArt(scene: Phaser.Scene): void {
    scene.load.image('player', './assets/player.png');
    scene.load.image('og_player', './assets/player.png');
    scene.load.image('player_run', './assets/player_run.png');
    scene.load.image('og_player_run', './assets/player_run.png');
    scene.load.image('background', './assets/background.png');
    scene.load.image('og_bg', './assets/background.png');
    scene.load.image('enemy', './assets/enemy.png');
    scene.load.image('og_enemy', './assets/enemy.png');
    scene.load.image('item', './assets/item.png');
    scene.load.image('og_item', './assets/item.png');
    // Walk atlas + tilemap (asset-forge) — optional; ignore load errors
    scene.load.atlas(
      'player_walk',
      './assets/player_walk.png',
      './assets/player_walk.json',
    );
    scene.load.image('tileset', './assets/tileset.png');
    scene.load.json('region_tilemap', './assets/region_tilemap.json');
  }

  /** Create 4-dir walk anims when player_walk atlas frames exist. */
  static ensureWalkAnims(scene: Phaser.Scene): boolean {
    if (!scene.textures.exists('player_walk')) return false;
    const dirs = ['down', 'left', 'right', 'up'] as const;
    for (const d of dirs) {
      const key = `walk_${d}`;
      if (scene.anims.exists(key)) continue;
      const frames = scene.anims.generateFrameNames('player_walk', {
        prefix: `walk_${d}_`,
        start: 0,
        end: 2,
        zeroPad: 0,
      });
      if (!frames.length) continue;
      scene.anims.create({
        key,
        frames,
        frameRate: 8,
        repeat: -1,
      });
    }
    return true;
  }

  /** Feet-anchored sprite + ground shadow (kills floating bust look). */
  static spawnGroundedSprite(
    scene: Phaser.Scene,
    x: number,
    y: number,
    textureKey: string,
    displayH = 56,
    fallbackColor = 0xfbbf24,
  ): Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle {
    scene.add.ellipse(x, y + 2, 36, 10, 0x000000, 0.28).setDepth(y - 1);
    const key = PlatformSceneHelper.resolveTextureKey(scene, textureKey);
    if (key && scene.textures.exists(key)) {
      const img = scene.add.image(x, y, key).setOrigin(0.5, 1);
      img.setDisplaySize(Math.round(displayH * 0.75), displayH);
      img.setDepth(10 + Math.floor(y));
      return img;
    }
    const rect = scene.add
      .rectangle(x, y - displayH / 2, 36, displayH, fallbackColor)
      .setDepth(10 + Math.floor(y));
    return rect;
  }

  /**
   * After OgAssetBoot (or any load) registered bare MiniMax ids, mirror them to
   * og_* so Scene code that asks for og_player does not fall back to rects.
   * Call from create() when preload early-returned because textures already exist.
   */
  /**
   * Phaser defaults text to `"Courier New", Courier, monospace` at whatever size
   * the caller passes. Courier carries no CJK glyphs, so Chinese copy fell
   * through to a per-glyph browser fallback with mismatched metrics, and 11px
   * labels were unreadable. Patch this scene's factories so text inherits the
   * CJK stack and the legible floor unless it asked for something specific.
   */
  static installTextDefaults(scene: Phaser.Scene): void {
    const marked = scene as Phaser.Scene & { __ogTextDefaults?: boolean };
    if (marked.__ogTextDefaults) return;
    marked.__ogTextDefaults = true;

    const withDefaults = (
      style?: Phaser.Types.GameObjects.Text.TextStyle,
    ): Phaser.Types.GameObjects.Text.TextStyle => {
      const next = { ...(style ?? {}) };
      if (!next.resolution) next.resolution = textResolution(scene.game);
      // `font` is the shorthand that carries family and size together; if the
      // scene set it, respect it wholesale.
      if (next.font) return next;
      if (!next.fontFamily) next.fontFamily = UI_FONT;
      next.fontSize = legibleFontSize(next.fontSize);
      return next;
    };

    try {
      const factory = scene.add;
      const addText = factory.text.bind(factory);
      factory.text = (x, y, text, style) => addText(x, y, text, withDefaults(style));
      const creator = scene.make;
      const makeText = creator.text.bind(creator);
      creator.text = (config, addToScene) =>
        makeText({ ...config, style: withDefaults(config?.style) }, addToScene);
    } catch {
      /* optional — never block a scene over cosmetics */
    }
  }

  static ensureGameArtAliases(scene: Phaser.Scene): void {
    PlatformSceneHelper.installTextDefaults(scene);
    const pairs: Array<[string, string]> = [
      ['player', 'og_player'],
      ['og_player', 'player'],
      ['player_run', 'og_player_run'],
      ['og_player_run', 'player_run'],
      ['background', 'og_bg'],
      ['og_bg', 'background'],
      ['enemy', 'og_enemy'],
      ['og_enemy', 'enemy'],
      ['item', 'og_item'],
      ['og_item', 'item'],
    ];
    for (const [from, to] of pairs) {
      if (!scene.textures.exists(from) || scene.textures.exists(to)) continue;
      try {
        // Same Texture object under a second key — no network reload.
        const src = scene.textures.get(from);
        const sourceImage = src.getSourceImage() as HTMLImageElement | HTMLCanvasElement;
        if (sourceImage) {
          scene.textures.addImage(to, sourceImage as HTMLImageElement);
        }
      } catch {
        /* optional */
      }
    }
  }

  /** Resolve og_* ↔ bare MiniMax keys. */
  static resolveTextureKey(scene: Phaser.Scene, textureKey: string): string | null {
    if (scene.textures.exists(textureKey)) return textureKey;
    if (textureKey.startsWith('og_')) {
      const bare = textureKey === 'og_bg' ? 'background' : textureKey.slice(3);
      if (bare && scene.textures.exists(bare)) return bare;
    } else {
      const og = textureKey === 'background' ? 'og_bg' : `og_${textureKey}`;
      if (scene.textures.exists(og)) return og;
    }
    return null;
  }

  /**
   * Flip Image facing from horizontal velocity (right-facing art default).
   * No-ops for Rectangle fallbacks.
   */
  static applyFacingFromVelocity(
    sprite: Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle,
    vx: number,
    deadzone = 8,
  ): void {
    if (!(sprite instanceof Phaser.GameObjects.Image)) return;
    if (vx < -deadzone) sprite.setFlipX(true);
    else if (vx > deadzone) sprite.setFlipX(false);
  }

  /**
   * Switch player Image between idle / run poses. Facing via flipX (no left art).
   * No-ops for Rectangle fallbacks or missing run texture (falls back to idle).
   */
  static applyPlayerPose(
    scene: Phaser.Scene,
    player: Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle,
    opts: {
      readonly vx: number;
      readonly runThreshold?: number;
      readonly idleKey?: string;
      readonly runKey?: string;
    },
  ): void {
    if (!(player instanceof Phaser.GameObjects.Image)) return;
    const thresh = opts.runThreshold ?? 40;
    const idle =
      PlatformSceneHelper.resolveTextureKey(scene, opts.idleKey ?? 'og_player') ??
      PlatformSceneHelper.resolveTextureKey(scene, 'player');
    const run =
      PlatformSceneHelper.resolveTextureKey(scene, opts.runKey ?? 'og_player_run') ??
      PlatformSceneHelper.resolveTextureKey(scene, 'player_run') ??
      idle;
    if (!idle) return;
    const want = Math.abs(opts.vx) >= thresh && run ? run : idle;
    if (player.texture.key !== want) {
      const w = player.displayWidth;
      const h = player.displayHeight;
      player.setTexture(want);
      player.setDisplaySize(w, h);
    }
    PlatformSceneHelper.applyFacingFromVelocity(player, opts.vx);
  }

  /** Prefer MiniMax sprite; try og_ / bare aliases; else colored rect. */
  static spriteOrRect(
    scene: Phaser.Scene,
    x: number,
    y: number,
    textureKey: string,
    w: number,
    h: number,
    fallbackColor: number,
  ): Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle {
    PlatformSceneHelper.ensureGameArtAliases(scene);
    const key = PlatformSceneHelper.resolveTextureKey(scene, textureKey);
    if (key) {
      return scene.add.image(x, y, key).setDisplaySize(w, h);
    }
    return scene.add.rectangle(x, y, w, h, fallbackColor);
  }

  /** Play BGM once (no double-start). */
  static ensureBgm(scene: Phaser.Scene, volume = 0.35): void {
    try {
      const existing = scene.sound.get('bgm');
      if (existing?.isPlaying) return;
      if (scene.cache.audio.exists('bgm')) {
        scene.sound.play('bgm', { loop: true, volume });
      }
    } catch {
      // optional
    }
  }
}

/** Shared UI kit — dialogue panel / HUD / title strip (avoid naked full-screen text). */
export class GameUiKit {
  /**
   * Top title chip. Height grows with wrapped Chinese text so glyphs are never
   * clipped by a fixed 40px bar (common CJK ascent issue).
   */
  static addTitleStrip(
    scene: Phaser.Scene,
    title: string,
    opts?: { readonly y?: number; readonly width?: number },
  ): Phaser.GameObjects.Container {
    const w = opts?.width ?? scene.scale.width;
    const y = opts?.y ?? 40;
    const wrapW = Math.min(w - 96, 520);
    const text = scene.add
      .text(0, 0, title, {
        fontSize: '18px',
        fontFamily: UI_FONT,
        color: '#e2e8f0',
        fontStyle: 'bold',
        align: 'center',
        // Extra vertical padding counters CJK ascent being cut by thin frames.
        padding: { x: 16, y: 12 },
        wordWrap: { width: wrapW, useAdvancedWrap: true },
      })
      .setOrigin(0.5);
    const boxW = Math.max(220, Math.min(w - 48, text.width + 8));
    const boxH = Math.max(52, text.height + 6);
    const bg = scene.add
      .rectangle(0, 0, boxW, boxH, 0x0f172a, 1)
      .setStrokeStyle(1, 0x38bdf8, 0.75);
    return scene.add
      .container(w / 2, y, [bg, text])
      .setScrollFactor(0)
      .setDepth(50);
  }

  static addHudLabel(
    scene: Phaser.Scene,
    x: number,
    y: number,
    label: string,
  ): Phaser.GameObjects.Text {
    return scene.add
      .text(x, y, label, {
        fontSize: '14px',
        fontFamily: UI_FONT,
        color: '#cbd5e1',
        backgroundColor: '#0f172acc',
        padding: { x: 10, y: 6 },
        wordWrap: { width: 280, useAdvancedWrap: true },
      })
      .setScrollFactor(0)
      .setDepth(60);
  }

  /**
   * Compact chrome control (Skip / Pause). Tall enough for CJK/Latin, high depth,
   * stops pointer propagation so scene-level advance handlers do not steal clicks.
   */
  static addChromeButton(
    scene: Phaser.Scene,
    label: string,
    opts: {
      readonly x: number;
      readonly y: number;
      readonly onClick: () => void;
      readonly width?: number;
      readonly height?: number;
      readonly depth?: number;
    },
  ): {
    bg: Phaser.GameObjects.Rectangle;
    label: Phaser.GameObjects.Text;
  } {
    const depth = opts.depth ?? 5000;
    const text = scene.add
      .text(opts.x, opts.y, label, {
        fontSize: '14px',
        fontFamily: UI_FONT,
        color: '#e2e8f0',
        align: 'center',
        padding: { x: 10, y: 8 },
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(depth + 1);
    const bw = opts.width ?? Math.max(112, text.width + 12);
    const bh = opts.height ?? Math.max(40, text.height + 4);
    const bg = scene.add
      .rectangle(opts.x, opts.y, bw, bh, 0x0f172a, 0.92)
      .setStrokeStyle(1, 0x94a3b8, 0.9)
      .setScrollFactor(0)
      .setDepth(depth)
      .setInteractive({ useHandCursor: true });
    const fire = (
      _p: Phaser.Input.Pointer,
      _x: number,
      _y: number,
      event?: Phaser.Types.Input.EventData,
    ) => {
      event?.stopPropagation?.();
      opts.onClick();
    };
    bg.on('pointerdown', (
      _p: Phaser.Input.Pointer,
      _x: number,
      _y: number,
      event?: Phaser.Types.Input.EventData,
    ) => {
      event?.stopPropagation?.();
    });
    bg.on('pointerup', fire);
    return { bg, label: text };
  }

  /**
   * Bottom dialogue panel with portrait slot + speaker + body (Chinese-safe wrap).
   *
   * Critical CJK rules:
   * - Never use Phaser `fixedHeight` on body text (crops glyph bottoms).
   * - Panel fill is fully opaque so background art watermarks cannot bleed through.
   * - Extra padding + lineSpacing + light stroke for crisp Chinese.
   */
  static addDialoguePanel(
    scene: Phaser.Scene,
    opts?: {
      readonly width?: number;
      readonly height?: number;
      readonly portraitKey?: string;
    },
  ): {
    panel: Phaser.GameObjects.Rectangle;
    plate: Phaser.GameObjects.Rectangle;
    speaker: Phaser.GameObjects.Text;
    body: Phaser.GameObjects.Text;
    portrait: Phaser.GameObjects.Image | null;
    setLine: (speaker: string, line: string) => void;
    setVisible: (visible: boolean) => void;
  } {
    const W = opts?.width ?? 960;
    const H = opts?.height ?? 540;
    const panelH = 200;
    const panelY = H - 10 - panelH / 2;
    const panelTop = panelY - panelH / 2;
    const textX = 196;
    const textMaxW = Math.min(620, W - textX - 40);

    // Fully opaque plate — alpha < 1 lets busy MiniMax BGs (baked English glyphs) bleed.
    const panel = scene.add
      .rectangle(W / 2, panelY, W - 24, panelH, 0x070b14, 1)
      .setStrokeStyle(2, 0x38bdf8, 0.9)
      .setScrollFactor(0)
      .setDepth(100);

    // Inner content plate further isolates body text from portrait/BG noise.
    const plate = scene.add
      .rectangle(
        textX + textMaxW / 2 - 8,
        panelY + 8,
        textMaxW + 28,
        panelH - 28,
        0x0c1220,
        1,
      )
      .setStrokeStyle(1, 0x1e293b, 0.9)
      .setScrollFactor(0)
      .setDepth(101);

    let portrait: Phaser.GameObjects.Image | null = null;
    const pKey = opts?.portraitKey;
    if (pKey && scene.textures.exists(pKey)) {
      portrait = scene.add
        .image(92, panelY, pKey)
        .setDisplaySize(84, 108)
        .setScrollFactor(0)
        .setDepth(102);
    }

    const speaker = scene.add
      .text(textX, panelTop + 16, '', {
        fontSize: '18px',
        fontFamily: UI_FONT,
        color: '#67e8f9',
        fontStyle: 'bold',
        padding: { x: 4, y: 6 },
        stroke: '#070b14',
        strokeThickness: 3,
      })
      .setScrollFactor(0)
      .setDepth(103);
    try {
      speaker.setResolution(2);
    } catch {
      /* older Phaser */
    }

    // NO fixedHeight — that is what chops Chinese glyph bottoms mid-stroke.
    const body = scene.add
      .text(textX, panelTop + 48, '', {
        fontSize: '17px',
        fontFamily: UI_FONT,
        color: '#f1f5f9',
        wordWrap: { width: textMaxW, useAdvancedWrap: true },
        lineSpacing: 10,
        align: 'left',
        padding: { x: 4, y: 10 },
        stroke: '#070b14',
        strokeThickness: 2,
      })
      .setScrollFactor(0)
      .setDepth(103);
    try {
      body.setResolution(2);
    } catch {
      /* older Phaser */
    }

    const fitBody = (line: string) => {
      body.setText(line);
      // Soft clamp: if wrapped body grows past plate, bump font down once for long lines.
      const maxBodyH = panelH - 64;
      if (body.height > maxBodyH && line.length > 40) {
        body.setStyle({ fontSize: '15px', lineSpacing: 8 });
        body.setText(line);
      } else {
        body.setStyle({ fontSize: '17px', lineSpacing: 10 });
        body.setText(line);
      }
    };

    const setVisible = (visible: boolean) => {
      panel.setVisible(visible);
      plate.setVisible(visible);
      speaker.setVisible(visible);
      body.setVisible(visible);
      if (portrait) portrait.setVisible(visible);
      if (visible) {
        panel.setAlpha(1);
        plate.setAlpha(1);
      }
    };

    // Keep plate reference alive via closure so dim/restore can hide it too.
    (panel as Phaser.GameObjects.Rectangle & { __plate?: Phaser.GameObjects.Rectangle }).__plate =
      plate;

    return {
      panel,
      plate,
      speaker,
      body,
      portrait,
      setLine: (spk: string, line: string) => {
        speaker.setText(spk || '');
        fitBody(line || '');
      },
      setVisible,
    };
  }

  /**
   * Hide/dim bottom dialogue while ChoicePanel is open — prevents text overlap
   * and keeps the choice stack readable above the bar.
   */
  static dimDialogueForChoices(ui: {
    panel: Phaser.GameObjects.Rectangle;
    plate?: Phaser.GameObjects.Rectangle;
    speaker: Phaser.GameObjects.Text;
    body: Phaser.GameObjects.Text;
    portrait: Phaser.GameObjects.Image | null;
    setVisible?: (visible: boolean) => void;
  }): void {
    if (typeof ui.setVisible === 'function') {
      ui.setVisible(false);
      return;
    }
    ui.panel.setVisible(false);
    ui.plate?.setVisible(false);
    const plate = (
      ui.panel as Phaser.GameObjects.Rectangle & {
        __plate?: Phaser.GameObjects.Rectangle;
      }
    ).__plate;
    if (plate) plate.setVisible(false);
    ui.speaker.setVisible(false);
    ui.body.setVisible(false);
    if (ui.portrait) ui.portrait.setVisible(false);
  }

  /** Restore dialogue bar after a choice is dismissed / next line shown. */
  static restoreDialoguePanel(
    ui: {
      panel: Phaser.GameObjects.Rectangle;
      plate?: Phaser.GameObjects.Rectangle;
      speaker: Phaser.GameObjects.Text;
      body: Phaser.GameObjects.Text;
      portrait: Phaser.GameObjects.Image | null;
      setVisible?: (visible: boolean) => void;
    },
    alpha = 1,
  ): void {
    if (typeof ui.setVisible === 'function') {
      ui.setVisible(true);
      ui.panel.setAlpha(alpha);
      ui.plate?.setAlpha(1);
      return;
    }
    ui.panel.setVisible(true);
    ui.panel.setAlpha(alpha);
    ui.plate?.setVisible(true);
    ui.plate?.setAlpha(1);
    const plate = (
      ui.panel as Phaser.GameObjects.Rectangle & {
        __plate?: Phaser.GameObjects.Rectangle;
      }
    ).__plate;
    if (plate) {
      plate.setVisible(true);
      plate.setAlpha(1);
    }
    ui.speaker.setVisible(true);
    ui.body.setVisible(true);
    if (ui.portrait) ui.portrait.setVisible(true);
  }
}
