/**
 * DOM overlay for LingBot / spatial cinematic frames beside Phaser canvas.
 * Presentation-only — never drives quests, combat, or inventory.
 */
export class CinematicLayer {
  private root: HTMLDivElement | null = null;
  private img: HTMLImageElement | null = null;
  private video: HTMLVideoElement | null = null;
  private badge: HTMLDivElement | null = null;
  private sessionId: string | null = null;
  /** When Spec already has playable media, skip mock step frames that clobber it. */
  private preferStaticSpec = false;
  private sidecar =
    (typeof import.meta !== 'undefined' &&
      (import.meta as { env?: { VITE_LINGBOT_SIDECAR_URL?: string } }).env
        ?.VITE_LINGBOT_SIDECAR_URL) ||
    'http://127.0.0.1:8091';
  private mode: 'mock' | 'real' =
    (typeof import.meta !== 'undefined' &&
      (import.meta as { env?: { VITE_LINGBOT_MODE?: string } }).env
        ?.VITE_LINGBOT_MODE) === 'real'
      ? 'real'
      : 'mock';

  mount(parent: HTMLElement): void {
    if (this.root) return;
    const el = document.createElement('div');
    el.style.cssText =
      'position:absolute;inset:0;pointer-events:none;z-index:1;overflow:hidden;';
    const img = document.createElement('img');
    img.alt = 'LingBot cinematic';
    img.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0.28;display:none;';
    const video = document.createElement('video');
    video.muted = true;
    video.autoplay = true;
    video.loop = true;
    video.playsInline = true;
    video.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0.32;display:none;';
    const badge = document.createElement('div');
    badge.style.cssText =
      'position:absolute;right:8px;bottom:8px;padding:4px 8px;font:11px/1.3 monospace;color:#e2e8f0;background:#00000099;border-radius:4px;opacity:0;transition:opacity .2s;';
    badge.textContent = `L3 visual · ${this.mode}`;
    el.appendChild(img);
    el.appendChild(video);
    el.appendChild(badge);
    parent.style.position = 'relative';
    parent.prepend(el);
    this.root = el;
    this.img = img;
    this.video = video;
    this.badge = badge;
  }

  unmount(): void {
    this.video?.pause();
    this.root?.remove();
    this.root = null;
    this.img = null;
    this.video = null;
    this.badge = null;
    this.sessionId = null;
  }

  private isVideoUrl(url: string): boolean {
    if (url.startsWith('data:video/')) return true;
    if (url.startsWith('file:')) return false;
    return /\.(mp4|webm|ogg)(\?|$)/i.test(url);
  }

  setFrame(url: string | undefined | null, label?: string): void {
    if (!url) return;
    if (url.startsWith('data:application/json')) return;
    if (url.startsWith('file:')) return;

    if (this.isVideoUrl(url) && this.video) {
      if (this.img) this.img.style.display = 'none';
      this.video.style.display = 'block';
      if (this.video.src !== url) {
        this.video.src = url;
        void this.video.play().catch(() => undefined);
      }
    } else if (this.img) {
      if (this.video) {
        this.video.pause();
        this.video.style.display = 'none';
      }
      this.img.style.display = 'block';
      this.img.src = url;
    }

    if (this.badge) {
      this.badge.textContent =
        label ?? `L3 visual · ${this.mode} · Spec is SSOT`;
      this.badge.style.opacity = '1';
      window.setTimeout(() => {
        if (this.badge) this.badge.style.opacity = '0.55';
      }, 1200);
    }
  }

  private resolveMode(world?: {
    presentation?: { lingbotMode?: string; spatialBackend?: string };
  }): 'mock' | 'real' {
    const fromSpec = world?.presentation?.lingbotMode;
    if (fromSpec === 'real' || fromSpec === 'mock') return fromSpec;
    const vite =
      typeof import.meta !== 'undefined' &&
      (import.meta as { env?: { VITE_LINGBOT_MODE?: string } }).env
        ?.VITE_LINGBOT_MODE;
    if (vite === 'real') return 'real';
    return 'mock';
  }

  /** Prefer Spec-stamped public/lingbot.json over Vite env (deployment SSOT). */
  private async loadPresenterConfig(): Promise<void> {
    try {
      const res = await fetch('./lingbot.json');
      if (!res.ok) return;
      const cfg = (await res.json()) as {
        sidecarUrl?: string;
        lingbotMode?: string;
      };
      if (cfg.sidecarUrl) this.sidecar = cfg.sidecarUrl.replace(/\/$/, '');
      if (cfg.lingbotMode === 'real' || cfg.lingbotMode === 'mock') {
        this.mode = cfg.lingbotMode;
      }
    } catch {
      // optional — Vite env remains fallback
    }
  }

