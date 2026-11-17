/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Playable scene kernels used by engine scaffold. Archetype is a lens, not a SKU.
 */

import type { GameArchetype } from '../workspace.js';

type SceneStub = {
  readonly file: string;
  readonly className: string;
  readonly sceneKey: string;
  readonly hint: string;
};

export function inferSceneRole(
  stub: SceneStub,
  archetype: GameArchetype,
): 'title' | 'level' | 'world' | 'td' | 'battle' | 'chapter' | 'ending' {
  const lower = stub.sceneKey.toLowerCase();
  if (/title|menu|start|boot/i.test(lower)) return 'title';
  if (/gameover|victory|ending|defeat|result/i.test(lower)) return 'ending';
  if (/battle|combat|fight/i.test(lower)) return 'battle';
  if (/chapter|dialogue|story|cutscene/i.test(lower)) return 'chapter';
  if (/td|tower|defense|wave/i.test(lower)) return 'td';
  if (/world|explore|overworld|map|dungeon|town/i.test(lower)) return 'world';
  if (/level|stage|platform|run/i.test(lower)) return 'level';
  // Ambiguous names (main/game/play) follow archetype
  switch (archetype) {
    case 'top_down':
      return 'world';
    case 'tower_defense':
      return 'td';
    case 'ui_heavy':
      return /play|main|game/i.test(lower) ? 'battle' : 'chapter';
    case 'platformer':
    default:
      return 'level';
  }
}

export function pickTitleNextScene(
  archetype: GameArchetype,
  allStubs: readonly SceneStub[],
  selfKey: string,
): string {
  const others = allStubs.filter((s) => s.sceneKey !== selfKey);
  switch (archetype) {
    case 'top_down': {
      // Narrative beat: Title → Chapter opener → World explore
      const chapter = others.find((s) => /chapter/i.test(s.sceneKey));
      if (chapter) return chapter.sceneKey;
      return others.find((s) => /world/i.test(s.sceneKey))?.sceneKey ?? 'WorldScene';
    }
    case 'tower_defense':
      return others.find((s) => /td|tower/i.test(s.sceneKey))?.sceneKey ?? 'TDScene';
    case 'ui_heavy':
      return (
        others.find((s) => /chapter|battle/i.test(s.sceneKey))?.sceneKey ??
        'ChapterScene'
      );
    case 'platformer':
    default: {
      const ranked = others.find((s) =>
        /level|stage|world|td|tower|battle|chapter|play|run/i.test(s.sceneKey),
      );
      if (ranked) return ranked.sceneKey;
      return (
        others.find((s) => /level/i.test(s.sceneKey))?.sceneKey ??
        others[0]?.sceneKey ??
        'Level1Scene'
      );
    }
  }
}

