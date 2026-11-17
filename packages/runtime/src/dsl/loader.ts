/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import Phaser from 'phaser';

import { Chase } from '../behaviors/Chase.js';
import { Dialog } from '../behaviors/Dialog.js';
import type { DialogOptions } from '../behaviors/Dialog.js';
import { EightWayMovement } from '../behaviors/EightWayMovement.js';
import { Patrol } from '../behaviors/Patrol.js';
import { Shoot } from '../behaviors/Shoot.js';
import {
  CollectOnTouch,
  DamageOnTouch,
  SceneTransition,
} from '../behaviors/WorldLink.js';
import { installDefaultSkillEffects } from '../skills/defaultSkillEffects.js';
import {
  Bounds,
  Draggable,
  GridSnap,
  Lifetime,
  Spawner,
  Velocity,
} from '../behaviors/extras.js';
import type { Behavior } from '../behaviors/IBehavior.js';
import type { Entity } from '../core/Entity.js';
import { RuntimeScene } from '../core/Scene.js';
import type { World } from '../core/World.js';
import { tunables } from '../dev/TunableRegistry.js';
import { SkillChain, type SkillDef } from '../skills/SkillChain.js';
import { HUD } from '../ui/HUD.js';
import { DISPLAY_FONT, UI_FONT, fontPx } from '../ui/fonts.js';

import type {
  BehaviorSpec,
  EntitySpec,
  GameDsl,
  SceneSpec,
} from './schema.js';
import { normalizeGameDsl, validateGameDsl, isPlausibleDataImageUrl, sceneSkippedByDslCompile } from './schema.js';
import { DialogueRunner, resolveDialogBehaviorLines } from './DialogueRunner.js';
import { EntityStateRegistry } from '../core/EntityState.js';

/** Sentinel id consumers can pass to `bootstrap` to use the first scene. */
export const INITIAL_SCENE = '__initial__';

type BehaviorFactory = (opts: Record<string, unknown>) => Behavior;

const BEHAVIOR_REGISTRY = new Map<string, BehaviorFactory>([
  ['patrol', (o) => new Patrol(o as never)],
  ['chase', (o) => new Chase(o as never)],
  ['shoot', (o) => new Shoot(o as never)],
  ['eightWayMovement', (o) => new EightWayMovement(o as never)],
  ['velocity', (o) => new Velocity(o as never)],
  ['lifetime', (o) => new Lifetime(o as never)],
  ['spawner', (o) => new Spawner(o as never)],
  ['bounds', (o) => new Bounds(o as never)],
  ['draggable', () => new Draggable()],
  ['gridSnap', (o) => new GridSnap(o as never)],
  ['dialog', (o) => new Dialog(o as unknown as DialogOptions)],
  ['sceneTransition', (o) => new SceneTransition(o as never)],
  ['collectOnTouch', (o) => new CollectOnTouch(o as never)],
  ['damageOnTouch', (o) => new DamageOnTouch(o as never)],
]);

export function registerBehavior(kind: string, factory: BehaviorFactory): void {
  BEHAVIOR_REGISTRY.set(kind, factory);
}

class DslScene extends RuntimeScene {
  private readonly spec: SceneSpec;
  private readonly dsl: GameDsl;
  private hud: HUD | null = null;
  private readonly entityState = new EntityStateRegistry();

  constructor(spec: SceneSpec, dsl: GameDsl) {
    super({ key: spec.id });
    this.spec = spec;
    this.dsl = dsl;
  }

  preload(): void {
    if (!this.dsl.assets) return;
    for (const a of this.dsl.assets) {
      if (a.kind === 'image' && a.url) {
        if (a.url.includes('.html')) {
          // eslint-disable-next-line no-console
          console.warn(`[opengame/runtime] skip image asset "${a.id}": URL looks like HTML, not an image`);
          continue;
        }
        if (/\.svg(\?|$)/i.test(a.url)) {
          // eslint-disable-next-line no-console
          console.warn(
            `[opengame/runtime] skip image asset "${a.id}": SVG is not supported as WebGL texture; using shape fallback`,
          );
          continue;
        }
        if (a.url.startsWith('data:image/') && !isPlausibleDataImageUrl(a.url)) {
          // eslint-disable-next-line no-console
          console.warn(`[opengame/runtime] skip image asset "${a.id}": invalid data URL`);
          continue;
        }
        this.load.image(a.id, a.url);
      } else if (a.kind === 'spritesheet' && a.frame && a.url) {
        this.load.spritesheet(a.id, a.url, {
          frameWidth: a.frame.width,
          frameHeight: a.frame.height,
        });
      } else if (a.kind === 'audio' && a.url) {
        this.load.audio(a.id, a.url);
      }
    }
  }

