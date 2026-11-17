/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import Phaser from 'phaser';

import { compileDslToScenes } from './dsl/loader.js';
import {
  normalizeGameDsl,
  sceneDeferredToCustomPhaser,
  sceneStartCandidates,
  type GameDsl,
  type SceneSpec,
} from './dsl/schema.js';
import { installMobileInput } from './input/MobileInputAdapter.js';
import { installJiaxiBus } from './jiaxiBus.js';
import { AchievementsClient } from './services/Achievements.js';
import { SaveStore } from './services/SaveStore.js';
import { ensureFontsReady } from './ui/fonts.js';
import { installTextDefaults } from './ui/textDefaults.js';

/** Core template uses `#game-container`; runtime skeleton uses `#game-root`. */
function resolveDefaultParent(
  explicit: string | HTMLElement | undefined,
): string | HTMLElement {
  if (explicit !== undefined) return explicit;
  if (typeof document === 'undefined') return 'game-root';
  if (document.getElementById('game-root')) return 'game-root';
  if (document.getElementById('game-container')) return 'game-container';
  return 'game-root';
}

export interface BootstrapOptions {
  /** Either a pre-parsed DSL, or a relative URL to `fetch` it from. */
  readonly source: GameDsl | string;
  /** DOM id or HTMLElement to mount Phaser into. Defaults to `#game-root`. */
  readonly parent?: string | HTMLElement;
  /** Override / extend the Phaser config (sceneClasses are appended). */
  readonly phaserConfig?: Partial<Phaser.Types.Core.GameConfig>;
  /**
   * Custom Phaser Scene classes. Keys come from matching `game.json`
   * `scenes[].id` with `customModule` (same order as `extraScenes`).
   * Do not rely on `super('Key')` alone — duplicate `phaser` copies in Vite
   * bundles make constructor keys collapse to `"default"`.
   */
  readonly extraScenes?: ReadonlyArray<Phaser.Types.Scenes.SceneType>;
}

function sceneSysKey(entry: Phaser.Scene): string {
  return (
    entry?.sys?.settings?.key ||
    entry?.scene?.key ||
    (entry as { key?: string }).key ||
    ''
  );
}

/** Prefer Title/hub; never cold-boot into GameOver/Victory/Ending when alternatives exist. */
export function pickBootSceneKey(
  game: Phaser.Game,
  candidates: readonly string[],
): string | null {
  const isBoot = (k: string) =>
    !k || k === 'default' || k === '__og_boot' || k.startsWith('__og_hot_');
  const isEnding = (k: string) =>
    /gameover|victory|ending|defeat|result|lose/i.test(k);
  const isTitle = (k: string) => /title|menu|hub|start|attract/i.test(k);

  const registered: string[] = [];
  const seen = new Set<string>();
  const add = (k: string | undefined | null) => {
    if (!k || isBoot(k) || seen.has(k)) return;
    if (!game.scene.getScene(k)) return;
    seen.add(k);
    registered.push(k);
  };
  for (const k of candidates) add(k);
  for (const entry of game.scene.scenes) add(sceneSysKey(entry));

  if (registered.length === 0) return null;
  const titles = registered.filter(isTitle);
  if (titles.length > 0) return titles[0]!;
  const playable = registered.filter((k) => !isEnding(k));
  if (playable.length > 0) return playable[0]!;
  return registered[0]!;
}

/**
 * Register coder Scenes with explicit keys from game.json.
 * Fixes Vite duplicate-`phaser` where `super('TitleScene')` becomes key `"default"`.
 * Falls back to Scene class name when game.json customModule list is shorter / missing.
 */
function sceneClassRegisterKey(
  SceneClass: Phaser.Types.Scenes.SceneType,
): string {
  const named = SceneClass as { key?: string; name?: string };
  if (typeof named.key === 'string' && named.key.trim() && named.key !== 'default') {
    return named.key.trim();
  }
  const n =
    typeof named.name === 'string'
      ? named.name
      : ((SceneClass as { prototype?: { constructor?: { name?: string } } })
          .prototype?.constructor?.name ?? '');
  if (n && n !== 'Scene' && n !== 'Function' && n !== 'default') return n;
  return '';
}