export function renderSceneStub(
  stub: SceneStub,
  archetype: GameArchetype,
  allStubs: readonly SceneStub[] = [],
): string {
  const key = stub.sceneKey;
  const lower = key.toLowerCase();
  const role = inferSceneRole(stub, archetype);

  // Title / menu kernels
  if (role === 'title' || /title|menu|start/i.test(lower)) {
    const next = pickTitleNextScene(archetype, allStubs, key);
    const openerOnly = archetype === 'top_down' && /chapter/i.test(next);
    return `import Phaser from 'phaser';
import { PlatformSceneHelper, GameUiKit } from '@opengame/module-platform';

/** Playable kernel — Title. Explicit Start only (no canvas click). */
export class ${stub.className} extends Phaser.Scene {
  private armed = false;
  private started = false;

  constructor() {
    super('${key}');
  }

  preload(): void {
    if (this.textures.exists('og_player') || this.textures.exists('player')) {
      this.load.json('og_story_bible', './STORY_BIBLE.json');
      return;
    }
    this.load.image('og_bg', './assets/background.png');
    this.load.image('og_player', './assets/player.png');
    this.load.json('og_story_bible', './STORY_BIBLE.json');
    PlatformSceneHelper.preloadGameAudio(this);
    PlatformSceneHelper.preloadGameArt(this);
  }

  create(): void {
    PlatformSceneHelper.ensureGameArtAliases(this);
    this.armed = false;
    this.started = false;
    this.registry.set('lives', 3);
    this.registry.set('score', 0);
    this.registry.set('coins', 0);
    this.registry.set('won', false);
    this.registry.set('chapterIndex', 0);
    this.registry.set('chapterOpenerOnly', ${openerOnly ? 'true' : 'false'});
    this.registry.set('worldRegionId', '');
    this.cameras.main.setBackgroundColor('#0f172a');
    try { this.input.keyboard?.resetKeys(); } catch { /* optional */ }

    if (this.textures.exists('og_bg')) {
      this.add.image(480, 270, 'og_bg').setDisplaySize(960, 540).setDepth(-10);
    }
    if (this.textures.exists('og_player')) {
      this.add.image(480, 140, 'og_player').setDisplaySize(72, 88).setDepth(1);
    }
    PlatformSceneHelper.ensureBgm(this, 0.35);

    const bible = this.cache.json.get('og_story_bible') as
      | { title?: string }
      | undefined;
    const title =
      String(bible?.title ?? this.registry.get('title') ?? 'OpenGame').slice(0, 48);
    this.registry.set('title', title);
    GameUiKit.addTitleStrip(this, title, { y: 230, width: 960 });
    ${
      openerOnly
        ? `this.add.text(480, 278, '开场剧情 → 世界探索', {
      fontSize: '14px',
      color: '#94a3b8',
      wordWrap: { width: 400, useAdvancedWrap: true },
    }).setOrigin(0.5).setDepth(4);`
        : ''
    }

    const btn = this.add
      .rectangle(480, 320, 280, 48, 0x0f172a, 0.92)
      .setStrokeStyle(2, 0xfbbf24, 1)
      .setDepth(3)
      .setInteractive({ useHandCursor: true });
    this.add
      .text(480, 320, '▶ START  ·  SPACE', {
        fontSize: '18px',
        color: '#fde68a',
        wordWrap: { width: 260, useAdvancedWrap: true },
      })
      .setOrigin(0.5)
      .setDepth(4);

    this.time.delayedCall(500, () => { this.armed = true; });
    const go = () => {
      if (!this.armed || this.started) return;
      this.started = true;
      try { this.input.keyboard?.resetKeys(); } catch { /* optional */ }
      this.scene.start('${next}');
    };
    btn.on('pointerup', go);
    this.input.keyboard?.on('keyup-SPACE', go);
    this.input.keyboard?.on('keyup-ENTER', go);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.keyboard?.off('keyup-SPACE', go);
      this.input.keyboard?.off('keyup-ENTER', go);
    });
  }
}
`;
  }

  // Game over / ending / victory
  if (role === 'ending' || /gameover|ending|victory|defeat|result/i.test(lower)) {
    const titleKey =
      allStubs.find((s) => /title|menu|start/i.test(s.sceneKey))?.sceneKey ??
      'TitleScene';
    return `import Phaser from 'phaser';
import { PlatformSceneHelper, GameUiKit } from '@opengame/module-platform';

/** Playable kernel — result screen. Copy from STORY_BIBLE.endings SSOT. */
export class ${stub.className} extends Phaser.Scene {
  private armed = false;
  private restarting = false;

  constructor() {
    super('${key}');
  }

  preload(): void {
    this.load.json('og_story_bible', './STORY_BIBLE.json');
    if (this.textures.exists('og_player') || this.textures.exists('player')) return;
    this.load.image('og_bg', './assets/background.png');
    this.load.image('og_player', './assets/player.png');
    this.load.audio('sfx_win', './assets/sfx_win.mp3');
    this.load.audio('sfx_lose', './assets/sfx_lose.mp3');
  }

  create(): void {
    PlatformSceneHelper.ensureGameArtAliases(this);
    const won = Boolean(this.registry.get('won'));
    const score = Number(this.registry.get('score') ?? 0);
    const endingA = Boolean(this.registry.get('ending_a'));
    const endingB = Boolean(this.registry.get('ending_b'));
    const bible = this.cache.json.get('og_story_bible') as
      | {
          endings?: Array<{ id?: string; title?: string; body?: string }>;
          title?: string;
        }
      | undefined;
    const endings = Array.isArray(bible?.endings) ? bible!.endings! : [];
    const pickEnding = (id: string) =>
      endings.find((e) => e && e.id === id) ?? null;
    const endingMeta = endingB
      ? pickEnding('ending_b')
      : endingA
        ? pickEnding('ending_a')
        : null;

    this.cameras.main.setBackgroundColor(won ? '#14532d' : '#450a0a');
    if (this.textures.exists('og_bg')) {
      this.add
        .image(480, 270, 'og_bg')
        .setDisplaySize(960, 540)
        .setDepth(-10)
        .setTint(won ? 0x86efac : 0xfda4af)
        .setAlpha(0.45);
    }
    if (this.textures.exists('og_player')) {
      this.add
        .image(480, 110, 'og_player')
        .setDisplaySize(64, 80)
        .setTint(won ? 0xffffff : 0xf87171);
    }
    const headline = won
      ? (endingMeta?.title && String(endingMeta.title).trim()) ||
        (endingB
          ? '结局乙 · 另一条路'
          : endingA
            ? '结局甲 · 守约'
            : '胜利')
      : '挑战失败';
    const bodyText = won
      ? (endingMeta?.body && String(endingMeta.body).trim()) ||
        (score > 0
          ? \`Score \${score} · 你完成了这一程。\`
          : '你走完了这一程。')
      : score > 0
        ? \`Score \${score} · 再试一次。\`
        : '再试一次，故事还在等你。';

    GameUiKit.addTitleStrip(this, String(headline).slice(0, 48), {
      y: 200,
      width: 960,
    });
    this.add
      .text(480, 268, String(bodyText).slice(0, 160), {
        fontSize: '15px',
        color: '#e2e8f0',
        align: 'center',
        wordWrap: { width: 520, useAdvancedWrap: true },
      })
      .setOrigin(0.5)
      .setDepth(4)
      .setScrollFactor(0);

    const btn = this.add
      .rectangle(480, 380, 320, 44, 0x0f172a, 0.92)
      .setStrokeStyle(2, won ? 0x86efac : 0xfda4af, 1)
      .setInteractive({ useHandCursor: true });
    this.add
      .text(480, 380, '▶ BACK TO TITLE  ·  R', {
        fontSize: '16px',
        color: '#e2e8f0',
        wordWrap: { width: 300, useAdvancedWrap: true },
      })
      .setOrigin(0.5);

    const sfx = won ? 'sfx_win' : 'sfx_lose';
    try {
      if (this.cache.audio.exists(sfx)) this.sound.play(sfx, { volume: 0.55 });
    } catch {
      /* optional */
    }

    this.armed = false;
    this.time.delayedCall(450, () => { this.armed = true; });
    const restart = () => {
      if (!this.armed || this.restarting) return;
      this.restarting = true;
      try { this.input.keyboard?.resetKeys(); } catch { /* optional */ }
      this.registry.set('won', false);
      this.registry.set('score', 0);
      this.registry.set('lives', 3);
      this.registry.set('chapterIndex', 0);
      this.registry.set('ending_a', false);
      this.registry.set('ending_b', false);
      this.registry.set('worldRegionId', '');
      this.registry.set('chapterOpenerOnly', false);
      if (this.scene.get('${titleKey}')) {
        this.scene.start('${titleKey}');
        return;
      }
      window.location.reload();
    };
    btn.on('pointerup', restart);
    this.input.keyboard?.once('keyup-R', restart);
    this.input.keyboard?.once('keyup-SPACE', restart);
    this.input.keyboard?.once('keyup-ENTER', restart);
  }
}
`;
  }

    // Platformer level — PlatformSceneHelper arcade kernel (+ MiniMax sprites)
  if (
    role === 'level' ||
    (archetype === 'platformer' && /level|stage/i.test(lower)) ||
    (/level1|level_/i.test(lower) && archetype !== 'ui_heavy')
  ) {
    return `import Phaser from 'phaser';
import { PlatformSceneHelper, GameUiKit } from '@opengame/module-platform';

/** Playable kernel — platformer + coins/score + MiniMax art. */
export class ${stub.className} extends Phaser.Scene {
  private player!: Phaser.GameObjects.Rectangle | Phaser.GameObjects.Image;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private hud!: Phaser.GameObjects.Text;
  private score = 0;
  private lives = 3;
  private invulnUntil = 0;

  constructor() {
    super('${key}');
  }

  preload(): void {
    if (this.textures.exists('player') || this.textures.exists('og_player')) return;
    PlatformSceneHelper.preloadGameAudio(this);
    PlatformSceneHelper.preloadGameArt(this);
  }

  create(): void {
    PlatformSceneHelper.ensureGameArtAliases(this);
    this.lives = 3;
    this.invulnUntil = this.time.now + 1800;
    this.registry.set('lives', this.lives);
    this.registry.set('enemySpeedMul', 0.75);
    if (!PlatformSceneHelper.addParallaxBackground(this, 'og_bg')) {
      this.cameras.main.setBackgroundColor('#1e293b');
    }
    PlatformSceneHelper.applyArcadePhysics(this, {
      width: 960,
      height: 540,
      gravityY: 900,
    });
    PlatformSceneHelper.installPauseMenu(this, { restartKey: 'TitleScene' });
    const ground = PlatformSceneHelper.createGround(
      this,
      480,
      500,
      960,
      40,
      0x334155,
      this.textures.exists('og_bg') ? 'og_bg' : undefined,
    );

    this.player = PlatformSceneHelper.spriteOrRect(
      this,
      120,
      420,
      'player',
      36,
      44,
      0xf4a261,
    );
    this.player.setData('player', true);
    this.physics.add.existing(this.player);
    const p = this.player.body as Phaser.Physics.Arcade.Body;
    PlatformSceneHelper.syncBodyToDisplay(this.player, 36, 44);
    p.setCollideWorldBounds(true);
    p.setBounce(0.05);
    this.physics.add.collider(this.player, ground);
    PlatformSceneHelper.followPlayer(this, this.player);

    const spawnFoe = (x: number, y: number, scale = 1, isBoss = false) => {
      const w = Math.round(48 * scale);
      const h = Math.round(36 * scale);
      const foe = PlatformSceneHelper.spriteOrRect(
        this,
        x,
        y,
        'enemy',
        w,
        h,
        isBoss ? 0x7f1d1d : 0xef4444,
      );
      if (isBoss) {
        foe.setData('boss', true);
        this.registry.set('bossPresent', true);
        this.add
          .text(x, y - 42, 'BOSS', { fontSize: '12px', color: '#fecaca' })
          .setOrigin(0.5)
          .setDepth(50);
      }
      this.physics.add.existing(foe, true);
      PlatformSceneHelper.syncBodyToDisplay(foe, w, h);
      this.physics.add.overlap(this.player, foe, () => {
        if (this.time.now < this.invulnUntil) return;
        this.invulnUntil = this.time.now + 1200;
        this.lives -= 1;
        this.registry.set('lives', this.lives);
        PlatformSceneHelper.shake(this, 180, 0.01);
        PlatformSceneHelper.playSfx(this, 'sfx_lose', 0.55);
        const pb = this.player.body as Phaser.Physics.Arcade.Body;
        pb.reset(120, 400);
        this.player.setPosition(120, 400);
        pb.setVelocity(0, -40);
        this.hud.setText(\`Score \${this.lives >= 0 ? this.score : this.score} · Lives \${Math.max(0, this.lives)}\`);
        if (this.lives <= 0) {
          this.registry.set('won', false);
          this.registry.set('score', this.score);
          this.scene.start('GameOverScene');
        }
      });
    };

    spawnFoe(420, 460, 1, false);

    // ChangePlan intent: harder extras + Boss (og_intent / DSL → registry)
    const wantBoss = Boolean(this.registry.get('bossPresent'));
    const extraFoes = Math.max(
      0,
      Number(this.registry.get('enemyCount') ?? 1) - 1,
    );
    const tier = Math.max(1, Number(this.registry.get('difficultyTier') ?? 1));
    for (let i = 0; i < Math.min(extraFoes, 4); i++) {
      spawnFoe(280 + i * 130, 460 - (i % 2) * 16, 1 + (tier > 2 ? 0.15 : 0));
    }
    if (wantBoss) {
      spawnFoe(640, 430, 1.65, true);
    }

    const goal = PlatformSceneHelper.spriteOrRect(
      this,
      880,
      460,
      'item',
      40,
      48,
      0x22c55e,
    );
    if (goal instanceof Phaser.GameObjects.Image) goal.setTint(0x22c55e);
    this.physics.add.existing(goal, true);
    PlatformSceneHelper.syncBodyToDisplay(goal, 40, 48);
    this.physics.add.overlap(this.player, goal, () => {
      PlatformSceneHelper.burst(this, goal.x, goal.y, 0x86efac, 14);
      PlatformSceneHelper.playSfx(this, 'sfx_win', 0.6);
      this.registry.set('won', true);
      this.registry.set('score', this.score);
      this.scene.start('GameOverScene');
    });

    for (const x of [280, 520, 700]) {
      const coin = PlatformSceneHelper.spriteOrRect(
        this,
        x,
        360,
        'item',
        28,
        28,
        0xfbbf24,
      );
      this.physics.add.existing(coin, true);
      this.physics.add.overlap(this.player, coin, () => {
        if (!coin.active) return;
        PlatformSceneHelper.burst(this, coin.x, coin.y, 0xfbbf24, 8);
        PlatformSceneHelper.playSfx(this, 'sfx_coin', 0.45);
        coin.destroy();
        this.score += 1;
        this.registry.set('score', this.score);
        this.hud.setText('Score ' + this.score + ' · coins · reach green · avoid foe');
        this.events.emit('og:score', this.score);
      });
    }

    this.hud = GameUiKit.addHudLabel(
      this,
      16,
      12,
      'Score 0 · coins · reach green · avoid foe',
    );

    // Clickable difficulty chip (never decorate as a button without setInteractive).
    let easy = true;
    const diffBg = this.add
      .rectangle(480, 520, 120, 22, 0x0f172a, 0.85)
      .setStrokeStyle(1, 0x38bdf8)
      .setScrollFactor(0)
      .setDepth(99)
      .setInteractive({ useHandCursor: true });
    const diffTxt = this.add
      .text(480, 520, '◆ EASY', {
        fontSize: '11px',
        color: '#38bdf8',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(100);
    diffBg.on('pointerup', () => {
      easy = !easy;
      this.registry.set('enemySpeedMul', easy ? 0.75 : 1.15);
      diffTxt.setText(easy ? '◆ EASY' : '◆ NORMAL');
      diffTxt.setColor(easy ? '#38bdf8' : '#fbbf24');
    });

    this.cursors = this.input.keyboard!.createCursorKeys();
  }

  update(): void {
    const b = this.player.body as Phaser.Physics.Arcade.Body;
    const speed = 220;
    if (this.cursors.left?.isDown) b.setVelocityX(-speed);
    else if (this.cursors.right?.isDown) b.setVelocityX(speed);
    else b.setVelocityX(0);
    if (this.cursors.up?.isDown && b.blocked.down) b.setVelocityY(-420);
    PlatformSceneHelper.applyPlayerPose(this, this.player, { vx: b.velocity.x });
  }
}
`;
  }

  // Top-down world — ContentDirector cast + NPC art + GameUiKit
  if (
    role === 'world' ||
    archetype === 'top_down' ||
    /world|explore|overworld/i.test(lower)
  ) {
    return `import Phaser from 'phaser';
import { PlatformSceneHelper, GameUiKit } from '@opengame/module-platform';
import { WorldSceneHelper } from '@opengame/module-world';
import {
  Inventory,
  QuestDag,
  EquipmentLoadout,
  SaveStore,
  Shop,
  craft,
  ReputationBoard,
  createActorStats,
  gainXp,
  type EquipmentDef,
  type ActorStats,
  type Recipe,
} from '@opengame/module-systems';
import {
  npcAssetKey,
  readBibleFromCache,
  resolveWorldLayoutFromGame,
  resolveWorldLayoutsBySceneId,
  type StoryBible,
} from '../content/ContentDirector';

/** Playable kernel — top-down fetch driven by STORY_BIBLE + multi-region layout + systems. */
export class ${stub.className} extends Phaser.Scene {
  private player!: Phaser.GameObjects.Rectangle | Phaser.GameObjects.Image;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: {
    W: Phaser.Input.Keyboard.Key;
    A: Phaser.Input.Keyboard.Key;
    S: Phaser.Input.Keyboard.Key;
    D: Phaser.Input.Keyboard.Key;
  };
  private bag = new Inventory(24);
  private quests: QuestDag | null = null;
  private gear = new EquipmentLoadout();
  private saves = new SaveStore();
  private shop: Shop | null = null;
  private recipes: Recipe[] = [];
  private fame = new ReputationBoard();
  private juice = { cameraShake: true, particles: true, hitStopMs: 40, sfxOnHit: true };
  private stats!: ActorStats;
  private equipDefs: EquipmentDef[] = [];
  private dialogueBySpeaker = new Map<string, string[]>();
  private worldHelper!: WorldSceneHelper;
  private tip!: Phaser.GameObjects.Text;
  private hasWalk = false;

  constructor() {
    super('${key}');
  }

  preload(): void {
    PlatformSceneHelper.preloadGameAudio(this);
    PlatformSceneHelper.preloadGameArt(this);
    this.load.json('og_story_bible', './STORY_BIBLE.json');
    this.load.json('og_content_graph', './CONTENT_GRAPH.json');
    this.load.json('og_game', './game.json');
    this.load.json('og_systems', './SYSTEMS.json');
    this.load.json('og_content', './CONTENT.json');
    this.load.json('region_tilemap', './assets/region_tilemap.json');
    this.load.image('tileset', './assets/tileset.png');
    this.load.on('loaderror', () => {
      /* optional story / portrait / seed / forge assets */
    });
  }

    async create(): Promise<void> {
    PlatformSceneHelper.ensureGameArtAliases(this);
    PlatformSceneHelper.installPauseMenu(this);
    this.hasWalk = PlatformSceneHelper.ensureWalkAnims(this);

    const systems = this.cache.json.get('og_systems') as
      | {
          inventoryCapacity?: number;
          growth?: { baseHp?: number; baseAtk?: number };
          equipment?: EquipmentDef[];
          economy?: {
            startingGold?: number;
            items?: Array<{ id: string; name?: string; price?: number; tags?: string[] }>;
            recipes?: Recipe[];
          };
          juiceBudget?: {
            cameraShake?: boolean;
            particles?: boolean;
            hitStopMs?: number;
            sfxOnHit?: boolean;
          };
        }
      | undefined;
    if (systems?.inventoryCapacity) {
      this.bag = new Inventory(systems.inventoryCapacity);
    }
    this.stats = createActorStats(
      systems?.growth?.baseHp ?? 20,
      systems?.growth?.baseAtk ?? 3,
    );
    this.equipDefs = systems?.equipment ?? [];
    this.recipes = systems?.economy?.recipes ?? [];
    if (systems?.economy?.items?.length) {
      this.shop = new Shop(
        systems.economy.items.map((i) => ({
          id: i.id,
          name: i.name ?? i.id,
          price: i.price ?? 5,
        })),
        systems.economy.startingGold ?? 40,
      );
    }
    if (systems?.juiceBudget) {
      this.juice = {
        cameraShake: systems.juiceBudget.cameraShake !== false,
        particles: systems.juiceBudget.particles !== false,
        hitStopMs: systems.juiceBudget.hitStopMs ?? 40,
        sfxOnHit: systems.juiceBudget.sfxOnHit !== false,
      };
    }
    for (const f of (systems as { factions?: string[] } | undefined)?.factions ?? ['town']) {
      if (this.fame.get(f) === 0) this.fame.adjust(f, 0);
    }
    const content = this.cache.json.get('og_content') as
      | {
          quests?: Array<{
            id: string;
            title: string;
            description?: string;
            requires?: string[];
          }>;
          dialogues?: Array<{ speaker: string; lines: string[] }>;
        }
      | undefined;
    if (content?.quests?.length) {
      this.quests = new QuestDag(
        content.quests.map((q) => ({
          id: q.id,
          title: q.title,
          description: q.description,
          requires: q.requires ?? [],
          status: 'locked' as const,
        })),
      );
    }
    for (const d of content?.dialogues ?? []) {
      const key = String(d.speaker || '').toLowerCase();
      if (key && d.lines?.length) this.dialogueBySpeaker.set(key, d.lines);
    }
    // Starter gear from SYSTEMS so equipment path is live
    const weaponDef = this.equipDefs.find((e) => e.slot === 'weapon');
    if (weaponDef) {
      this.bag.add(weaponDef.id, 1);
      this.gear.equip('weapon', weaponDef.id, this.bag);
    }
    const saved = this.saves.read('slot0');
    if (saved?.payload?.stats) {
      this.stats = saved.payload.stats as ActorStats;
    }

    // Phaser Tilemap from asset-forge region_tilemap.json (not tinted sprites)
    const tilemapData = this.cache.json.get('region_tilemap') as
      | { width?: number; height?: number; gids?: number[]; tileSize?: number }
      | undefined;
    if (tilemapData?.gids?.length && tilemapData.width && tilemapData.height) {
      const ts = tilemapData.tileSize ?? 32;
      if (!this.textures.exists('og_tiles')) {
        const g = this.make.graphics({ x: 0, y: 0 });
        const colors = [0x2d6a4f, 0x8b7355, 0x1b4332, 0x1d4e89, 0x40916c];
        colors.forEach((c, i) => {
          g.fillStyle(c, 1);
          g.fillRect(i * ts, 0, ts, ts);
        });
        g.generateTexture('og_tiles', ts * colors.length, ts);
        g.destroy();
      }
      const rows: number[][] = [];
      for (let y = 0; y < tilemapData.height; y++) {
        const row: number[] = [];
        for (let x = 0; x < tilemapData.width; x++) {
          const gid = tilemapData.gids[y * tilemapData.width + x] ?? 1;
          row.push(Math.max(0, Math.min(4, gid - 1)));
        }
        rows.push(row);
      }
      const map = this.make.tilemap({
        data: rows,
        tileWidth: ts,
        tileHeight: ts,
      });
      const tilesetKey = this.textures.exists('tileset') ? 'tileset' : 'og_tiles';
      const tiles = map.addTilesetImage(
        'og_ground',
        tilesetKey,
        ts,
        ts,
        0,
        0,
      );
      if (tiles) {
        map.createLayer(0, tiles, 0, 0)?.setDepth(0);
      }
    }

    const gameJson = this.cache.json.get('og_game');
    const layoutsBySceneId = resolveWorldLayoutsBySceneId(gameJson);
    type SeedExit = { portalId: string; toSceneId: string; label?: string };
    const seedExitByPortal = new Map<string, SeedExit>();
    let seedInitial: string | null = null;
    try {
      const seedMod = await import('../world/worldSeed');
      seedInitial =
        typeof (seedMod as { INITIAL_SCENE_ID?: string }).INITIAL_SCENE_ID ===
        'string'
          ? (seedMod as { INITIAL_SCENE_ID: string }).INITIAL_SCENE_ID
          : null;
      const scenes = (seedMod as { WORLD_SCENES?: Array<{ exits?: SeedExit[] }> })
        .WORLD_SCENES;
      for (const sc of scenes ?? []) {
        for (const ex of sc.exits ?? []) {
          if (ex.portalId && ex.toSceneId) seedExitByPortal.set(ex.portalId, ex);
        }
      }
    } catch {
      /* optional WORLD_SEED module */
    }
    const isEngineShellId = (id: string) =>
      /^(Title|Chapter|World|Ending|GameOver|Victory|Battle|Level|Hub|Menu)Scene$/i.test(
        id,
      );
    const regionKeys = Object.keys(layoutsBySceneId).filter(
      (k) => k && !isEngineShellId(k),
    );
    const worldStartFromJson =
      gameJson &&
      typeof gameJson === 'object' &&
      typeof (gameJson as { worldStartRegionId?: unknown }).worldStartRegionId ===
        'string'
        ? String(
            (gameJson as { worldStartRegionId: string }).worldStartRegionId,
          ).trim()
        : '';
    const jsonInitial =
      typeof (gameJson as { initialSceneId?: string } | null)?.initialSceneId ===
      'string'
        ? (gameJson as { initialSceneId: string }).initialSceneId
        : '';
    const regionId =
      String(this.registry.get('worldRegionId') ?? '') ||
      worldStartFromJson ||
      seedInitial ||
      (jsonInitial && !isEngineShellId(jsonInitial) ? jsonInitial : '') ||
      regionKeys[0] ||
      '${key}';
    this.registry.set('worldRegionId', regionId);

    // Per-region background: bg_region_<slug> → bg_chapter_NN → og_bg
    const regionSlug = regionId
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 24);
    const regionBgKey = 'bg_region_' + (regionSlug || 'main');
    const regionIdx = Math.max(0, regionKeys.indexOf(regionId));
    const chapterBgKey =
      'bg_chapter_' + String(regionIdx + 1).padStart(2, '0');
    if (!this.textures.exists(regionBgKey)) {
      this.load.image(regionBgKey, './assets/' + regionBgKey + '.png');
    }
    if (regionIdx >= 1 && !this.textures.exists(chapterBgKey)) {
      this.load.image(chapterBgKey, './assets/' + chapterBgKey + '.png');
    }
    if (this.load.list.size > 0) {
      await new Promise<void>((resolve) => {
        this.load.once('complete', () => resolve());
        this.load.once('loaderror', () => resolve());
        this.load.start();
      });
    }
    const bgKey = this.textures.exists(regionBgKey)
      ? regionBgKey
      : this.textures.exists(chapterBgKey)
        ? chapterBgKey
        : 'og_bg';
    if (!PlatformSceneHelper.addParallaxBackground(this, bgKey)) {
      this.cameras.main.setBackgroundColor('#14532d');
    }

    // Region BGM: prefer bgm_region_<slug>, else restart global bgm at region volume
    const playRegionBgm = (slug: string, idx: number) => {
      const regionBgmKey = 'bgm_region_' + (slug || 'main');
      const volumes = [0.32, 0.28, 0.36, 0.4, 0.3];
      const vol = volumes[Math.abs(idx) % volumes.length]!;
      try {
        for (const key of ['bgm', regionBgmKey]) {
          const playing = this.sound.get(key);
          if (playing?.isPlaying) playing.stop();
        }
        if (this.cache.audio.exists(regionBgmKey)) {
          this.sound.play(regionBgmKey, { loop: true, volume: vol });
          return;
        }
        if (this.cache.audio.exists('bgm')) {
          this.sound.play('bgm', { loop: true, volume: vol });
        }
      } catch {
        PlatformSceneHelper.ensureBgm(this, vol);
      }
    };
    playRegionBgm(regionSlug || 'main', regionIdx);

    try {
      const { ChapterCinematicPresenter } = await import(
        '../presentation/ChapterCinematicPresenter'
      );
      await ChapterCinematicPresenter.playOpener(this, regionIdx);
    } catch {
      /* optional highlight */
    }

    const worldLayout =
      layoutsBySceneId[regionId] ?? resolveWorldLayoutFromGame(gameJson);
    const spawn = worldLayout.player ?? { x: 200, y: 270 };

    this.worldHelper = new WorldSceneHelper(this, {
      mapWidth: 960,
      mapHeight: 540,
      playerSpeed: 200,
    });
    this.player = PlatformSceneHelper.spawnGroundedSprite(
      this, spawn.x, spawn.y, this.hasWalk ? 'player_walk' : 'player', 56, 0xfbbf24,
    );
    if (this.hasWalk && this.player instanceof Phaser.GameObjects.Image) {
      try {
        this.player.play('walk_down');
      } catch { /* frames optional */ }
    }
    this.player.setData('player', true);
    this.physics.add.existing(this.player);
    const pb = this.player.body as Phaser.Physics.Arcade.Body;
    pb.setSize(36, 36);
    this.worldHelper.clampToWorld(this.player);
    PlatformSceneHelper.followPlayer(this, this.player);

    const bible: StoryBible | null = readBibleFromCache(this.cache);
    const bonus = this.gear.bonuses(this.equipDefs);
    const title = bible?.title ?? content?.quests?.[0]?.title ?? 'Explore';
    GameUiKit.addTitleStrip(this, title.slice(0, 36), { y: 28, width: 960 });
    this.tip = GameUiKit.addHudLabel(
      this,
      16,
      56,
      (regionId ? regionId + ' · ' : '') +
        'Lv' +
        this.stats.level +
        ' ATK' +
        (this.stats.atk + bonus.atk) +
        ' · Talk (E)',
    );
    this.applyJiaxiDrama();
    this.game.events.on('opengame:jiaxi', () => this.applyJiaxiDrama());

    const spawnFoe = (x: number, y: number, scale = 1, isBoss = false) => {
      const s = Math.round(40 * scale);
      const foe = PlatformSceneHelper.spriteOrRect(
        this, x, y, 'enemy', s, s, isBoss ? 0x7f1d1d : 0xef4444,
      );
      if (isBoss) {
        foe.setData('boss', true);
        this.registry.set('bossPresent', true);
        this.add.text(x, y - 36, 'BOSS', {
          fontSize: '12px', color: '#fecaca',
          wordWrap: { width: 80, useAdvancedWrap: true },
        }).setOrigin(0.5);
      }
      this.physics.add.existing(foe, true);
      this.physics.add.overlap(this.player, foe, () => {
        PlatformSceneHelper.shake(this);
        PlatformSceneHelper.playSfx(this, 'sfx_lose');
        this.registry.set('won', false);
        this.scene.start('GameOverScene');
      });
    };
    if (worldLayout.enemies.length) {
      for (const fp of worldLayout.enemies.slice(0, 3)) {
        const isBoss = Boolean(fp.tags?.includes('boss'));
        spawnFoe(fp.x, fp.y, isBoss ? 1.5 : 1, isBoss);
      }
    } else {
      spawnFoe(480, 320, 1, false);
      const wantBoss = Boolean(this.registry.get('bossPresent'));
      if (wantBoss) spawnFoe(720, 280, 1.5, true);
    }

    const cast = (bible?.npcs?.length ? bible.npcs : [
      { id: 'Guide', role: 'quest_giver', notes: 'Bring me the relic in the east.' },
      { id: 'Smith', role: 'merchant', notes: 'Scrap iron forges fate.' },
      { id: 'Traveler', role: 'flavor', notes: 'The road remembers choices.' },
    ]).slice(0, 6);

    const graph = this.cache.json.get('og_content_graph') as
      | {
          nodes?: Array<{
            kind?: string;
            title?: string;
            meta?: {
              giverNpcId?: string;
              layout?: {
                item?: { x?: number; y?: number };
                exit?: { x?: number; y?: number };
              };
            };
          }>;
        }
      | undefined;
    const quests = Array.isArray((bible as { quests?: unknown[] } | null)?.quests)
      ? ((bible as { quests: Array<{ id?: string; title?: string; giverNpcId?: string }> }).quests)
      : [];
    const mainQuest = quests[0];
    const graphQuest = graph?.nodes?.find((n) => n.kind === 'quest');
    const questTitle =
      (mainQuest?.title && String(mainQuest.title)) ||
      (graphQuest?.title && String(graphQuest.title)) ||
      'Fetch the relic';
    const questItemId = (mainQuest?.id && String(mainQuest.id)) || 'relic';
    const preferredGiver =
      (mainQuest?.giverNpcId && String(mainQuest.giverNpcId)) ||
      (graphQuest?.meta?.giverNpcId && String(graphQuest.meta.giverNpcId)) ||
      '';
    const graphLayout = graphQuest?.meta?.layout;

    // Prefer Boot/game.json textures; optional late-load for bible cast
    for (const npc of cast) {
      const key = npcAssetKey(npc.id);
      if (!this.textures.exists(key)) {
        this.load.image(key, './assets/' + key + '.png');
      }
    }
    if (this.load.list.size > 0) {
      await new Promise<void>((resolve) => {
        this.load.once('complete', () => resolve());
        this.load.once('loaderror', () => resolve());
        this.load.start();
      });
    }

    const tints = [0x93c5fd, 0xfbbf24, 0xc4b5fd, 0x86efac];
    const fallbackNpcPos = [
      { x: 160, y: 160 },
      { x: 280, y: 220 },
      { x: 200, y: 360 },
      { x: 520, y: 180 },
    ];

    const npcs: Array<{
      body: Phaser.GameObjects.GameObject & { x: number; y: number };
      name: string;
      line: string;
      role: string;
    }> = [];

    cast.forEach((npc, i) => {
      const fromSeed =
        worldLayout.npcs.find(
          (p) => p.id && p.id.toLowerCase() === npc.id.toLowerCase(),
        ) ?? worldLayout.npcs[i];
      const pos = fromSeed ?? fallbackNpcPos[i] ?? { x: 160 + i * 80, y: 160 };
      const key = npcAssetKey(npc.id);
      const tex =
        this.textures.exists(key) ? key : this.textures.exists('player') ? 'player' : 'og_player';
      const body = PlatformSceneHelper.spriteOrRect(
        this, pos.x, pos.y, tex, 40, 48, tints[i % tints.length]!,
      );
      if (body instanceof Phaser.GameObjects.Image && !this.textures.exists(key)) {
        body.setTint(tints[i % tints.length]!);
      }
      this.physics.add.existing(body, true);
      body.setDepth(10 + Math.floor(pos.y));
      this.add
        .ellipse(pos.x, pos.y + 18, 28, 10, 0x000000, 0.35)
        .setDepth(9 + Math.floor(pos.y));
      this.add
        .text(pos.x, pos.y - 40, npc.id, {
          fontSize: '12px',
          color: '#e0f2fe',
          wordWrap: { width: 100, useAdvancedWrap: true },
        })
        .setOrigin(0.5);
      const note =
        typeof (npc as { notes?: string }).notes === 'string'
          ? (npc as { notes?: string }).notes
          : '';
      const contentLines = this.dialogueBySpeaker.get(npc.id.toLowerCase());
      const contentLine = contentLines?.[0]
        ? \`\${npc.id}: \${contentLines[0]}\`
        : '';
      const isPreferredGiver =
        preferredGiver &&
        npc.id.toLowerCase() === preferredGiver.toLowerCase();
      npcs.push({
        body,
        name: npc.id,
        line: isPreferredGiver
          ? \`\${npc.id}: \${questTitle}\`
          : contentLine ||
            (note
              ? \`\${npc.id}: \${note}\`
              : \`\${npc.id}: Hello, traveler.\`),
        role: npc.role ?? 'flavor',
      });
    });
    this.registry.set(
      '__ogNpcPos',
      npcs.map((n) => ({ id: n.name, x: n.body.x, y: n.body.y })),
    );

    const itemFromLayout =
      worldLayout.items.find(
        (p) => p.id && p.id.toLowerCase() === questItemId.toLowerCase(),
      ) ?? worldLayout.items[0];
    const itemPos = {
      x:
        itemFromLayout?.x ??
        (typeof graphLayout?.item?.x === 'number' ? graphLayout.item.x : 700),
      y:
        itemFromLayout?.y ??
        (typeof graphLayout?.item?.y === 'number' ? graphLayout.item.y : 200),
    };

    const item = PlatformSceneHelper.spriteOrRect(
      this, itemPos.x, itemPos.y, 'item', 28, 28, 0x38bdf8,
    );
    this.physics.add.existing(item, true);
    item.setVisible(false);
    this.add
      .text(itemPos.x, itemPos.y - 22, questItemId.slice(0, 14), {
        fontSize: '11px',
        color: '#7dd3fc',
        wordWrap: { width: 120, useAdvancedWrap: true },
      })
      .setOrigin(0.5)
      .setDepth(5);

    // Travel portals: Phaser scene.start OR in-World region restart
    type PortalHop =
      | { kind: 'phaser'; id: string }
      | { kind: 'region'; id: string }
      | null;
    const resolvePortalHop = (p: {
      id?: string;
      targetSceneId?: string;
    }): PortalHop => {
      const raw =
        (p.targetSceneId && String(p.targetSceneId)) ||
        (p.id && seedExitByPortal.get(p.id)?.toSceneId) ||
        null;
      if (!raw) return null;
      // Prefer world-region layout hop so we never leave WorldScene for a DSL stub.
      if (layoutsBySceneId[raw] && !isEngineShellId(raw)) {
        return { kind: 'region', id: raw };
      }
      if (this.scene.get(raw)) return { kind: 'phaser', id: raw };
      return null;
    };

    let travelCount = 0;
    for (const p of worldLayout.portals) {
      const hop = resolvePortalHop(p);
      if (!hop) continue;
      travelCount += 1;
      const pad = PlatformSceneHelper.spriteOrRect(
        this, p.x, p.y, 'item', 44, 44, 0x67e8f9,
      );
      if (pad instanceof Phaser.GameObjects.Image) pad.setTint(0x67e8f9);
      this.physics.add.existing(pad, true);
      const label =
        (p.id && seedExitByPortal.get(p.id)?.label) ||
        hop.id.replace(/Scene$/i, '') ||
        'GO';
      this.add
        .text(p.x, p.y - 26, String(label).slice(0, 16), {
          fontSize: '11px',
          color: '#a5f3fc',
          wordWrap: { width: 100, useAdvancedWrap: true },
        })
        .setOrigin(0.5)
        .setDepth(5);
      this.physics.add.overlap(this.player, pad, () => {
        this.registry.set(
          'progress',
          Math.max(1, Number(this.registry.get('progress') ?? 0)),
        );
        PlatformSceneHelper.burst(this, p.x, p.y, 0x67e8f9, 10);
        PlatformSceneHelper.playSfx(this, 'sfx_coin', 0.35);
        if (hop.kind === 'phaser') {
          this.scene.start(hop.id);
          return;
        }
        this.registry.set('worldRegionId', hop.id);
        this.scene.restart();
      });
    }

    // Story hub portals when seed has no travel pads but Chapter/Battle exist
    if (travelCount === 0) {
      const hubs: Array<{ x: number; y: number; target: string; label: string }> = [];
      if (this.scene.get('ChapterScene')) {
        hubs.push({ x: 80, y: 270, target: 'ChapterScene', label: 'STORY' });
      }
      if (this.scene.get('BattleScene')) {
        hubs.push({ x: 880, y: 270, target: 'BattleScene', label: 'BATTLE' });
      }
      for (const h of hubs) {
        const pad = PlatformSceneHelper.spriteOrRect(
          this, h.x, h.y, 'item', 40, 40, 0x5eead4,
        );
        this.physics.add.existing(pad, true);
        this.add
          .text(h.x, h.y - 24, h.label, {
            fontSize: '11px',
            color: '#99f6e4',
            wordWrap: { width: 80, useAdvancedWrap: true },
          })
          .setOrigin(0.5)
          .setDepth(5);
        this.physics.add.overlap(this.player, pad, () => {
          this.registry.set(
            'progress',
            Math.max(1, Number(this.registry.get('progress') ?? 0)),
          );
          PlatformSceneHelper.burst(this, h.x, h.y, 0x5eead4, 8);
          this.scene.start(h.target);
        });
      }
    }

    // Quest win exit: first portal without a travel hop, else graph/default
    const questPortal =
      worldLayout.portals.find((p) => !resolvePortalHop(p)) ?? null;
    const exitPos = {
      x:
        questPortal?.x ??
        (typeof graphLayout?.exit?.x === 'number' ? graphLayout.exit.x : 900),
      y:
        questPortal?.y ??
        (typeof graphLayout?.exit?.y === 'number' ? graphLayout.exit.y : 500),
    };
    const exit = PlatformSceneHelper.spriteOrRect(
      this, exitPos.x, exitPos.y, 'item', 48, 48, 0xa78bfa,
    );
    if (exit instanceof Phaser.GameObjects.Image) exit.setTint(0xa78bfa);
    this.physics.add.existing(exit, true);
    this.add
      .text(exitPos.x, exitPos.y - 28, 'EXIT', {
        fontSize: '11px',
        color: '#ddd6fe',
        wordWrap: { width: 80, useAdvancedWrap: true },
      })
      .setOrigin(0.5)
      .setDepth(5);

    let questStarted = false;
    const giver =
      (preferredGiver
        ? npcs.find(
            (n) => n.name.toLowerCase() === preferredGiver.toLowerCase(),
          )
        : undefined) ??
      npcs.find((n) => n.role === 'quest_giver') ??
      npcs[0];
    this.tip.setText(questTitle + ' · talk ' + (giver?.name ?? 'NPC') + ' (E)');

    this.physics.add.overlap(this.player, item, () => {
      if (!questStarted || this.bag.count(questItemId) > 0 || !item.visible) return;
      this.bag.add(questItemId, 1);
      this.registry.set('inventory', questItemId);
      this.registry.set('progress', 1);
      const leveled = gainXp(this.stats, 15);
      this.saves.write('slot0', {
        stats: this.stats,
        inventory: questItemId,
        gear: { weapon: this.gear.weapon },
      });
      PlatformSceneHelper.burst(this, item.x, item.y, 0x38bdf8, 10);
      PlatformSceneHelper.playSfx(this, 'sfx_coin');
      item.setVisible(false);
      this.tip.setText(
        'Got: ' +
          questItemId +
          (leveled.leveled ? ' · LEVEL UP!' : '') +
          ' · return to ' +
          (giver?.name ?? 'Guide') +
          ' (E)',
      );
    });
    this.physics.add.overlap(this.player, exit, () => {
      if (this.bag.count(questItemId) <= 0) return;
      gainXp(this.stats, 40);
      this.saves.write('slot0', { stats: this.stats, won: true });
      PlatformSceneHelper.burst(this, exit.x, exit.y, 0xa78bfa, 12);
      PlatformSceneHelper.playSfx(this, 'sfx_win');
      this.registry.set('ending_a', true);
      this.registry.set('won', true);
      this.scene.start('GameOverScene');
    });

    this.input.keyboard?.on('keydown-E', () => {
      const near = npcs.find((n) => {
        const dx = Math.abs(this.player.x - n.body.x);
        const dy = Math.abs(this.player.y - n.body.y);
        return dx + dy <= 90;
      });
      if (!near) return;
      const more = this.dialogueBySpeaker.get(near.name.toLowerCase());
      this.tip.setText(
        more && more.length > 1
          ? \`\${near.name}: \${more[Math.min(more.length - 1, questStarted ? 1 : 0)]}\`
          : near.line,
      );
      this.registry.set(\`talked_\${near.name.toLowerCase()}\`, true);
      const isGiver = giver && near.name === giver.name;
      if (/smith|craft/i.test(near.name + ' ' + near.role) && this.recipes[0]) {
        if (craft(this.recipes[0], this.bag)) {
          this.tip.setText('Crafted ' + this.recipes[0].output.itemId);
          if (this.juice.particles) PlatformSceneHelper.burst(this, near.body.x, near.body.y, 0xfbbf24, 8);
          return;
        }
      }
      if (near.role === 'merchant' && this.shop) {
        const goods = this.shop.catalog[0];
        if (goods && this.shop.buy(goods.id, this.bag, 1)) {
          this.tip.setText('Bought ' + goods.id + ' · gold ' + this.shop.gold);
          if (this.juice.sfxOnHit) PlatformSceneHelper.playSfx(this, 'sfx_coin', 0.35);
          this.fame.adjust('town', 2);
          this.saves.write('slot0', {
            stats: this.stats,
            gold: this.shop.gold,
            reputation: this.fame.toJSON(),
          });
          return;
        }
        this.tip.setText(near.name + ': Not enough gold.');
        return;
      }
      if (isGiver && !questStarted) {
        questStarted = true;
        item.setVisible(true);
        const first =
          this.quests?.nodes.find((n) => n.status === 'available') ??
          this.quests?.nodes[0];
        if (first) this.quests?.start(first.id);
        this.tip.setText(
          (first?.title ?? questTitle) + ' · pick up the quest item',
        );
        PlatformSceneHelper.playSfx(this, 'sfx_coin', 0.3);
        return;
      }
      // Flavor NPC branch → ending_b path (distinct from giver ending_a)
      if (!isGiver && near.role === 'flavor' && this.bag.count(questItemId) > 0) {
        gainXp(this.stats, 25);
        this.saves.write('slot0', { stats: this.stats, ending: 'b' });
        PlatformSceneHelper.burst(this, near.body.x, near.body.y, 0xc4b5fd, 10);
        PlatformSceneHelper.playSfx(this, 'sfx_win');
        this.registry.set('ending_b', true);
        this.registry.set('won', true);
        this.scene.start('GameOverScene');
        return;
      }
      if (isGiver && this.bag.count(questItemId) > 0) {
        const active = this.quests?.nodes.find((n) => n.status === 'active');
        if (active) this.quests?.complete(active.id);
        gainXp(this.stats, 50);
        this.fame.adjust('town', 12);
        this.saves.write('slot0', {
          stats: this.stats,
          ending: 'a',
          reputation: this.fame.toJSON(),
        });
        PlatformSceneHelper.burst(this, near.body.x, near.body.y, 0x86efac, 12);
        PlatformSceneHelper.playSfx(this, 'sfx_win');
        this.registry.set('ending_a', true);
        this.registry.set('won', true);
        this.scene.start('GameOverScene');
      }
    });

    GameUiKit.addHudLabel(
      this,
      16,
      520,
      'Arrows/WASD · E talk · portals hop · quest EXIT · ESC',
    );
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = this.input.keyboard!.addKeys('W,A,S,D') as typeof this.wasd;
  }

  private applyJiaxiDrama(): void {
    while (Number(this.registry.get('jiaxiSystemsLucky') ?? 0) > 0) {
      this.registry.set(
        'jiaxiSystemsLucky',
        Number(this.registry.get('jiaxiSystemsLucky')) - 1,
      );
      if (this.shop) this.shop.gold += 24;
      this.bag.add('lucky', 1);
      this.tip.setText('好运抛竿 · 袋里多了一件');
    }
    if (this.registry.get('jiaxiNpcBetray')) {
      this.fame.adjust('town', -6);
      this.tip.setText((this.tip.text || '') + ' · 有人反水了');
    }
    const spice = (this.registry.get('jiaxiLoopSpice') as string[] | undefined) ?? [];
    if (spice.length) {
      this.tip.setText('加码 ' + spice[spice.length - 1]);
    }
  }

  update(): void {
    const b = this.player.body as Phaser.Physics.Arcade.Body;
    const speed = this.worldHelper.playerSpeed;
    b.setVelocity(0, 0);
    const left = this.cursors.left?.isDown || this.wasd.A?.isDown;
    const right = this.cursors.right?.isDown || this.wasd.D?.isDown;
    const up = this.cursors.up?.isDown || this.wasd.W?.isDown;
    const down = this.cursors.down?.isDown || this.wasd.S?.isDown;
    if (left) b.setVelocityX(-speed);
    if (right) b.setVelocityX(speed);
    if (up) b.setVelocityY(-speed);
    if (down) b.setVelocityY(speed);
    this.player.setDepth(10 + Math.floor(this.player.y));
    if (this.hasWalk && this.player instanceof Phaser.GameObjects.Image) {
      if (left) this.player.play('walk_left', true);
      else if (right) this.player.play('walk_right', true);
      else if (up) this.player.play('walk_up', true);
      else if (down) this.player.play('walk_down', true);
      else this.player.anims?.stop();
    } else {
      PlatformSceneHelper.applyPlayerPose(this, this.player, { vx: b.velocity.x });
    }
  }
}
`;
  }

// Tower defense — WaveManager + EconomyManager place-tower kernel
  if (
    role === 'td' ||
    archetype === 'tower_defense' ||
    /tdscene|defense/i.test(lower)
  ) {
    return `import Phaser from 'phaser';
import { PlatformSceneHelper } from '@opengame/module-platform';
import { WaveManager, EconomyManager } from '@opengame/module-td';

/** Playable kernel — place towers (gold), survive 3 waves, leak → lose. */
export class ${stub.className} extends Phaser.Scene {
  private hp = 5;
  private kills = 0;
  private waveIndex = 0;
  private hud!: Phaser.GameObjects.Text;
  private economy = new EconomyManager(60);
  private waves!: WaveManager;
  private towers: Array<Phaser.GameObjects.Rectangle | Phaser.GameObjects.Image> = [];
  private enemies: Array<{ body: Phaser.GameObjects.GameObject & { x: number; y: number; active: boolean; destroy: () => void }; hp: number }> = [];
  private spawnLeft = 0;
  private towerCost = 20;

  constructor() {
    super('${key}');
  }

  preload(): void {
    PlatformSceneHelper.preloadGameAudio(this);
    PlatformSceneHelper.preloadGameArt(this);
  }

  create(): void {
    if (!PlatformSceneHelper.addParallaxBackground(this, 'og_bg')) {
      this.cameras.main.setBackgroundColor('#111827');
    }
    PlatformSceneHelper.installPauseMenu(this);
    this.hud = GameUiKit.addHudLabel(this, 16, 12, '');
    GameUiKit.addHudLabel(
      this,
      16,
      500,
      'Click to place tower (20g) · ESC pause · Towers auto-shoot.',
    );

    const wantBoss = Boolean(this.registry.get('bossPresent'));
    const tier = Math.max(1, Number(this.registry.get('difficultyTier') ?? 1));
    const baseCount = Math.max(4, Number(this.registry.get('enemyCount') ?? 4));
    const waves = [
      { id: 'w1', enemyCount: baseCount, spawnIntervalMs: Math.max(400, 900 - tier * 50) },
      { id: 'w2', enemyCount: baseCount + 2, spawnIntervalMs: Math.max(350, 750 - tier * 40) },
      { id: 'w3', enemyCount: baseCount + 4 + (wantBoss ? 2 : 0), spawnIntervalMs: Math.max(300, 600 - tier * 30) },
    ];
    if (wantBoss) this.registry.set('bossPresent', true);

    this.waves = new WaveManager({
      waves,
      onWaveStart: (wave, index) => {
        this.waveIndex = index + 1;
        this.spawnLeft = wave.enemyCount;
        this.refreshHud();
        let bossOnce = wantBoss && index === 2;
        this.time.addEvent({
          delay: wave.spawnIntervalMs ?? 800,
          repeat: wave.enemyCount - 1,
          callback: () => {
            const asBoss = bossOnce;
            bossOnce = false;
            this.spawnEnemy(asBoss);
          },
        });
      },
      onAllWavesComplete: () => {
        this.time.delayedCall(800, () => {
          if (this.hp > 0 && this.enemies.length === 0 && this.spawnLeft <= 0) {
            PlatformSceneHelper.burst(this, 480, 270, 0x86efac, 16);
            PlatformSceneHelper.playSfx(this, 'sfx_win');
            this.registry.set('won', true);
            this.scene.start('VictoryScene');
          }
        });
      },
    });

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.y < 40) return;
      if (!this.economy.spend(this.towerCost)) {
        this.hud.setText(this.hud.text + ' · not enough gold');
        return;
      }
      const t = PlatformSceneHelper.spriteOrRect(
        this, p.x, p.y, 'item', 32, 32, 0x38bdf8,
      );
      if (t instanceof Phaser.GameObjects.Image) t.setTint(0x38bdf8);
      t.setData('tower', true);
      this.towers.push(t);
      PlatformSceneHelper.burst(this, p.x, p.y, 0x38bdf8, 6);
      PlatformSceneHelper.playSfx(this, 'sfx_coin', 0.35);
      this.registry.set('progress', this.towers.length);
      this.registry.set('hp', this.hp);
      this.registry.set('kills', this.kills);
      this.refreshHud();
    });

    this.time.addEvent({ delay: 400, loop: true, callback: () => this.towersShoot() });
    this.waves.start();
    this.applyJiaxiWaves();
    this.game.events.on('opengame:jiaxi', () => this.applyJiaxiWaves());
    this.refreshHud();
  }

  private applyJiaxiWaves(): void {
    while (Number(this.registry.get('jiaxiTdEarlyWave') ?? 0) > 0) {
      this.registry.set(
        'jiaxiTdEarlyWave',
        Number(this.registry.get('jiaxiTdEarlyWave')) - 1,
      );
      this.waves.nextWave();
    }
    this.refreshHud();
  }

  private spawnEnemy(asBoss = false): void {
    this.spawnLeft = Math.max(0, this.spawnLeft - 1);
    const size = asBoss ? 48 : 28;
    const body = PlatformSceneHelper.spriteOrRect(
      this, 40, 120 + Math.random() * 320, 'enemy', size, size,
      asBoss ? 0x7f1d1d : 0xf87171,
    );
    if (asBoss) {
      body.setData('boss', true);
      this.registry.set('bossPresent', true);
    }
    const ent = { body, hp: asBoss ? 8 : 2 };
    this.enemies.push(ent);
    this.tweens.add({
      targets: body,
      x: 980,
      duration: Math.max(2800, (asBoss ? 7000 : 5500) - this.waveIndex * 400),
      onComplete: () => {
        if (!body.active) return;
        body.destroy();
        this.enemies = this.enemies.filter((e) => e !== ent);
        this.hp -= asBoss ? 2 : 1;
        this.refreshHud();
        if (this.hp <= 0) {
          PlatformSceneHelper.shake(this, 200, 0.012);
          PlatformSceneHelper.playSfx(this, 'sfx_lose');
          this.registry.set('won', false);
          this.scene.start('VictoryScene');
        } else if (
          this.waveIndex >= 3 &&
          this.spawnLeft <= 0 &&
          this.enemies.length === 0
        ) {
          PlatformSceneHelper.playSfx(this, 'sfx_win');
          this.registry.set('won', true);
          this.scene.start('VictoryScene');
        }
      },
    });
    this.refreshHud();
  }

  private towersShoot(): void {
    for (const t of this.towers) {
      if (!t.active) continue;
      const target = this.enemies.find((e) => e.body.active);
      if (!target) continue;
      target.hp -= 1;
      if (target.hp <= 0) {
        PlatformSceneHelper.burst(this, target.body.x, target.body.y, 0xf87171, 8);
        PlatformSceneHelper.playSfx(this, 'sfx_coin', 0.3);
        target.body.destroy();
        this.enemies = this.enemies.filter((e) => e !== target);
        this.kills += 1;
        this.economy.earn(5);
        this.refreshHud();
        if (
          this.waveIndex >= 3 &&
          this.spawnLeft <= 0 &&
          this.enemies.length === 0
        ) {
          PlatformSceneHelper.playSfx(this, 'sfx_win');
          this.registry.set('won', true);
          this.scene.start('VictoryScene');
        } else if (this.spawnLeft <= 0 && this.enemies.length === 0) {
          this.waves.nextWave();
        }
      }
      break;
    }
  }

  private refreshHud(): void {
    this.registry.set('hp', this.hp);
    this.registry.set('kills', this.kills);
    this.registry.set('progress', this.towers.length);
    this.hud.setText(
      \`HP \${this.hp} · wave \${this.waveIndex}/3 · gold \${this.economy.getGold()} · kills \${this.kills} · place towers\`,
    );
  }
}
`;
  }

    // Dialogue / chapter — multi-chapter STORY_BIBLE + GameUiKit
  if (role === 'chapter' || /chapter|dialog|story|vn/i.test(lower)) {
    return `import Phaser from 'phaser';
import { GameUiKit } from '@opengame/module-platform';
import { DialogueManager, ChoicePanel } from '@opengame/module-dialogue';
import {
  chapterCount,
  chapterFile,
  chapterJsonKey,
  npcAssetKey,
  readBibleFromCache,
} from '../content/ContentDirector';

/** Playable kernel — loads story/chapter_XX.json from STORY_BIBLE index. */
export class ${stub.className} extends Phaser.Scene {
  private dialogue!: DialogueManager;
  private ui!: ReturnType<typeof GameUiKit.addDialoguePanel>;
  private choices!: ChoicePanel;
  private readonly W = 960;
  private readonly H = 540;
  private chapterIndex = 0;

  constructor() {
    super('${key}');
  }

  preload(): void {
    this.load.image('og_bg', './assets/background.png');
    this.load.image('og_player', './assets/player.png');
    this.load.image('bg_chapter_02', './assets/bg_chapter_02.png');
    this.load.image('bg_chapter_03', './assets/bg_chapter_03.png');
    this.load.image('bg_chapter_04', './assets/bg_chapter_04.png');
    this.load.json('og_story_bible', './STORY_BIBLE.json');
    this.load.json('og_content_graph', './CONTENT_GRAPH.json');
    this.load.json(chapterJsonKey(0), chapterFile(0));
    this.load.on('loaderror', () => {
      /* optional npc / chapter assets */
    });
  }

  async create(): Promise<void> {
    this.chapterIndex = Math.max(0, Number(this.registry.get('chapterIndex') ?? 0));
    const bible = readBibleFromCache(this.cache);
    const total = chapterCount(bible);
    // Late-load NPC portraits from bible cast
    for (const npc of bible?.npcs ?? []) {
      const key = npcAssetKey(npc.id);
      if (!this.textures.exists(key)) {
        this.load.image(key, './assets/' + key + '.png');
      }
    }
    if (this.chapterIndex > 0) {
      const key = chapterJsonKey(this.chapterIndex);
      if (!this.cache.json.exists(key)) {
        this.load.json(key, chapterFile(this.chapterIndex));
      }
    }
    const chBgKey =
      'bg_chapter_' + String(this.chapterIndex + 1).padStart(2, '0');
    if (this.chapterIndex > 0 && !this.textures.exists(chBgKey)) {
      this.load.image(chBgKey, './assets/' + chBgKey + '.png');
    }
    if (this.load.list.size > 0) {
      await new Promise<void>((resolve) => {
        this.load.once('complete', () => resolve());
        this.load.once('loaderror', () => resolve());
        this.load.start();
      });
    }
    const chMeta = bible?.chapters?.[this.chapterIndex];
    const chTitle = chMeta?.title ?? \`Chapter \${this.chapterIndex + 1}\`;

    this.cameras.main.setBackgroundColor('#0b1020');
    const bgKey =
      this.textures.exists(chBgKey)
        ? chBgKey
        : this.chapterIndex >= 1 && this.textures.exists('bg_chapter_02')
          ? 'bg_chapter_02'
          : 'og_bg';
    if (this.textures.exists(bgKey)) {
      this.add
        .image(this.W / 2, this.H / 2, bgKey)
        .setDisplaySize(this.W, this.H)
        .setDepth(-10)
        .setAlpha(0.45);
    }

    try {
      const { ChapterCinematicPresenter } = await import(
        '../presentation/ChapterCinematicPresenter'
      );
      await ChapterCinematicPresenter.playOpener(this, this.chapterIndex);
    } catch {
      /* optional */
    }

    const portraitNpc = chMeta?.npcs?.[0] ?? bible?.npcs?.[0]?.id;
    const portraitKey = portraitNpc
      ? npcAssetKey(portraitNpc)
      : 'og_player';
    const resolvedPortrait = this.textures.exists(portraitKey)
      ? portraitKey
      : 'og_player';

    this.ui = GameUiKit.addDialoguePanel(this, {
      width: this.W,
      height: this.H,
      portraitKey: resolvedPortrait,
    });
    GameUiKit.addTitleStrip(this, chTitle, { y: 40, width: this.W });

    const leaveChapter = () => {
      this.choices?.hide();
      const endingA = Boolean(this.registry.get('ending_a'));
      const endingB = Boolean(this.registry.get('ending_b'));
      this.registry.set('won', endingA || endingB);
      if (
        Boolean(this.registry.get('chapterOpenerOnly')) &&
        this.scene.get('WorldScene') &&
        !endingA &&
        !endingB
      ) {
        this.registry.set('chapterOpenerOnly', false);
        this.registry.set(
          'progress',
          Math.max(1, Number(this.registry.get('progress') ?? 0)),
        );
        this.scene.start('WorldScene');
        return;
      }
      const nextIdx = this.chapterIndex + 1;
      const totalCh = total;
      if (nextIdx < totalCh && !endingA && !endingB) {
        this.registry.set('chapterIndex', nextIdx);
        this.scene.restart();
        return;
      }
      if (endingA || endingB) {
        this.scene.start(this.scene.get('EndingScene') ? 'EndingScene' : 'GameOverScene');
        return;
      }
      if (this.scene.get('WorldScene')) {
        this.scene.start('WorldScene');
        return;
      }
      if (this.scene.get('BattleScene')) {
        this.scene.start('BattleScene');
      }
    };

    // Skip opener / chapter beat (S) — chrome button stops scene pointer steal
    GameUiKit.addChromeButton(this, 'Skip · S', {
      x: this.W - 78,
      y: 40,
      onClick: () => leaveChapter(),
    });
    this.input.keyboard?.on('keydown-S', () => leaveChapter());

    this.add
      .text(this.W / 2, this.H - 18, '空格 / 点击 推进  ·  选择  ·  S 跳过', {
        fontSize: '12px',
        fontFamily: 'system-ui, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
        color: '#64748b',
        wordWrap: { width: this.W - 64, useAdvancedWrap: true },
        padding: { x: 4, y: 2 },
      })
      .setOrigin(0.5)
      .setDepth(103)
      .setScrollFactor(0);

    this.choices = new ChoicePanel(this, this.W / 2, 120, {
      buttonWidth: 440,
      buttonHeight: 44,
      spacing: 8,
      wordWrap: true,
      modalBackdrop: true,
    });
    this.choices.on('selected', (index: number) => {
      this.dialogue.selectChoice(index);
    });

    this.dialogue = new DialogueManager(this);
    const cacheKey = chapterJsonKey(this.chapterIndex);
    let cached = this.cache.json.get(cacheKey) as
      | { entries?: unknown[] }
      | undefined;
    if (!cached?.entries?.length) {
      cached = this.cache.json.get('og_story_chapter_01') as
        | { entries?: unknown[] }
        | undefined;
    }
    if (!cached?.entries || !Array.isArray(cached.entries) || !cached.entries.length) {
      this.ui.setLine('', '缺少剧情文件 public/story/chapter_XX.json');
      this.time.delayedCall(1200, () => this.scene.start('BattleScene'));
      return;
    }
    this.dialogue.loadFromStoryJson(cached as { entries: never[] });
    this.dialogue.on('showChoice', (_id: string, prompt: string, options: Array<{ label: string }>) => {
      // Dim bottom dialogue panel so 3+ wrapped choices never collide with it
      GameUiKit.dimDialogueForChoices(this.ui);
      this.choices.y = ChoicePanel.stackY(this.H, options.length);
      this.choices.showChoices(
        prompt || '请选择：',
        options.map((o) => ({ text: o.label })),
      );
    });
    this.dialogue.on('showText', (speaker: string, line: string) => {
      this.choices.hide();
      GameUiKit.restoreDialoguePanel(this.ui);
      this.ui.setLine(speaker || '', line);
      if (speaker) {
        const pk = npcAssetKey(speaker);
        if (this.textures.exists(pk) && this.ui.portrait) {
          this.ui.portrait.setTexture(pk);
        }
      }
    });
    this.dialogue.on('dialogueComplete', () => {
      leaveChapter();
    });
    this.dialogue.on('triggerEvent', (action: string, data?: { flag?: string; value?: boolean }) => {
      if (action === 'set_flag' && data?.flag) {
        this.registry.set(data.flag, data.value ?? true);
      }
    });
    this.dialogue.start();

    const next = () => this.dialogue.advance();
    this.input.keyboard?.on('keydown-SPACE', next);
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.choices.visible) return;
      if ((this.input.hitTestPointer(pointer)?.length ?? 0) > 0) return;
      next();
    });
  }
}
`;
  }

// Battle — TurnManager player/enemy phases
  if (role === 'battle' || /battle|combat|fight/i.test(lower)) {
    return `import Phaser from 'phaser';
import { PlatformSceneHelper } from '@opengame/module-platform';
import {
  TurnCombat,
  type Combatant,
  EquipmentLoadout,
  SaveStore,
  createActorStats,
  gainXp,
  type EquipmentDef,
} from '@opengame/module-systems';

/** Playable kernel — ATB TurnCombat; SPACE when gauge ready. */
export class ${stub.className} extends Phaser.Scene {
  private combat!: TurnCombat;
  private hud!: Phaser.GameObjects.Text;
  private ended = false;
  private hero!: Combatant;
  private foe!: Combatant;
  private saves = new SaveStore();
  private gear = new EquipmentLoadout();

  constructor() {
    super('${key}');
  }

  preload(): void {
    PlatformSceneHelper.preloadGameAudio(this);
    PlatformSceneHelper.preloadGameArt(this);
    this.load.json('og_systems', './SYSTEMS.json');
    this.load.on('loaderror', () => {});
  }

  create(): void {
    if (!PlatformSceneHelper.addParallaxBackground(this, 'og_bg')) {
      this.cameras.main.setBackgroundColor('#3f1d1d');
    }
    const systems = this.cache.json.get('og_systems') as
      | {
          growth?: { baseHp?: number; baseAtk?: number };
          skills?: Array<{ id: string; name: string; power: number }>;
          equipment?: EquipmentDef[];
          juiceBudget?: { cameraShake?: boolean; particles?: boolean; hitStopMs?: number; sfxOnHit?: boolean };
        }
      | undefined;
    const juice = {
      cameraShake: systems?.juiceBudget?.cameraShake !== false,
      particles: systems?.juiceBudget?.particles !== false,
      hitStopMs: systems?.juiceBudget?.hitStopMs ?? 40,
      sfxOnHit: systems?.juiceBudget?.sfxOnHit !== false,
    };
    const wantBoss = Boolean(this.registry.get('bossPresent'));
    const tier = Math.max(1, Number(this.registry.get('difficultyTier') ?? 1));
    const baseHp = systems?.growth?.baseHp ?? 12;
    const baseAtk = systems?.growth?.baseAtk ?? 3;
    const equipDefs = systems?.equipment ?? [];
    const weapon = equipDefs.find((e) => e.slot === 'weapon');
    if (weapon) this.gear.weapon = weapon.id;
    const bonus = this.gear.bonuses(equipDefs);
    const growth = createActorStats(baseHp, baseAtk);
    const saved = this.saves.read('slot0');
    if (saved?.payload?.stats) {
      const s = saved.payload.stats as { level?: number; hp?: number; maxHp?: number; atk?: number };
      if (typeof s.level === 'number') growth.level = s.level;
      if (typeof s.maxHp === 'number') growth.maxHp = s.maxHp;
      if (typeof s.hp === 'number') growth.hp = s.hp;
      if (typeof s.atk === 'number') growth.atk = s.atk;
    }
    this.hero = {
      id: 'player', name: 'Hero',
      hp: Math.max(3, growth.hp + bonus.hp - Math.floor(tier / 2)),
      maxHp: growth.maxHp + bonus.hp,
      atk: growth.atk + bonus.atk, gauge: 40, speed: 12, statuses: [],
    };
    this.foe = {
      id: 'enemy', name: wantBoss ? 'Boss' : 'Foe',
      hp: wantBoss ? 10 + tier : Math.max(4, 2 + tier * 2),
      maxHp: wantBoss ? 10 + tier : Math.max(4, 2 + tier * 2),
      atk: wantBoss ? 2 : 1, gauge: 20, speed: wantBoss ? 8 : 10, statuses: [],
    };
    const skills = (systems?.skills ?? [{ id: 'slash', name: 'Slash', power: 1 }]).map(
      (s) => ({ id: s.id, name: s.name, power: s.power }),
    );
    this.combat = new TurnCombat([this.hero], [this.foe], skills);

    PlatformSceneHelper.spriteOrRect(this, 300, 300, 'player', 56, 72, 0xfbbf24)
      .setData('player', true);
    const foeSpr = PlatformSceneHelper.spriteOrRect(
      this, 660, 300, 'enemy',
      wantBoss ? 88 : 64, wantBoss ? 96 : 72,
      wantBoss ? 0x7f1d1d : 0xef4444,
    );
    if (wantBoss) {
      foeSpr.setData('boss', true);
      this.registry.set('bossPresent', true);
      this.add.text(660, 240, 'BOSS', {
        fontSize: '14px', color: '#fecaca',
        wordWrap: { width: 80, useAdvancedWrap: true },
      }).setOrigin(0.5);
    }
    GameUiKit.addTitleStrip(this, wantBoss ? 'Boss Battle' : 'Battle', { y: 48, width: 960 });
    this.hud = GameUiKit.addHudLabel(this, 280, 100, '');
    this.refresh('ATB — SPACE when ready');

    this.input.keyboard?.on('keydown-SPACE', () => {
      if (this.ended) return;
      const ready = this.combat.tickGauges();
      if (!ready) {
        for (const c of [...this.combat.allies, ...this.combat.enemies]) {
          if (c.hp > 0) c.gauge = Math.min(100, c.gauge + 25);
        }
        this.refresh('Charging…');
        return;
      }
      if (ready.id === 'player') {
        this.refresh(this.combat.applyAction(ready, { kind: 'attack', targetId: 'enemy' }));
        if (juice.particles) PlatformSceneHelper.burst(this, 660, 300, 0xf87171, 6);
        if (juice.sfxOnHit) PlatformSceneHelper.playSfx(this, 'sfx_coin', 0.4);
        if (juice.hitStopMs > 0) this.time.delayedCall(juice.hitStopMs, () => undefined);
      } else {
        this.refresh(this.combat.applyAction(ready, { kind: 'attack', targetId: 'player' }));
        if (juice.cameraShake) PlatformSceneHelper.shake(this, 100, 0.005);
      }
      this.registry.set('hp', this.hero.hp);
      this.registry.set('enemyHp', this.foe.hp);
      if (this.foe.hp <= 0) {
        this.ended = true;
        gainXp(growth, wantBoss ? 80 : 35);
        this.saves.write('slot0', { stats: growth, battleWon: true });
        PlatformSceneHelper.burst(this, 660, 300, 0x86efac, 14);
        PlatformSceneHelper.playSfx(this, 'sfx_win');
        this.registry.set('won', true);
        this.scene.start('EndingScene');
      } else if (this.hero.hp <= 0) {
        this.ended = true;
        PlatformSceneHelper.playSfx(this, 'sfx_lose');
        this.registry.set('won', false);
        this.scene.start('EndingScene');
      }
    });
    PlatformSceneHelper.installPauseMenu(this);
  }

  private refresh(hint: string): void {
    this.registry.set('hp', this.hero.hp);
    this.registry.set('enemyHp', this.foe.hp);
    this.hud.setText(
      \`You \${this.hero.hp}/\${this.hero.maxHp} · \${this.foe.name} \${this.foe.hp} · g\${Math.floor(this.hero.gauge)} · \${hint}\`,
    );
  }
}
`;
  }

  // Every role has a branch above; keep a strong level kernel (never SPACE stub).
  return renderSceneStub(
    {
      file: stub.file,
      className: stub.className,
      sceneKey: 'Level1Scene',
      hint: stub.hint,
    },
    'platformer',
    allStubs,
  ).replaceAll('Level1Scene', key);
}