  /**
   * Swap cinematic to a region's Spec spatialAssets (portal / region change).
   * Presentation-only — does not change sim region authority.
   */
  showRegion(
    world: {
      presentation?: {
        lingbotMode?: string;
        spatialAssets?: Record<string, { videoUrl?: string; assetUrl?: string }>;
      };
    },
    regionId: string,
  ): void {
    this.mode = this.resolveMode(world);
    const assets = world.presentation?.spatialAssets ?? {};
    const url = assets[regionId]?.videoUrl ?? assets[regionId]?.assetUrl;
    if (url) {
      this.preferStaticSpec = !(
        url.startsWith('file:') ||
        url.startsWith('data:application/json') ||
        /\.json(\?|$)/i.test(url)
      );
      this.setFrame(url, `region ${regionId} · ${this.mode}`);
      return;
    }
    void (async () => {
      try {
        const res = await fetch('./spatial/manifest.json');
        if (!res.ok) return;
        const man = (await res.json()) as {
          regions?: Record<string, { videoUrl?: string; assetUrl?: string }>;
        };
        const r = man.regions?.[regionId];
        const u = r?.videoUrl ?? r?.assetUrl;
        if (u) {
          this.preferStaticSpec = true;
          this.setFrame(u, `region ${regionId} · ${this.mode}`);
        }
      } catch {
        // optional
      }
    })();
  }

  async loadStaticFromWorld(world: {
    space: { startRegionId: string };
    presentation?: {
      cinematicEnabled?: boolean;
      spatialBackend?: string;
      lingbotMode?: string;
      spatialAssets?: Record<string, { videoUrl?: string; assetUrl?: string }>;
    };
  }): Promise<void> {
    await this.loadPresenterConfig();
    this.mode = this.resolveMode(world);
    if (this.badge) this.badge.textContent = `L3 visual · ${this.mode}`;
    this.showRegion(world, world.space.startRegionId);
  }

  /**
   * Best-effort live session against local sidecar (CORS must allow).
   * Failures are silent — gameplay continues on Spec.
   */
  async ensureSession(world: {
    meta: { title: string; summary?: string };
    styleAnchor?: { artStyle?: string; palette?: string[]; mood?: string };
    space: { startRegionId: string; regions: Array<{ id: string; description?: string }> };
    presentation?: {
      spatialBackend?: string;
      lingbotMode?: string;
      spatialAssets?: Record<string, { videoUrl?: string; assetUrl?: string }>;
    };
  }): Promise<void> {
    if (this.sessionId) return;
    await this.loadPresenterConfig();
    this.mode = this.resolveMode(world);
    const startId = world.space.startRegionId;
    const existing = world.presentation?.spatialAssets?.[startId];
    const hasStaticSpec =
      Boolean(existing?.videoUrl && !existing.videoUrl.startsWith('file:')) ||
      Boolean(
        existing?.assetUrl &&
          !existing.assetUrl.startsWith('file:') &&
          !existing.assetUrl.startsWith('data:application/json') &&
          !/\.json(\?|$)/i.test(existing.assetUrl),
      );
    this.preferStaticSpec = hasStaticSpec;
    // Prefer sidecar health for readyReal downgrade
    try {
      const hr = await fetch(`${this.sidecar.replace(/\/$/, '')}/health`);
      if (hr.ok) {
        const h = (await hr.json()) as {
          mode?: string;
          readyReal?: boolean;
        };
        if (this.mode === 'real' && h.readyReal === false) this.mode = 'mock';
        else if (h.mode === 'mock' || h.mode === 'real') {
          // Spec/Vite win unless real not ready
          if (!(this.mode === 'real' && h.readyReal === false)) {
            /* keep this.mode from Spec/Vite */
          }
        }
      }
    } catch {
      // offline
    }
    const region =
      world.space.regions.find((r) => r.id === world.space.startRegionId) ??
      world.space.regions[0];
    try {
      const res = await fetch(`${this.sidecar.replace(/\/$/, '')}/v1/sessions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          prompt: [world.meta.title, region?.description, world.meta.summary]
            .filter(Boolean)
            .join(' — '),
          regionId: region?.id ?? world.space.startRegionId,
          worldTitle: world.meta.title,
          styleAnchor: world.styleAnchor ?? {},
          mode: this.mode,
        }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        sessionId?: string;
        frameUrl?: string;
        videoUrl?: string;
        mode?: string;
      };
      if (data.sessionId) this.sessionId = data.sessionId;
      if (data.mode === 'real' || data.mode === 'mock') this.mode = data.mode;
      const live = data.videoUrl ?? data.frameUrl;
      // Prefer Spec posters; only overlay live video when real mode or no static Spec
      if (
        live &&
        (!this.preferStaticSpec || (this.mode === 'real' && Boolean(data.videoUrl)))
      ) {
        this.setFrame(live, `LingBot session · ${this.mode}`);
      }
    } catch {
      // sidecar offline
    }
  }

  async closeSession(): Promise<void> {
    if (!this.sessionId) return;
    const sid = this.sessionId;
    this.sessionId = null;
    try {
      await fetch(`${this.sidecar.replace(/\/$/, '')}/v1/sessions/${sid}`, {
        method: 'DELETE',
      });
    } catch {
      // ignore
    }
  }

  async pushAction(action: string): Promise<void> {
    if (!this.sessionId) return;
    // Mock step frames must not clobber Spec-stamped posters
    if (this.preferStaticSpec && this.mode !== 'real') return;
    try {
      const res = await fetch(
        `${this.sidecar.replace(/\/$/, '')}/v1/sessions/${this.sessionId}/step`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action }),
        },
      );
      if (!res.ok) return;
      const data = (await res.json()) as { frameUrl?: string; wasd?: string; videoUrl?: string };
      const frame = data.videoUrl ?? data.frameUrl;
      if (!frame) return;
      this.setFrame(frame, `L3 · ${this.mode} · ${data.wasd ?? action}`);
    } catch {
      // ignore
    }
  }
}
