import Phaser from 'phaser';
import { WorldGameEngine, type WorldEntity } from '../engine/WorldGameEngine';
import { CinematicLayer } from '../engine/CinematicLayer';
import { dayNightTint, findPath } from '../engine/pathfind';
import { UI_FONT, fontPx } from '../ui/fonts';
import {
  CHAR_FRAMES_PER_DIR,
  WALK_DIRS,
  characterPalette,
  characterSheetLayout,
  charFrameName,
  charFrameRect,
  drawCharacterSheet,
} from '../ui/characterSprite';
import {
  decorCells,
  drawPlaceSprite,
  interiorWallClusters,
  placeKindFromName,
  placePalette,
  placeSpriteLayout,
  placeTextureKey,
  type PlaceKind,
} from '../ui/placeSprite';

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

function shortTitle(raw: string, max = 28): string {
  const t = (raw || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t || 'World';
  return `${t.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Full game explore scene — Spec rules drive quests/inventory/portals/combat hooks.
 * Optional LingBot cinematic layer is presentation-only.
 */
export class WorldExploreScene extends Phaser.Scene {
  private engine!: WorldGameEngine;
  private tileSize = 48;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private playerSprite!: Phaser.GameObjects.Image | Phaser.GameObjects.Arc;
  private entitySprites = new Map<string, Phaser.GameObjects.GameObject>();
  private hud!: Phaser.GameObjects.Text;
  private questPanel!: Phaser.GameObjects.Text;
  private invPanel!: Phaser.GameObjects.Text;
  private dialogue!: Phaser.GameObjects.Text;
  private toast!: Phaser.GameObjects.Text;
  private moveCooldown = 0;
  private showQuestLog = false;
  private observeMode = false;
  private cinematic = new CinematicLayer();
  private assetKeys = {
    tile: 'wa_tile',
    wall: 'wa_wall',
    player: 'wa_player',
    npc: 'wa_npc',
    enemy: 'wa_enemy',
    item: 'wa_item',
  };

  constructor() {
    super('WorldExplore');
  }

  create(): void {
    const world = this.registry.get('world');
    this.engine = this.registry.get('engine') as WorldGameEngine;
    this.observeMode = Boolean(this.registry.get('observeMode'));
    if (!this.engine) {
      this.engine = new WorldGameEngine(world);
      this.registry.set('engine', this.engine);
    }
    this.tileSize = this.engine.world.presentation?.tileSize ?? 48;
    this.cursors = this.input.keyboard!.createCursorKeys();

    const parent = this.game.canvas.parentElement;
    if (parent) {
      this.cinematic.mount(parent);
      void this.cinematic.loadStaticFromWorld(this.engine.world);
      const startId = this.engine.world.space.startRegionId;
      const slot = this.engine.world.presentation?.spatialAssets?.[startId];
      const hasStatic =
        Boolean(slot?.videoUrl) ||
        Boolean(
          slot?.assetUrl &&
            !slot.assetUrl.startsWith('data:application/json') &&
            !/\.json(\?|$)/i.test(slot.assetUrl),
        );
      const wantLive =
        this.engine.world.presentation?.lingbotMode === 'real' || !hasStatic;
      if (
        wantLive &&
        (this.engine.world.presentation?.cinematicEnabled ||
          this.engine.world.presentation?.spatialBackend === 'lingbot')
      ) {
        void this.cinematic.ensureSession(this.engine.world);
      }
    }
    this.events.once('shutdown', () => {
      void this.cinematic.closeSession();
      this.cinematic.unmount();
    });

    this.engine.on((ev) => this.onWorldEvent(ev.type, ev.payload));
    const intro = this.engine.introBeat();
    void this.loadAssetBriefTextures().then(() => {
      this.drawRegion();
      this.bindKeys();
      this.engine.resolve();
      this.refreshHud();
      if (intro) this.showDialogue(intro);
    });
  }

  /** Load public/ASSET_BRIEF.json MiniMax sprites + BGM/SFX when present. */
  private async loadAssetBriefTextures(): Promise<void> {
    const defaults: Array<{ role: string; file: string }> = [
      { role: 'tile', file: './assets/ground.png' },
      { role: 'wall', file: './assets/wall.png' },
      { role: 'player', file: './assets/player.png' },
      { role: 'npc', file: './assets/npc.png' },
      { role: 'enemy', file: './assets/enemy.png' },
      { role: 'item', file: './assets/item.png' },
    ];
    let entries = defaults;
    let audio: Array<{ id: string; file: string }> = [
      { id: 'bgm', file: './assets/bgm.mp3' },
      { id: 'sfx_win', file: './assets/sfx_win.mp3' },
      { id: 'sfx_lose', file: './assets/sfx_lose.mp3' },
    ];
    try {
      const res = await fetch('./ASSET_BRIEF.json');
      if (res.ok) {
        const brief = (await res.json()) as {
          assetQuality?: string;
          placeholderQuality?: string;
          assets?: Array<{ role?: string; file?: string }>;
          placeholders?: Array<{ role?: string; file?: string }>;
          audio?: Array<{ id?: string; file?: string; role?: string }>;
        };
        const quality = String(
          brief.assetQuality ?? brief.placeholderQuality ?? '',
        );
        if (/procedural/i.test(quality)) {
          // eslint-disable-next-line no-console
          console.warn(
            '[WorldExplore] ASSET_BRIEF is procedural — prefer MiniMax files on disk',
          );
        }
        const list = brief.assets?.length ? brief.assets : brief.placeholders;
        if (list?.length) {
          entries = list
            .filter((p) => p.role && p.file)
            .map((p) => ({ role: p.role!, file: p.file! }));
        }
        if (brief.audio?.length) {
          audio = brief.audio
            .filter((a) => a.file && (a.id || a.role))
            .map((a) => ({
              id: a.id || a.role || 'audio',
              file: a.file!,
            }));
        }
      }
    } catch {
      // optional
    }

    const roleToKey: Record<string, string> = {
      tile: this.assetKeys.tile,
      wall: this.assetKeys.wall,
      player: this.assetKeys.player,
      npc: this.assetKeys.npc,
      enemy: this.assetKeys.enemy,
      item: this.assetKeys.item,
    };

    await new Promise<void>((resolve) => {
      let queued = 0;
      for (const p of entries) {
        const key = roleToKey[p.role];
        if (!key || this.textures.exists(key)) continue;
        this.load.image(key, p.file);
        queued += 1;
      }
      for (const a of audio) {
        if (this.cache.audio.exists(a.id)) continue;
        this.load.audio(a.id, a.file);
        queued += 1;
      }
      if (queued === 0) {
        resolve();
        return;
      }
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      this.load.once('complete', done);
      // Do not treat a single loaderror as success — wait for complete
      this.load.on('loaderror', (_file: unknown) => {
        // eslint-disable-next-line no-console
        console.warn('[WorldExplore] asset loaderror', _file);
      });
      this.load.start();
      this.time.delayedCall(8000, done);
    });

    try {
      if (this.cache.audio.exists('bgm') && !this.sound.get('bgm')) {
        this.sound.play('bgm', { loop: true, volume: 0.35 });
      }
    } catch {
      // audio optional if browser blocks autoplay
    }
  }

  private bindKeys(): void {
    const kb = this.input.keyboard!;
    kb.on('keydown-E', () => this.tryTalk());
    kb.on('keydown-F', () => this.tryPickup());
    kb.on('keydown-C', () => {
      if (this.observeMode) return;
      this.tryCombat();
    });
    kb.on('keydown-T', () => {
      this.animateNpcSchedulesThenTick();
    });
    kb.on('keydown-Q', () => {
      if (this.observeMode) return;
      this.showQuestLog = !this.showQuestLog;
      this.questPanel.setVisible(this.showQuestLog);
    });
  }

  private onWorldEvent(type: string, payload?: Record<string, unknown>): void {
    if (type === 'quest_started') {
      this.flash(`Quest started: ${payload?.['questId']}`);
    }
    if (type === 'quest_completed') {
      this.flash(`Quest complete: ${payload?.['questId']}`);
      this.cameras.main.flash(200, 80, 200, 120);
      try {
        if (this.cache.audio.exists('sfx_win')) {
          this.sound.play('sfx_win', { volume: 0.7 });
        }
      } catch {
        // ignore
      }
    }
    if (type === 'item_gained') {
      this.flash(`Got item: ${payload?.['itemId']}`);
    }
    if (type === 'portal_used') {
      this.flash('Entered a portal…');
      void this.cinematic.pushAction('use_portal');
      // L3 SSOT: swap region cinematic from Spec spatialAssets
      this.cinematic.showRegion(this.engine.world, this.currentRegionId());
    }
    if (type === 'combat_lost' || type === 'player_defeated') {
      this.cameras.main.shake(200, 0.012);
      this.cameras.main.flash(160, 180, 40, 40);
      try {
        if (this.cache.audio.exists('sfx_lose')) {
          this.sound.play('sfx_lose', { volume: 0.7 });
        }
      } catch {
        // ignore
      }
    }
  }

  private flash(msg: string): void {
    this.toast?.setText(msg);
    this.time.delayedCall(2200, () => {
      if (this.toast?.text === msg) this.toast.setText('');
    });
  }

  private showDialogue(text: string): void {
    this.dialogue.setText(text);
  }

  private currentRegionId(): string {
    return this.engine.player().regionId;
  }

  /** Map ASCII char → tile kind for true tilemap rendering. */
  private tileKindAt(ch: string): 'ground' | 'path' | 'wall' | 'water' | 'decor' {
    if (ch === '#' || ch === 'X') return 'wall';
    if (ch === '~') return 'water';
    if (ch === '=') return 'path';
    if (ch === '*') return 'decor';
    return 'ground';
  }

  private ySortDepth(feetY: number): number {
    return 10 + Math.floor(feetY);
  }

  private drawRegion(): void {
    this.children.removeAll();
    this.entitySprites.clear();
    const region = this.engine.region(this.currentRegionId())!;
    const palette = this.engine.world.styleAnchor?.palette ?? [];
    const ground = palette[0]
      ? Phaser.Display.Color.HexStringToColor(palette[0]).color
      : region.kind === 'dungeon' || region.kind === 'arena'
        ? 0x1b263b
        : region.kind === 'wilderness'
          ? 0x1b4332
          : 0x2d6a4f;
    const accent = palette[1]
      ? Phaser.Display.Color.HexStringToColor(palette[1]).color
      : 0x40916c;
    const dirt = palette[2]
      ? Phaser.Display.Color.HexStringToColor(palette[2]).color
      : 0x52796f;
    const pathColor = 0x8b7355;
    const waterColor = 0x1d4e89;
    const decorColor = 0x2d6a4f;

    const g = this.add.graphics().setDepth(0);
    const hasGroundTex = this.textures.exists(this.assetKeys.tile);
    const hasWallTex = this.textures.exists(this.assetKeys.wall);
    const rows = (region.layoutAscii ?? '')
      .replace(/\r/g, '')
      .split('\n')
      .map((l) => l.trimEnd());

    // True tilemap pass: every cell is a typed tile (ground/path/wall/water/decor)
    for (let ty = 0; ty < region.height; ty++) {
      for (let tx = 0; tx < region.width; tx++) {
        const ch = rows[ty]?.[tx] ?? '.';
        const kind = this.tileKindAt(ch);
        const cx = tx * this.tileSize + this.tileSize / 2;
        const cy = ty * this.tileSize + this.tileSize / 2;
        if (kind === 'wall' && hasWallTex) {
          this.add
            .image(cx, cy, this.assetKeys.wall)
            .setDisplaySize(this.tileSize, this.tileSize)
            .setDepth(1);
          continue;
        }
        if (hasGroundTex) {
          const img = this.add
            .image(cx, cy, this.assetKeys.tile)
            .setDisplaySize(this.tileSize, this.tileSize)
            .setDepth(kind === 'wall' ? 1 : 0);
          if (kind === 'wall') img.setTint(0x3d5a45);
          else if (kind === 'water') img.setTint(0x4cc9f0);
          else if (kind === 'path') img.setTint(0xd4a373);
          else if (kind === 'decor') img.setTint(0x95d5b2);
          continue;
        }
        const fill =
          kind === 'wall'
            ? 0x1b4332
            : kind === 'water'
              ? waterColor
              : kind === 'path'
                ? pathColor
                : kind === 'decor'
                  ? decorColor
                  : (tx + ty) % 2 === 0
                    ? ground
                    : dirt;
        g.fillStyle(fill, 1);
        g.fillRect(
          tx * this.tileSize,
          ty * this.tileSize,
          this.tileSize,
          this.tileSize,
        );
        if (kind === 'decor') {
          g.fillStyle(0x3f6212, 0.35);
          g.fillRect(
            tx * this.tileSize + 8,
            ty * this.tileSize + 8,
            this.tileSize - 16,
            this.tileSize - 16,
          );
        } else if (kind === 'wall') {
          g.fillStyle(0x52b788, 0.25);
          g.fillRect(
            tx * this.tileSize + 2,
            ty * this.tileSize + 2,
            this.tileSize - 4,
            4,
          );
        } else if (kind === 'ground' && (tx * 17 + ty * 31) % 5 === 0) {
          g.fillStyle(accent, 0.12);
          g.fillRect(
            tx * this.tileSize + 4,
            ty * this.tileSize + 4,
            this.tileSize - 8,
            this.tileSize - 8,
          );
        }
      }
    }

    this.drawExploreStructures(region, rows);

    g.lineStyle(1, 0x40916c, 0.12);
    for (let x = 0; x <= region.width; x++) {
      g.lineBetween(x * this.tileSize, 0, x * this.tileSize, region.height * this.tileSize);
    }
    for (let y = 0; y <= region.height; y++) {
      g.lineBetween(0, y * this.tileSize, region.width * this.tileSize, y * this.tileSize);
    }

    // portals markers — prefer MiniMax item/npc texture over flat cyan square
    for (const portal of this.engine.world.space.portals) {
      if (portal.fromRegionId !== region.id) continue;
      const px =
        portal.fromPos.x * this.tileSize + this.tileSize / 2;
      const py =
        portal.fromPos.y * this.tileSize + this.tileSize / 2;
      const size = this.tileSize * 0.9;
      const tex =
        this.textures.exists('item')
          ? 'item'
          : this.textures.exists('npc')
            ? 'npc'
            : null;
      if (tex) {
        this.add
          .image(px, py, tex)
          .setDisplaySize(size, size)
          .setTint(0x4cc9f0)
          .setAlpha(0.9)
          .setDepth(5);
      } else {
        this.add
          .rectangle(px, py, size, size, 0x4cc9f0, 0.35)
          .setStrokeStyle(2, 0x90e0ef);
      }
      this.add
        .text(px, py, portal.label ?? '↗', {
          fontFamily: UI_FONT,
          fontSize: fontPx(14),
          color: '#e0fbfc',
        })
        .setOrigin(0.5)
        .setDepth(6);
    }

    this.add
      .text(8, region.height * this.tileSize + 6, region.name, {
        fontFamily: UI_FONT,
        fontSize: fontPx(18),
        color: '#95d5b2',
      })
      .setDepth(50);

    for (const e of this.engine.world.entities.filter(
      (x) => x.regionId === region.id,
    )) {
      this.spawnEntitySprite(e);
    }

    this.cameras.main.setBounds(
      0,
      0,
      region.width * this.tileSize,
      region.height * this.tileSize + 48,
    );
    if (this.playerSprite) {
      this.cameras.main.startFollow(this.playerSprite, true, 0.15, 0.15);
    }

    this.hud = this.add
      .text(8, 8, '', {
        fontFamily: UI_FONT,
        fontSize: fontPx(14),
        color: '#f1faee',
        backgroundColor: '#00000099',
        padding: { x: 8, y: 6 },
      })
      .setScrollFactor(0)
      .setDepth(200);

    this.questPanel = this.add
      .text(8, 70, '', {
        fontFamily: UI_FONT,
        fontSize: fontPx(14),
        color: '#ffe8a3',
        backgroundColor: '#000000aa',
        padding: { x: 8, y: 6 },
        wordWrap: { width: 320 },
      })
      .setScrollFactor(0)
      .setDepth(200)
      .setVisible(this.showQuestLog);

    this.invPanel = this.add
      .text(8, 620, '', {
        fontFamily: UI_FONT,
        fontSize: fontPx(14),
        color: '#bde0fe',
        backgroundColor: '#000000aa',
        padding: { x: 8, y: 6 },
      })
      .setScrollFactor(0)
      .setDepth(200)
      .setVisible(false);

    this.dialogue = this.add
      .text(8, 672, '', {
        fontFamily: UI_FONT,
        fontSize: fontPx(17),
        color: '#fff',
        backgroundColor: '#000c',
        padding: { x: 12, y: 9 },
        wordWrap: { width: 1040 },
      })
      .setScrollFactor(0)
      .setDepth(210);

    this.toast = this.add
      .text(640, 40, '', {
        fontFamily: UI_FONT,
        fontSize: fontPx(16),
        color: '#caffbf',
        backgroundColor: '#1b4332cc',
        padding: { x: 10, y: 6 },
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(220);
  }

  private drawExploreStructures(
    region: { id?: string; kind?: string; width: number; height: number; layoutAscii?: string },
    rows: string[],
  ): void {
    const ts = this.tileSize;
    const g = this.add.graphics().setDepth(2);
    const roofHex = region.kind === 'wilderness' ? 0x8b5a2b : 0x9a3412;
    const roofDark = 0x6b3f22;
    for (const cluster of interiorWallClusters(
      rows.join('\n'),
      region.width,
      region.height,
    )) {
      for (const cell of cluster.cells) {
        const gap = cluster.door && cell.x === cluster.door.x && cell.y === cluster.door.y - 1;
        const px = cell.x * ts;
        const py = cell.y * ts;
        g.fillStyle(roofDark, 0.92);
        g.fillRect(px + 3, py + 3, ts - 6, ts * 0.42);
        if (!gap) {
          g.fillStyle(roofHex, 0.88);
          g.fillRect(px + 5, py + ts * 0.28, ts - 10, ts * 0.38);
        }
      }
      if (cluster.door) {
        const dx = cluster.door.x * ts;
        const dy = cluster.door.y * ts;
        g.fillStyle(0x4b2e1e, 0.8);
        g.fillRect(dx + ts * 0.28, dy + ts * 0.15, ts * 0.44, ts * 0.7);
      }
    }
    const treeKey = this.ensurePlaceTexture('tree');
    for (const cell of decorCells(region.layoutAscii, region.width, region.height)) {
      const cx = cell.x * ts + ts / 2;
      const cy = cell.y * ts + ts / 2;
      if (treeKey) {
        this.add
          .image(cx, cy, treeKey)
          .setDisplaySize(ts * 0.95, ts * 0.95)
          .setDepth(3);
      }
    }
  }

  private ensurePlaceTexture(kind: PlaceKind): string | undefined {
    const key = placeTextureKey(kind);
    if (this.textures.exists(key)) return key;
    const layout = placeSpriteLayout(2);
    const canvas = this.textures.createCanvas(key, layout.size, layout.size);
    const ctx = canvas?.getContext() as CanvasRenderingContext2D | null;
    if (!canvas || !ctx) {
      if (this.textures.exists(key)) this.textures.remove(key);
      return undefined;
    }
    const palette = placePalette(
      kind,
      this.engine.world.styleAnchor?.palette,
    );
    drawPlaceSprite(
      (x, y, w, h, color) => {
        ctx.fillStyle = color;
        ctx.fillRect(x, y, w, h);
      },
      kind,
      palette,
      layout,
    );
    canvas.refresh();
    return key;
  }

  private ensureExploreChar(id: string, name: string): string | undefined {
    const key = `char_explore_${id}`;
    if (this.textures.exists(key)) return key;
    const layout = characterSheetLayout(3);
    const canvas = this.textures.createCanvas(key, layout.sheetW, layout.sheetH);
    const ctx = canvas?.getContext() as CanvasRenderingContext2D | null;
    if (!canvas || !ctx) {
      if (this.textures.exists(key)) this.textures.remove(key);
      return undefined;
    }
    drawCharacterSheet(
      (x, y, w, h, color) => {
        ctx.fillStyle = color;
        ctx.fillRect(x, y, w, h);
      },
      characterPalette(`${id}:${name}`, this.engine.world.styleAnchor?.palette),
      layout,
    );
    canvas.refresh();
    const texture = this.textures.get(key);
    for (const dir of WALK_DIRS) {
      for (let frame = 0; frame < CHAR_FRAMES_PER_DIR; frame += 1) {
        const rect = charFrameRect(dir, frame, layout);
        texture.add(charFrameName(dir, frame), 0, rect.x, rect.y, rect.w, rect.h);
      }
    }
    return key;
  }

  private spawnEntitySprite(e: WorldEntity): void {
    const color =
      e.kind === 'player'
        ? 0xf4a261
        : e.kind === 'npc'
          ? 0xe76f51
          : e.kind === 'enemy'
            ? 0xd00000
            : e.kind === 'item'
              ? 0xffd166
              : 0x264653;
    const cx = e.pos.x * this.tileSize + this.tileSize / 2;
    // Feet-anchored Y so sprites sit on the tile instead of floating mid-bust
    const feetY = e.pos.y * this.tileSize + this.tileSize * 0.92;
    const depth = this.ySortDepth(feetY);
    const texKey =
      e.kind === 'player'
        ? this.assetKeys.player
        : e.kind === 'npc'
          ? this.assetKeys.npc
          : e.kind === 'enemy'
            ? this.assetKeys.enemy
            : e.kind === 'item'
              ? this.assetKeys.item
              : '';

    // Ground shadow ellipse — kills the "floating bust" look
    this.add
      .ellipse(cx, feetY, this.tileSize * 0.7, this.tileSize * 0.22, 0x000000, 0.28)
      .setDepth(depth - 1);

    const placeKey =
      e.kind === 'item' || e.kind === 'prop'
        ? this.ensurePlaceTexture(placeKindFromName(e.name))
        : undefined;
    const charKey =
      (e.kind === 'npc' || e.kind === 'player') &&
      !(texKey && this.textures.exists(texKey))
        ? this.ensureExploreChar(e.id, e.name)
        : undefined;

    let body: Phaser.GameObjects.Image | Phaser.GameObjects.Arc;
    if (texKey && this.textures.exists(texKey)) {
      const displayH = this.tileSize * 1.15;
      const img = this.add
        .image(cx, feetY, texKey)
        .setOrigin(0.5, 1)
        .setDisplaySize(this.tileSize * 0.85, displayH)
        .setDepth(depth);
      body = img;
    } else if (placeKey) {
      const img = this.add
        .image(cx, feetY, placeKey)
        .setOrigin(0.5, 1)
        .setDisplaySize(this.tileSize * 0.9, this.tileSize * 0.9)
        .setDepth(depth);
      body = img;
    } else if (charKey) {
      const img = this.add
        .image(cx, feetY, charKey, charFrameName('down', 0))
        .setOrigin(0.5, 1)
        .setDisplaySize(this.tileSize * 0.85, this.tileSize * 1.15)
        .setDepth(depth);
      body = img;
    } else {
      const circle = this.add
        .circle(cx, feetY - this.tileSize * 0.28, this.tileSize * 0.36, color, 0.85)
        .setDepth(depth);
      if (e.kind === 'enemy') {
        circle.setStrokeStyle(2, 0xffba08);
      } else {
        circle.setStrokeStyle(1, 0xffffff, 0.35);
      }
      body = circle;
      const icon =
        e.spriteKey ||
        (e.kind === 'player'
          ? '🚶'
          : e.kind === 'npc'
            ? '👤'
            : e.kind === 'enemy'
              ? '💀'
              : e.kind === 'item'
                ? '✦'
                : '◆');
      this.add
        .text(cx, feetY - this.tileSize * 0.28, icon, {
          fontSize: `${Math.max(16, Math.floor(this.tileSize * 0.7))}px`,
        })
        .setOrigin(0.5)
        .setDepth(depth + 1);
    }
    if (e.kind === 'item') {
      this.tweens.add({
        targets: body,
        scale: 1.12,
        duration: 600,
        yoyo: true,
        repeat: -1,
      });
    }
    if (e.kind === 'npc' || e.kind === 'player') {
      this.add
        .text(cx, feetY - this.tileSize * 1.15, e.name, {
          fontFamily: UI_FONT,
          fontSize: fontPx(13),
          color: '#fff',
          backgroundColor: '#00000088',
          padding: { x: 4, y: 2 },
        })
        .setOrigin(0.5)
        .setDepth(depth + 2);
    }
    this.entitySprites.set(e.id, body);
    if (e.kind === 'player') this.playerSprite = body;
  }

  private refreshHud(): void {
    const p = this.engine.player();
    const region = this.engine.region(p.regionId);
    if (this.observeMode) {
      this.hud?.setText(
        `${shortTitle(this.engine.world.meta.title)} · ${region?.name ?? ''}\n观察旁路 · ←→↑↓ 漫游 · E 对话 · 回 ?mode=observe 看小镇生活`,
      );
      this.questPanel?.setVisible(false);
      this.invPanel?.setVisible(false);
      return;
    }
    this.hud?.setText(
      `${shortTitle(this.engine.world.meta.title)} · ${region?.name ?? ''} · 地图漫游（调试）\n←→↑↓ · E 对话 · Q 任务 · Esc/刷新回观察模式`,
    );

    const quests = this.engine.world.narrative.quests;
    const lines = quests.map((q) => {
      const step =
        q.status === 'active'
          ? q.steps?.find((s) => true)?.description ?? q.description
          : q.description;
      return `• [${q.status}] ${q.title}\n  ${step}`;
    });
    this.questPanel?.setText(`Quests (Q)\n${lines.join('\n') || '—'}`);
    this.questPanel?.setVisible(this.showQuestLog);
    this.invPanel?.setVisible(this.showQuestLog);
    this.invPanel?.setText(
      `Bag: ${p.inventory.length ? p.inventory.join(', ') : '(empty)'}`,
    );
  }

  private tryTalk(): void {
    const npcs = this.engine.entitiesNearPlayer(['npc'], 1);
    if (!npcs.length) {
      this.showDialogue('No one nearby. Stand next to an NPC and press E.');
      return;
    }
    const npc = npcs[0]!;
    const { line } = this.engine.talkTo(npc.id);
    this.showDialogue(`${npc.name}: ${line}`);
    void this.cinematic.pushAction('talk');
    this.refreshHud();
    this.redrawEntitiesIfNeeded();
    this.maybeEnd();
  }

  private tryPickup(): void {
    const result = this.engine.pickupNearest();
    if (!result.ok) {
      this.showDialogue('Nothing to pick up nearby. Walk onto or beside a yellow item.');
      return;
    }
    this.showDialogue(`Picked up ${result.itemId}.`);
    this.drawRegion();
    this.refreshHud();
    this.maybeEnd();
  }

  private tryCombat(): void {
    const enemies = this.engine.entitiesNearPlayer(['enemy'], 1);
    if (!enemies.length) {
      this.showDialogue('No enemies adjacent. Find a red foe and press C.');
      return;
    }
    this.registry.set('battleEnemyId', enemies[0]!.id);
    void this.cinematic.pushAction('attack');
    this.scene.start('Battle');
  }

  private redrawEntitiesIfNeeded(): void {
    // Cheap: if entity count changed, redraw
    const regionId = this.currentRegionId();
    const expected = this.engine.world.entities.filter(
      (e) => e.regionId === regionId,
    ).length;
    if (expected !== this.entitySprites.size) {
      this.drawRegion();
      this.refreshHud();
    }
  }

  /**
   * Instead of teleporting NPCs on schedule, A* walk + action bubble + day/night.
   */
  private animateNpcSchedulesThenTick(): void {
    const region = this.engine.world.space.regions.find(
      (r) => r.id === this.currentRegionId(),
    );
    const width = region?.width ?? 32;
    const height = region?.height ?? 24;
    const layout = region?.layoutAscii ?? '';
    const blocked = (x: number, y: number) => {
      if (!layout) return false;
      const lines = layout.replace(/\r/g, '').split('\n');
      const ch = lines[y]?.[x];
      return ch === '#';
    };

    const hour = Math.floor(this.engine.world.timeHours + 1) % 24;
    const npcs = this.engine.world.entities.filter((e) => e.kind === 'npc');
    let pending = 0;

    for (const npc of npcs) {
      const entry = (npc.schedule ?? []).find((s) => s.hour === hour);
      if (!entry) continue;
      // Real destination: if schedule region differs, walk to map edge then hop
      // (no instant teleport — camera fade marks the region change).
      if (entry.regionId && entry.regionId !== npc.regionId) {
        const sprite = this.entitySprites.get(npc.id) as
          | Phaser.GameObjects.Image
          | Phaser.GameObjects.Arc
          | undefined;
        const edge = {
          x:
            npc.pos.x < width / 2
              ? Math.max(1, width - 2)
              : 1,
          y: npc.pos.y,
        };
        const path =
          findPath(
            width,
            height,
            blocked,
            { x: npc.pos.x, y: npc.pos.y },
            edge,
          ) ?? [];
        if (sprite && path.length > 1) {
          pending += 1;
          const bubble = this.add
            .text(sprite.x, sprite.y - 28, 'traveling…', {
              fontFamily: UI_FONT,
              fontSize: fontPx(13),
              color: '#e0f2fe',
              backgroundColor: '#0f172acc',
              padding: { x: 5, y: 2 },
            })
            .setOrigin(0.5)
            .setDepth(200);
          const targets = path.map((p) => ({
            x: p.x * this.tileSize + this.tileSize / 2,
            y: p.y * this.tileSize + this.tileSize * 0.92,
          }));
          this.tweens.chain({
            targets: sprite,
            tweens: targets.slice(1).map((pt) => ({
              x: pt.x,
              y: pt.y,
              duration: 100,
            })),
            onComplete: () => {
              bubble.destroy();
              this.cameras.main.fadeOut(120, 15, 23, 42);
              this.cameras.main.once('camerafadeoutcomplete', () => {
                npc.regionId = entry.regionId!;
                npc.pos = { x: 2, y: Math.min(height - 2, Math.max(2, edge.y)) };
                this.cameras.main.fadeIn(160, 15, 23, 42);
                pending -= 1;
                if (pending <= 0) this.finishTimeTick();
              });
            },
          });
        } else {
          npc.regionId = entry.regionId;
        }
        continue;
      }
      const goal = {
        x: Math.min(
          width - 2,
          Math.max(1, 4 + (Math.abs(hashCode(entry.activity)) % Math.max(2, width - 8))),
        ),
        y: Math.min(
          height - 2,
          Math.max(
            1,
            4 + (Math.abs(hashCode(entry.activity + 'y')) % Math.max(2, height - 8)),
          ),
        ),
      };
      const path =
        findPath(width, height, blocked, { x: npc.pos.x, y: npc.pos.y }, goal) ??
        [];
      const sprite = this.entitySprites.get(npc.id) as
        | Phaser.GameObjects.Image
        | Phaser.GameObjects.Arc
        | undefined;
      if (sprite && path.length > 1) {
        pending += 1;
        const bubble = this.add
          .text(sprite.x, sprite.y - 28, entry.activity.slice(0, 18), {
            fontFamily: UI_FONT,
            fontSize: fontPx(13),
            color: '#fef9c3',
            backgroundColor: '#0f172acc',
            padding: { x: 5, y: 2 },
          })
          .setOrigin(0.5)
          .setDepth(200);
        const targets = path.map((p) => ({
          x: p.x * this.tileSize + this.tileSize / 2,
          y: p.y * this.tileSize + this.tileSize * 0.92,
        }));
        this.tweens.chain({
          targets: sprite,
          tweens: targets.slice(1).map((t) => ({
            x: t.x,
            y: t.y,
            duration: 120,
            onUpdate: () => {
              if ('setDepth' in sprite) {
                (sprite as Phaser.GameObjects.Image).setDepth(
                  this.ySortDepth((sprite as Phaser.GameObjects.Image).y),
                );
              }
            },
          })),
          onComplete: () => {
            bubble.destroy();
            npc.pos = { x: goal.x, y: goal.y };
            pending -= 1;
            if (pending <= 0) this.finishTimeTick();
          },
        });
      }
    }

    this.cameras.main.setBackgroundColor(dayNightTint(this.engine.world.timeHours + 1));
    if (pending <= 0) this.finishTimeTick();
  }

  private finishTimeTick(): void {
    this.engine.tickHours(1);
    void this.cinematic.pushAction('tick');
    this.flash(`Time → ${Math.floor(this.engine.world.timeHours)}h`);
    this.refreshHud();
    this.redrawEntitiesIfNeeded();
    this.maybeEnd();
  }

  private maybeEnd(): void {
    if (this.engine.isDefeat()) {
      this.registry.set('endKind', 'defeat');
      this.scene.start('Ending');
      return;
    }
    if (this.engine.isVictory()) {
      this.registry.set('endKind', 'victory');
      this.scene.start('Ending');
    }
  }

  update(_t: number, dt: number): void {
    if (!this.cursors || !this.playerSprite) return;
    this.moveCooldown = Math.max(0, this.moveCooldown - dt);
    if (this.moveCooldown > 0) return;
    let dx = 0;
    let dy = 0;
    if (this.cursors.left?.isDown) dx = -1;
    else if (this.cursors.right?.isDown) dx = 1;
    else if (this.cursors.up?.isDown) dy = -1;
    else if (this.cursors.down?.isDown) dy = 1;
    if (!dx && !dy) return;
    this.moveCooldown = 120;
    const { regionChanged, blocked } = this.engine.movePlayer(dx, dy);
    if (blocked) return;
    const action =
      dy < 0 ? 'move_n' : dy > 0 ? 'move_s' : dx > 0 ? 'move_e' : 'move_w';
    void this.cinematic.pushAction(action);
    if (regionChanged) {
      this.drawRegion();
      this.cinematic.showRegion(this.engine.world, this.currentRegionId());
    } else {
      const p = this.engine.player();
      const feetY = p.pos.y * this.tileSize + this.tileSize * 0.92;
      this.playerSprite.setPosition(
        p.pos.x * this.tileSize + this.tileSize / 2,
        feetY,
      );
      this.playerSprite.setDepth(this.ySortDepth(feetY));
    }
    this.refreshHud();
    this.maybeEnd();
  }
}
