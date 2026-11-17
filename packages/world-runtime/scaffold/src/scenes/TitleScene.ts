import Phaser from 'phaser';
import type { WorldSpecDoc } from '../engine/WorldGameEngine';
import { DISPLAY_FONT, UI_FONT, fontPx } from '../ui/fonts';

type SpatialSlot = { videoUrl?: string; assetUrl?: string };
type SpatialManifest = {
  cinematicEnabled?: boolean;
  regions?: Record<string, SpatialSlot>;
};

function shortTitle(raw: string, max = 36): string {
  const t = (raw || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t || 'World';
  return `${t.slice(0, max - 1).trimEnd()}…`;
}

function isPlayableMedia(url: string | undefined | null): boolean {
  if (!url) return false;
  if (url.startsWith('file:')) return false;
  if (url.startsWith('data:application/json')) return false;
  if (/\.json(\?|$)/i.test(url)) return false;
  return true;
}

function isVideoUrl(url: string): boolean {
  if (url.startsWith('data:video/')) return true;
  return /\.(mp4|webm|ogg)(\?|$)/i.test(url);
}

export class TitleScene extends Phaser.Scene {
  constructor() {
    super('Title');
  }

  create(): void {
    const world = this.registry.get('world') as WorldSpecDoc;
    const { width, height } = this.scale;
    const palette = world.styleAnchor?.palette ?? ['#2d6a4f', '#d8f3dc'];
    this.cameras.main.setBackgroundColor(palette[0] ?? '#1a1a2e');

    void this.tryPlayCinematic(world);

    this.add
      .text(width / 2, height * 0.28, shortTitle(world.meta.title, 36), {
        fontSize: '48px',
        color: '#f8fafc',
        fontFamily: DISPLAY_FONT,
      })
      .setOrigin(0.5)
      .setDepth(10);

    this.add
      .text(
        width / 2,
        height * 0.42,
        shortTitle(
          world.meta.summary ?? 'A persistent world you can inhabit.',
          160,
        ),
        {
          fontFamily: UI_FONT,
          fontSize: fontPx(18),
          color: '#cbd5e1',
          wordWrap: { width: width * 0.7 },
          align: 'center',
        },
      )
      .setOrigin(0.5)
      .setDepth(10);

    const tip = this.add
      .text(
        width / 2,
        height * 0.62,
        'Press ENTER to open map roam (debug)\nTown life lives in observe mode — this is a secondary path',
        {
          fontFamily: UI_FONT,
          fontSize: fontPx(15),
          color: '#94a3b8',
          align: 'center',
        },
      )
      .setOrigin(0.5)
      .setDepth(10);

    this.tweens.add({
      targets: tip,
      alpha: 0.45,
      duration: 900,
      yoyo: true,
      repeat: -1,
    });

    this.input.keyboard!.once('keydown-ENTER', () => this.startGame());
    this.input.keyboard!.once('keydown-SPACE', () => this.startGame());
    // Intentionally no full-canvas click-to-start — accidental clicks should not dump into RPG roam
  }

  private async tryPlayCinematic(world: WorldSpecDoc): Promise<void> {
    const presentation = (
      world as WorldSpecDoc & {
        presentation?: {
          cinematicEnabled?: boolean;
          spatialAssets?: Record<string, SpatialSlot>;
        };
      }
    ).presentation;
    if (!presentation?.cinematicEnabled && !presentation?.spatialAssets) {
      return;
    }
    const startId = world.space.startRegionId;
    const slot = presentation.spatialAssets?.[startId];
    let mediaUrl = slot?.videoUrl ?? slot?.assetUrl;
    try {
      const res = await fetch('./spatial/manifest.json');
      if (res.ok) {
        const man = (await res.json()) as SpatialManifest;
        const mSlot =
          man.regions?.[startId] ?? Object.values(man.regions ?? {})[0];
        if (!isPlayableMedia(mediaUrl)) {
          mediaUrl = mSlot?.videoUrl ?? mSlot?.assetUrl;
        } else if (!slot?.videoUrl && mSlot?.videoUrl) {
          mediaUrl = mSlot.videoUrl;
        }
      }
    } catch {
      // optional
    }
    if (!isPlayableMedia(mediaUrl)) return;

    const { width, height } = this.scale;
    try {
      const parent = this.game.canvas.parentElement;
      if (!parent) return;
      parent.style.position = 'relative';
      const style = `position:absolute;inset:0;width:${width}px;height:${height}px;object-fit:cover;opacity:0.35;pointer-events:none;z-index:0;`;
      if (isVideoUrl(mediaUrl!)) {
        const el = document.createElement('video');
        el.src = mediaUrl!;
        el.muted = true;
        el.autoplay = true;
        el.loop = true;
        el.playsInline = true;
        el.style.cssText = style;
        parent.prepend(el);
        this.events.once('shutdown', () => el.remove());
      } else {
        const el = document.createElement('img');
        el.src = mediaUrl!;
        el.alt = 'L3 cinematic poster';
        el.style.cssText = style;
        parent.prepend(el);
        this.events.once('shutdown', () => el.remove());
      }
    } catch {
      // ignore
    }
  }

  private startGame(): void {
    this.scene.start('WorldExplore');
  }
}