  protected override onReady(): void {
    installDefaultSkillEffects(this);
    const specBg = this.spec as SceneSpec & {
      background?: { type?: string; color?: number };
    };
    const bg = specBg.background;
    if (bg && typeof bg.color === 'number' && (!bg.type || bg.type === 'color')) {
      this.cameras.main.setBackgroundColor(bg.color);
    }
    // MiniMax / ArtDirector background — two-layer parallax under entities
    if (this.textures.exists('background')) {
      const { width, height } = this.scale;
      this.add
        .image(width / 2, height / 2, 'background')
        .setDisplaySize(width * 1.12, height * 1.12)
        .setDepth(-1000)
        .setScrollFactor(0.3);
      this.add
        .image(width / 2 + 24, height / 2 + 8, 'background')
        .setDisplaySize(width, height)
        .setDepth(-990)
        .setScrollFactor(0.6)
        .setAlpha(0.35)
        .setTint(0xcbd5e1);
    }
    const self = this as unknown as { __ogWorld: World };
    self.__ogWorld = this.getWorld();
    for (const entity of this.spec.entities) {
      this.spawnEntity(entity);
    }
    // Mirror player HP into the scene registry so DamageOnTouch / skill
    // `damage` effects and play probes share one fail state.
    if (this.registry.get('hp') == null) {
      const playerSpec = this.spec.entities.find((e) => {
        const tags = (e.tags ?? []).map((t) => String(t).toLowerCase());
        return tags.includes('player') || String(e.id).toLowerCase() === 'player';
      }) as (EntitySpec & { state?: Record<string, number> }) | undefined;
      const hp = playerSpec?.state?.['hp'];
      if (typeof hp === 'number' && Number.isFinite(hp) && hp > 0) {
        this.registry.set('hp', Math.round(hp));
        this.registry.set('maxHp', Math.round(hp));
      }
    }
    if (this.spec.hud?.score) {
      this.hud = new HUD(this);
      const initial = Number(this.registry.get('score') ?? 0);
      this.hud.setScore(initial);
    }
    this.events.on('og:score', (score: number) => {
      this.hud?.setScore(Number(score) || 0);
    });
    this.events.once('og:win', () => {
      this.handleSkillWin();
    });
    this.events.once('og:lose', () => {
      this.handleSkillLose();
    });
    const sceneExt = this.spec as SceneSpec & { dialogueKey?: string };
    if (sceneExt.dialogueKey && this.dsl.dialogue?.length) {
      new DialogueRunner(this, this.dsl.dialogue).start(sceneExt.dialogueKey);
    }
  }

  private playResultSfx(id: 'sfx_win' | 'sfx_lose'): void {
    try {
      if (this.cache.audio.exists(id)) {
        this.sound.play(id, { volume: 0.75 });
        return;
      }
      // Fallback: any audioTrack role matching
      const tracks = (
        this.dsl as GameDsl & {
          audioTracks?: Array<{ assetId?: string; role?: string }>;
        }
      ).audioTracks;
      const hit = tracks?.find(
        (t) =>
          t.assetId === id ||
          (id === 'sfx_win' && /win/i.test(t.role ?? '')) ||
          (id === 'sfx_lose' && /lose|fail/i.test(t.role ?? '')),
      );
      if (hit?.assetId && this.cache.audio.exists(hit.assetId)) {
        this.sound.play(hit.assetId, { volume: 0.75 });
      }
    } catch {
      // ignore autoplay / missing
    }
  }