function registerExtraScenesWithDslKeys(
  game: Phaser.Game,
  dsl: GameDsl,
  extraScenes: ReadonlyArray<Phaser.Types.Scenes.SceneType>,
): void {
  const deferred = (dsl.scenes ?? []).filter((s) =>
    sceneDeferredToCustomPhaser(s as SceneSpec),
  );
  const usedKeys = new Set<string>();
  extraScenes.forEach((SceneClass, i) => {
    const classKey = sceneClassRegisterKey(SceneClass);
    let key = deferred[i]?.id?.trim() || '';
    if (!key && classKey) {
      const byName = deferred.find((s) => {
        const id = s.id?.trim() || '';
        const cm = String(
          (s as unknown as { customModule?: string }).customModule ?? '',
        ).trim();
        return id === classKey || cm === classKey;
      });
      key = byName?.id?.trim() || classKey;
    }
    if (!key) {
      // eslint-disable-next-line no-console
      console.error(
        `[opengame/bootstrap] extraScenes[${i}] has no matching scenes[].customModule id in game.json`,
      );
      return;
    }
    if (usedKeys.has(key)) {
      // eslint-disable-next-line no-console
      console.warn(
        `[opengame/bootstrap] duplicate extraScenes key "${key}" — skipping index ${i}`,
      );
      return;
    }
    usedKeys.add(key);
    try {
      if (game.scene.getScene(key)) {
        game.scene.remove(key);
      }
      game.scene.add(key, SceneClass as never, false);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[opengame/bootstrap] failed to add scene "${key}":`, err);
    }
  });
}

/**
 * Single-call entry point. The skeleton's `main.ts` reduces to:
 *
 * ```ts
 * import { bootstrap } from '@opengame/runtime/bootstrap';
 * await bootstrap({ source: './game.json' });
 * ```
 */
export async function bootstrap(opts: BootstrapOptions): Promise<Phaser.Game> {
  // Before any Text exists: patch the factory for CJK family + high-DPI
  // rasterisation, and let webfonts settle so the first measure is not taken
  // against a fallback face.
  installTextDefaults();
  const raw = await resolveDsl(opts.source);
  const dsl = normalizeGameDsl(raw) as GameDsl;
  await ensureFontsReady();
  const { sceneClasses, initialKey } = compileDslToScenes(dsl);
  const extras = opts.extraScenes ?? [];
  const assets = dsl.assets ?? [];

  const startGameplay = (game: Phaser.Game): void => {
    startBackgroundAudio(game, dsl);
    applyIntentRegistry(game, dsl).catch(() => {
      /* optional og_intent */
    });
    const candidates = sceneStartCandidates(dsl, initialKey);
    const bootKey = pickBootSceneKey(game, candidates);
    if (bootKey) {
      try {
        game.scene.stop('__og_boot');
        // Remove so getScenes/probes never stick on the asset boot scene.
        game.scene.remove('__og_boot');
      } catch {
        /* optional */
      }
      game.scene.start(bootKey);
      return;
    }
    // eslint-disable-next-line no-console
    console.error(
      `[opengame/bootstrap] No registered Phaser scene to start. Tried keys: ${candidates.join(', ')}. Fix game.json initialSceneId / scenes[].id vs extraScenes Scene keys.`,
    );
  };

  /** First scene — loads MiniMax pack before any Title/Level create (no BGM race). */
  class OgAssetBoot extends Phaser.Scene {
    constructor() {
      super({ key: '__og_boot' });
    }
    preload(): void {
      /** MiniMax pack bare ids ↔ Scene/helper og_* keys (avoid rect fallback). */
      const IMAGE_ALIASES: Record<string, readonly string[]> = {
        player: ['og_player'],
        player_run: ['og_player_run'],
        background: ['og_bg'],
        enemy: ['og_enemy'],
        item: ['og_item'],
      };
      for (const a of assets) {
        if (!a?.url || !a.id) continue;
        if (a.kind === 'audio') {
          this.load.audio(a.id, a.url);
        } else if (a.kind === 'image') {
          if (/\.svg(\?|$)/i.test(a.url) || a.url.includes('.html')) continue;
          this.load.image(a.id, a.url);
          for (const alias of IMAGE_ALIASES[a.id] ?? []) {
            if (alias !== a.id) this.load.image(alias, a.url);
          }
          // Also accept game.json that already uses og_* as primary id.
          if (a.id.startsWith('og_')) {
            const bare = a.id.slice(3);
            if (bare === 'bg') this.load.image('background', a.url);
            else if (bare) this.load.image(bare, a.url);
          }
        } else if (a.kind === 'spritesheet' && a.frame) {
          this.load.spritesheet(a.id, a.url, {
            frameWidth: a.frame.width,
            frameHeight: a.frame.height,
          });
        }
      }
      if (
        !assets.some((a) => a.id === 'sfx_coin') &&
        assets.some((a) => a.id === 'sfx_win' && a.url)
      ) {
        const win = assets.find((a) => a.id === 'sfx_win');
        if (win?.url) this.load.audio('sfx_coin', win.url);
      }
    }
    create(): void {
      startGameplay(this.game);
    }
  }

  // Only Boot + DSL scenes here. Custom extraScenes are added with explicit
  // keys right after `new Game` — never via the constructor scene array.
  const { scene: _sceneOverride, ...phaserRest } = opts.phaserConfig ?? {};
  // Only genuinely pixel styles want nearest-neighbour sampling and pixel
  // snapping. Applying them to painterly art (the previous behaviour of any
  // scene that set pixelArt by hand) makes edges jagged instead of crisp.
  const pixelPerfect = dsl.meta.pixelPerfect === true;
  const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    parent: resolveDefaultParent(opts.parent),
    backgroundColor: dsl.meta.canvas?.background ?? '#000000',
    // 1280x720 rather than 960x540: Scale.FIT upscales the backbuffer to the
    // container, so a small base size meant every asset was resampled up.
    width: dsl.meta.canvas?.width ?? 1280,
    height: dsl.meta.canvas?.height ?? 720,
    pixelArt: pixelPerfect,
    roundPixels: pixelPerfect,
    antialias: !pixelPerfect,
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      // Integral canvas placement — fractional CSS scaling is its own source of
      // blur on top of the upscale.
      autoRound: true,
    },
    physics: {
      default: 'arcade',
      arcade: { gravity: { x: 0, y: 0 }, debug: false },
    },
    ...phaserRest,
    scene: [OgAssetBoot, ...sceneClasses],
  };

  const game = new Phaser.Game(config);
  registerExtraScenesWithDslKeys(game, dsl, extras);
  installJiaxiBus(game);
  installPlatformPlayerServices(game);
  installPlayProbe(game);
  // Phones have no keyboard, and almost every generated game steers with one.
  installMobileInput(game, dsl.meta.mobileInput ?? {});
  return game;
}

type PlatformGlobals = {
  __opengame_token__?: string;
  __opengame_deployment_id__?: string;
  __ogSaves?: SaveStore;
  __ogAchievements?: AchievementsClient;
};

function readPlatformDeploymentId(): string {
  const g = globalThis as PlatformGlobals;
  if (g.__opengame_deployment_id__) return g.__opengame_deployment_id__;
  if (typeof location === 'undefined') return '';
  try {
    return new URL(location.href).searchParams.get('ogDeploymentId') ?? '';
  } catch {
    return '';
  }
}

function installPlatformPlayerServices(game: Phaser.Game): void {
  const g = globalThis as PlatformGlobals;
  const apply = (): void => {
    const deploymentId = readPlatformDeploymentId();
    const saves = deploymentId
      ? SaveStore.remote({ deploymentId })
      : new SaveStore();
    g.__ogSaves = saves;
    if (deploymentId) {
      g.__ogAchievements = new AchievementsClient({ deploymentId });
    }
  };
  apply();
  if (typeof window !== 'undefined') {
    window.addEventListener('message', (event: MessageEvent) => {
      const data = event.data as {
        type?: string;
        token?: string;
        deploymentId?: string;
      };
      if (data?.type !== 'opengame:session') return;
      if (typeof data.token === 'string') g.__opengame_token__ = data.token;
      if (typeof data.deploymentId === 'string') {
        g.__opengame_deployment_id__ = data.deploymentId;
      }
      apply();
    });
  }
  game.events.on('og:win', () => {
    void g.__ogSaves?.save({ won: true, at: Date.now() }, 'auto');
    void g.__ogAchievements?.award({
      achievementKey: 'first_win',
      title: 'First win',
    });
  });
}

/** Headless smoke / IDE probe — score, win, scene, player pose, input/progress. */
function installPlayProbe(game: Phaser.Game): void {
  const g = globalThis as typeof globalThis & {
    __ogPlayProbe?: () => {
      score: number;
      won: boolean;
      winHandled: boolean;
      sceneKey: string | null;
      playerX: number | null;
      playerY: number | null;
      inputFrames: number;
      pointerFrames: number;
      kills: number;
      hp: number | null;
      enemyHp: number | null;
      progress: number;
    };
    __ogGame?: Phaser.Game;
    __ogInputFrames?: number;
    __ogPointerFrames?: number;
  };
  g.__ogGame = game;
  g.__ogInputFrames = 0;
  g.__ogPointerFrames = 0;
  game.events.on('og:input', () => {
    g.__ogInputFrames = (g.__ogInputFrames ?? 0) + 1;
  });
  const bumpKey = () => {
    g.__ogInputFrames = (g.__ogInputFrames ?? 0) + 1;
  };
  const bumpPointer = () => {
    g.__ogPointerFrames = (g.__ogPointerFrames ?? 0) + 1;
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', bumpKey, { passive: true });
    window.addEventListener('pointerdown', bumpPointer, { passive: true });
  }
  g.__ogPlayProbe = () => {
    const active = game.scene.getScenes(true);
    const scene =
      active.find((s) => {
        const k = s?.sys?.settings?.key ?? s?.scene?.key ?? '';
        return k && k !== '__og_boot' && !k.startsWith('__og_hot_');
      }) ?? active[0];
    const reg = scene?.registry;
    let playerX: number | null = null;
    let playerY: number | null = null;
    try {
      const anyScene = scene as Phaser.Scene & {
        player?: { x?: number; y?: number };
        children?: { list?: Array<{ x?: number; y?: number; getData?: (k: string) => unknown }> };
      };
      if (anyScene?.player && typeof anyScene.player.x === 'number') {
        playerX = anyScene.player.x;
        playerY = typeof anyScene.player.y === 'number' ? anyScene.player.y : null;
      } else if (anyScene?.children?.list) {
        const tagged = anyScene.children.list.find(
          (c) => c.getData?.('player') || c.getData?.('tag') === 'player',
        ) as { x?: number; y?: number } | undefined;
        if (tagged && typeof tagged.x === 'number') {
          playerX = tagged.x;
          playerY = typeof tagged.y === 'number' ? tagged.y : null;
        }
      }
    } catch {
      // optional
    }
    const hpRaw = reg?.get('hp');
    const enemyHpRaw = reg?.get('enemyHp');
    let talkedCount = 0;
    let inventory: string | null = null;
    try {
      const list =
        (reg as { list?: Record<string, unknown> } | undefined)?.list ?? {};
      for (const k of Object.keys(list)) {
        if (/^talked_/i.test(k) && list[k]) talkedCount += 1;
      }
      const inv = reg?.get('inventory');
      if (typeof inv === 'string' && inv) inventory = inv;
    } catch {
      /* optional */
    }
    return {
      score: Number(reg?.get('score') ?? 0),
      won: Boolean(reg?.get('won')),
      winHandled: Boolean(reg?.get('__ogWinHandled')),
      sceneKey: scene?.sys?.settings?.key ?? scene?.scene?.key ?? null,
      playerX,
      playerY,
      inputFrames: Number(g.__ogInputFrames ?? 0),
      pointerFrames: Number(g.__ogPointerFrames ?? 0),
      kills: Number(reg?.get('kills') ?? 0),
      hp: hpRaw == null ? null : Number(hpRaw),
      enemyHp: enemyHpRaw == null ? null : Number(enemyHpRaw),
      progress: Number(reg?.get('progress') ?? 0),
      talkedCount,
      chapterIndex: Number(reg?.get('chapterIndex') ?? 0),
      endingA: Boolean(reg?.get('ending_a')),
      endingB: Boolean(reg?.get('ending_b')),
      inventory,
      bossPresent: Boolean(
        reg?.get('bossPresent') ??
          reg?.get('bossAlive') ??
          (Number(reg?.get('bossHp') ?? 0) > 0),
      ),
      difficultyTier: (() => {
        const raw = reg?.get('difficultyTier') ?? reg?.get('difficulty');
        return raw == null ? null : Number(raw);
      })(),
      enemyCount: Number(reg?.get('enemyCount') ?? 0),
    };
  };
}

/** Stamp ChangePlan / og_intent onto registry for smoke + kernels. */
async function applyIntentRegistry(
  game: Phaser.Game,
  dsl: GameDsl,
): Promise<void> {
  let intent: {
    addBoss?: boolean;
    difficulty?: string | null;
    difficultyTier?: number;
    bossPresent?: boolean;
  } | null = null;
  if (typeof fetch !== 'undefined') {
    const readPlanFallback = async (): Promise<typeof intent> => {
      try {
        const res = await fetch('./CHANGE_PLAN.json');
        if (!res.ok) return null;
        const plan = (await res.json()) as {
          addBoss?: boolean;
          difficulty?: string | null;
        };
        return {
          addBoss: plan.addBoss,
          difficulty: plan.difficulty,
          difficultyTier:
            plan.difficulty === 'harder'
              ? 4
              : plan.difficulty === 'easier'
                ? 1
                : 2,
          bossPresent: Boolean(plan.addBoss),
        };
      } catch {
        return null;
      }
    };
    try {
      const res = await fetch('./og_intent.json');
      if (res.ok) {
        intent = (await res.json()) as typeof intent;
      } else {
        // Missing file is normal on first generate; avoid treating as required.
        intent = await readPlanFallback();
      }
    } catch {
      intent = await readPlanFallback();
    }
  }
  const tunables = (dsl as { tunables?: Record<string, unknown> }).tunables ?? {};
  const enemyCount = Number(tunables['enemyCount'] ?? 0);
  const tier = Number(
    intent?.difficultyTier ?? tunables['difficultyTier'] ?? 0,
  );
  const bossFromDsl = /\bboss\b/i.test(JSON.stringify(dsl.scenes ?? []));
  const stamp = (scene: Phaser.Scene): void => {
    if (tier > 0) scene.registry.set('difficultyTier', tier);
    if (enemyCount > 0) scene.registry.set('enemyCount', enemyCount);
    if (intent?.bossPresent || bossFromDsl || intent?.addBoss) {
      scene.registry.set('bossPresent', true);
    }
    if (intent?.difficulty === 'harder') {
      scene.registry.set('HARDER', true);
    }
  };
  for (const s of game.scene.getScenes(false)) {
    stamp(s);
  }
  game.events.on('start', () => {
    for (const s of game.scene.getScenes(true)) {
      stamp(s);
    }
  });
}

function startBackgroundAudio(game: Phaser.Game, dsl: GameDsl): void {
  const tracks = (dsl as GameDsl & { audioTracks?: Array<{ assetId: string; loop?: boolean; volume?: number; role?: string }> }).audioTracks;
  if (!tracks?.length) return;
  const bgm =
    tracks.find((t) => t.role === 'bgm') ??
    tracks.find((t) => t.assetId === 'bgm') ??
    tracks.find((t) => t.assetId) ??
    tracks[0];
  if (!bgm?.assetId) return;
  const play = (): void => {
    try {
      const existing = game.sound.get(bgm.assetId);
      if (existing?.isPlaying) return;
      // Prefer single global BGM key if already looping under 'bgm'
      const named = game.sound.get('bgm');
      if (named?.isPlaying) return;
      if (!game.cache.audio.exists(bgm.assetId)) return;
      game.sound.play(bgm.assetId, {
        loop: bgm.loop ?? true,
        volume: bgm.volume ?? 0.45,
      });
    } catch {
      // ignore autoplay policy
    }
  };
  play();
}

async function resolveDsl(source: GameDsl | string): Promise<GameDsl> {
  if (typeof source !== 'string') return source;
  if (typeof fetch === 'undefined') {
    throw new Error(
      'bootstrap: a string source requires a fetch-capable environment',
    );
  }
  const res = await fetch(source);
  if (!res.ok) {
    throw new Error(`bootstrap: failed to load DSL from ${source}: HTTP ${res.status}`);
  }
  const data: unknown = await res.json();
  return (await unwrapPlayDsl(data)) as GameDsl;
}

/**
 * Hosted play sessions wrap `game.json` with a session key injected as
 * `window.__OG_PLAY_KEY`. A mirrored copy of the JSON without that key is
 * just ciphertext — the studio preview path never sets the marker, so this
 * is a no-op there.
 */
async function unwrapPlayDsl(data: unknown): Promise<unknown> {
  if (!data || typeof data !== 'object') return data;
  const rec = data as { ogEnc?: number; iv?: string; ct?: string; tag?: string };
  if (rec.ogEnc !== 1 || !rec.iv || !rec.ct || !rec.tag) return data;
  const keyB64 = (globalThis as { __OG_PLAY_KEY?: string }).__OG_PLAY_KEY;
  if (!keyB64 || typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('bootstrap: play ticket missing — reload the hosted session');
  }
  const keyBytes = Uint8Array.from(atob(keyB64), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt']);
  const iv = Uint8Array.from(atob(rec.iv), (c) => c.charCodeAt(0));
  const ct = Uint8Array.from(atob(rec.ct), (c) => c.charCodeAt(0));
  const tag = Uint8Array.from(atob(rec.tag), (c) => c.charCodeAt(0));
  const packed = new Uint8Array(ct.length + tag.length);
  packed.set(ct, 0);
  packed.set(tag, ct.length);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, packed);
  return JSON.parse(new TextDecoder().decode(pt)) as unknown;
}