  /** Grid / skills winAt — start Victory/GameOver if registered, else overlay. */
  private handleSkillWin(): void {
    if (this.registry.get('__ogWinHandled')) return;
    this.registry.set('__ogWinHandled', true);
    this.registry.set('won', true);
    this.playResultSfx('sfx_win');
    const targets = ['VictoryScene', 'GameOverScene', 'EndingScene', 'Victory', 'Ending'];
    for (const key of targets) {
      if (this.scene.get(key)) {
        this.scene.start(key);
        return;
      }
    }
    const { width, height } = this.scale;
    this.add
      .rectangle(width / 2, height / 2, width, height, 0x000000, 0.72)
      .setScrollFactor(0)
      .setDepth(9000);
    const title = this.add
      .text(width / 2, height * 0.4, 'Victory!', {
        fontSize: '46px',
        color: '#86efac',
        fontFamily: DISPLAY_FONT,
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(9001);
    this.tweens.add({
      targets: title,
      scale: 1.08,
      duration: 700,
      yoyo: true,
      repeat: -1,
    });
    this.add
      .text(width / 2, height * 0.55, 'Press R to reload', {
        fontFamily: UI_FONT,
        fontSize: fontPx(17),
        color: '#e2e8f0',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(9001);
    this.input.keyboard?.once('keydown-R', () => {
      window.location.reload();
    });
  }

  private handleSkillLose(): void {
    if (this.registry.get('__ogLoseHandled')) return;
    this.registry.set('__ogLoseHandled', true);
    this.registry.set('won', false);
    this.playResultSfx('sfx_lose');
    const targets = ['GameOverScene', 'DefeatScene', 'VictoryScene', 'GameOver'];
    for (const key of targets) {
      if (this.scene.get(key)) {
        this.scene.start(key, { won: false });
        return;
      }
    }
    const { width, height } = this.scale;
    this.add
      .rectangle(width / 2, height / 2, width, height, 0x000000, 0.72)
      .setScrollFactor(0)
      .setDepth(9000);
    this.add
      .text(width / 2, height * 0.4, 'Defeat', {
        fontSize: '46px',
        color: '#fca5a5',
        fontFamily: DISPLAY_FONT,
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(9001);
    this.add
      .text(width / 2, height * 0.55, 'Press R to reload', {
        fontFamily: UI_FONT,
        fontSize: fontPx(17),
        color: '#e2e8f0',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(9001);
    this.input.keyboard?.once('keydown-R', () => {
      window.location.reload();
    });
  }

  private spawnEntity(spec: EntitySpec): void {
    const entity = this.getWorld().spawn(spec.tags ?? []);
    const sprite = this.materializeSprite(spec);
    if (sprite) entity.attachSprite(sprite);
    const stateRaw = (spec as EntitySpec & { state?: Record<string, number> }).state;
    this.entityState.applyFromSpec(spec.id, stateRaw);
    const behaviors = Array.isArray(spec.behaviors) ? spec.behaviors : [];
    for (const beh of behaviors) {
      this.attachBehavior(entity, beh);
    }
    // Surface tunable params to the dev HUD / IDE side panel
    if (spec.tunables) {
      for (const [key, t] of Object.entries(spec.tunables)) {
        tunables.register(spec.id, key, t);
      }
    }
    if (spec.skills && this.dsl.skills) {
      const skillIds = Array.isArray(spec.skills)
        ? spec.skills
        : typeof spec.skills === 'object'
          ? Object.keys(spec.skills as object)
          : [];
      if (skillIds.length > 0) {
        const skillDefs: SkillDef[] = this.dsl.skills
          .filter((s) => skillIds.includes(s.id))
          .map((s) => ({
            id: s.id,
            trigger: s.trigger as never,
            effects: s.effects.slice() as never,
            ...(s.cooldownSec !== undefined ? { cooldownSec: s.cooldownSec } : {}),
          }));
        if (skillDefs.length > 0) {
          entity.add(new SkillChain(skillDefs));
        }
      }
    }
  }

  private materializeSprite(
    spec: EntitySpec,
  ): Phaser.GameObjects.GameObject | null {
    const s = spec.sprite;
    if (!s) return null;
    const tags = (spec.tags ?? []).map((t) => String(t).toLowerCase());
    const isPlayer =
      tags.includes('player') ||
      String(spec.id).toLowerCase() === 'player' ||
      s.assetId === 'player';
    const isEnemy =
      tags.includes('enemy') ||
      tags.includes('hazard') ||
      /enemy|hazard|mob|monster|foe|boss/.test(String(spec.id).toLowerCase());
    const isItem =
      tags.includes('item') ||
      tags.includes('collectible') ||
      /item|coin|gem|pickup|loot/.test(String(spec.id).toLowerCase());
    const defaultW = isPlayer ? 36 : isEnemy ? 40 : isItem ? 28 : 32;
    const defaultH = isPlayer ? 44 : isEnemy ? 36 : isItem ? 28 : 32;
    const displayW = Math.max(8, Number(s.width) || defaultW);
    const displayH = Math.max(8, Number(s.height) || defaultH);

    let go: Phaser.GameObjects.GameObject;
    if (s.assetId && this.textures.exists(s.assetId)) {
      const img = this.add.image(s.x, s.y, s.assetId);
      img.setDisplaySize(displayW, displayH);
      go = img;
    } else {
      if (s.assetId) {
        // eslint-disable-next-line no-console
        console.warn(
          `[opengame/runtime] texture missing for assetId="${s.assetId}" (entity ${spec.id}); using shape fallback`,
        );
      }
      const colorNum = s.color
        ? parseInt(s.color.replace('#', ''), 16)
        : 0xffffff;
      if (s.shape === 'circle') {
        const r = Math.max(displayW, displayH) / 2;
        go = this.add.circle(s.x, s.y, r, colorNum);
      } else {
        go = this.add.rectangle(s.x, s.y, displayW, displayH, colorNum);
      }
    }
    const depth =
      typeof (s as { depth?: number }).depth === 'number'
        ? (s as { depth: number }).depth
        : isPlayer
          ? 10
          : isEnemy
            ? 8
            : isItem
              ? 6
              : 0;
    if ('setDepth' in go) {
      (go as Phaser.GameObjects.Image).setDepth(depth);
    }
    if (isPlayer && 'setData' in go) {
      (go as Phaser.GameObjects.Image).setData('player', true);
    }
    // Subtle idle presence for raster subjects (engine feel, not noise)
    if (
      s.assetId &&
      this.textures.exists(s.assetId) &&
      (isPlayer || isItem) &&
      'setScale' in go
    ) {
      const img = go as Phaser.GameObjects.Image;
      const sx = img.scaleX;
      const sy = img.scaleY;
      this.tweens.add({
        targets: img,
        scaleX: sx * 1.04,
        scaleY: sy * 1.04,
        duration: 700,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }
    return go;
  }

  private attachBehavior(entity: Entity, spec: BehaviorSpec): void {
    if (spec.kind === 'dialog') {
      const opts = spec.options ?? {};
      const lines = resolveDialogBehaviorLines(opts, this.dsl.dialogue);
      if (lines) {
        entity.add(new Dialog({ lines }));
        return;
      }
    }
    const factory = BEHAVIOR_REGISTRY.get(spec.kind);
    if (!factory) {
      // eslint-disable-next-line no-console
      console.warn(`[opengame/runtime] unknown behavior kind: ${spec.kind}`);
      return;
    }
    entity.add(factory(spec.options ?? {}));
  }

  destroyScene(): void {
    this.hud?.destroy();
    this.hud = null;
    this.getWorld().destroyAll();
  }
}

export function compileDslToScenes(
  dsl: GameDsl | unknown,
): { sceneClasses: Phaser.Types.Scenes.SceneType[]; initialKey: string } {
  const normalized = normalizeGameDsl(dsl) as GameDsl;
  const errors = validateGameDsl(normalized);
  if (errors.length > 0) {
    throw new Error(`Invalid game.json: ${errors.join('; ')}`);
  }
  const sceneClasses = normalized.scenes
    .filter((s) => !sceneSkippedByDslCompile(s))
    .map(
      (s) =>
        class extends DslScene {
          constructor() {
            super(s, normalized);
          }
        } as unknown as Phaser.Types.Scenes.SceneType,
    );
  const initialKey =
    normalized.initialSceneId && normalized.initialSceneId !== INITIAL_SCENE
      ? normalized.initialSceneId
      : normalized.scenes[0]!.id;
  return { sceneClasses, initialKey };
}
