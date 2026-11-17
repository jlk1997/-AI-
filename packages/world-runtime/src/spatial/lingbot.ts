/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Optional L3 backend for LingBot-World-v2 (interactive video world model).
 * Spec remains SSOT; this only requests cinematic / region seed video.
 *
 * @see https://github.com/Robbyant/lingbot-world-v2
 */

import type { WorldSpec } from '@opengame/world-spec';

import type {
  SpatialBackend,
  SpatialGenerateRequest,
  SpatialGenerateResult,
} from './backends.js';
import {
  worldActionPathToLingBotManifest,
  type WorldActionKind,
} from './lingbotActionBridge.js';

export interface LingBotSidecarGenerateBody {
  readonly prompt: string;
  readonly regionId: string;
  readonly worldTitle: string;
  readonly styleAnchor: WorldSpec['styleAnchor'];
  readonly actionManifest: ReturnType<typeof worldActionPathToLingBotManifest>;
  readonly seedImageUrl?: string;
  readonly frameNum?: number;
  readonly mode?: 'mock' | 'real';
}

export interface LingBotSidecarGenerateResponse {
  readonly ok: boolean;
  readonly videoUrl?: string;
  readonly httpUrl?: string;
  readonly posterUrl?: string;
  readonly frameUrl?: string;
  readonly localPath?: string;
  readonly message: string;
  readonly license?: string;
  readonly mock?: boolean;
  readonly actionPath?: unknown;
}

export function resolveConsumerFrameNum(
  actionFrameCount: number,
  override?: number,
): number {
  if (override && override > 0) return override;
  const env = process.env['LINGBOT_FRAME_NUM'];
  if (env && /^\d+$/.test(env)) {
    const n = Number(env);
    if (n > 0) return n % 2 === 1 ? n : n + 1;
  }
  const profile = (process.env['LINGBOT_PROFILE'] || 'consumer').toLowerCase();
  if (profile === 'consumer') {
    const base = Math.max(17, Math.min(33, actionFrameCount * 2 + 1));
    return base % 2 === 1 ? base : base + 1;
  }
  const base = Math.max(17, actionFrameCount * 4 + 1);
  return base % 2 === 1 ? base : base + 1;
}

export function resolveLingBotMode(
  override?: 'mock' | 'real',
  readyReal?: boolean,
): 'mock' | 'real' {
  if (override === 'mock' || override === 'real') {
    if (override === 'real' && readyReal === false) return 'mock';
    return override;
  }
  const env = (process.env['LINGBOT_MODE'] as 'mock' | 'real' | undefined) ?? 'mock';
  if (env === 'real' && readyReal === false) return 'mock';
  return env === 'real' ? 'real' : 'mock';
}

function buildRegionPrompt(world: WorldSpec, regionId: string, extra?: string): string {
  const region = world.space.regions.find((r) => r.id === regionId);
  const style = world.styleAnchor;
  const bits = [
    `${style.artStyle || 'cinematic'} interactive world scene`,
    region ? `Region "${region.name}" (${region.kind}): ${region.description ?? ''}` : regionId,
    style.mood ? `Mood: ${style.mood}.` : '',
    style.palette?.length ? `Palette hints: ${style.palette.join(', ')}.` : '',
    world.meta.summary ?? '',
    extra ?? '',
  ];
  return bits.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

function defaultExplorePath(): WorldActionKind[] {
  return ['move_n', 'move_e', 'move_n', 'wait', 'talk'];
}

/**
 * Per-process memo of "this sidecar URL is not listening".
 *
 * A world generate calls `generateRegion` once per gated region. Without this,
 * an operator who never started the sidecar pays a failed health probe plus a
 * failed POST for every region, on every job.
 */
const unreachableSidecars = new Map<string, number>();

/** How long a "sidecar down" verdict is trusted before we probe again. */
const UNREACHABLE_TTL_MS = 60_000;

export function markSidecarUnreachable(baseUrl: string, now = Date.now()): void {
  unreachableSidecars.set(baseUrl, now);
}

export function sidecarRecentlyUnreachable(
  baseUrl: string,
  now = Date.now(),
): boolean {
  const at = unreachableSidecars.get(baseUrl);
  if (at === undefined) return false;
  if (now - at > UNREACHABLE_TTL_MS) {
    unreachableSidecars.delete(baseUrl);
    return false;
  }
  return true;
}

/** Test seam — clears the memo so a restarted sidecar is picked up. */
export function resetSidecarReachability(): void {
  unreachableSidecars.clear();
}

/**
 * Calls OpenGame lingbot-sidecar (mock by default).
 * Env: LINGBOT_SIDECAR_URL, LINGBOT_ACCEPT_NC_LICENSE, LINGBOT_MODE, LINGBOT_FRAME_NUM.
 */
export class LingBotSpatialBackend implements SpatialBackend {
  readonly id = 'lingbot';
  readonly label = 'LingBot-World v2 (video plugin)';

  constructor(
    private readonly baseUrl = process.env['LINGBOT_SIDECAR_URL'] ??
      'http://127.0.0.1:8091',
    private readonly acceptNc =
      process.env['LINGBOT_ACCEPT_NC_LICENSE'] === 'true',
  ) {}

  async generateRegion(
    req: SpatialGenerateRequest,
  ): Promise<SpatialGenerateResult> {
    const region = req.world.space.regions.find((r) => r.id === req.regionId);
    const prompt =
      req.prompt ??
      buildRegionPrompt(req.world, req.regionId);

    if (!this.acceptNc) {
      return {
        ok: false,
        backend: this.id,
        message:
          'LingBot weights are CC BY-NC-SA 4.0. Set LINGBOT_ACCEPT_NC_LICENSE=true to enable the sidecar (non-commercial / research only).',
        licenseNote: 'CC BY-NC-SA 4.0',
      };
    }

    const root = this.baseUrl.replace(/\/$/, '');

    // A world generate hits every gated region; once we know nothing is
    // listening, stop paying probe + POST per region for the rest of the job.
    if (sidecarRecentlyUnreachable(root)) {
      return {
        ok: false,
        backend: this.id,
        message: `LingBot sidecar not listening at ${root}; skipped (defer to MiniMax poster)`,
        licenseNote: 'CC BY-NC-SA 4.0 (weights); adapter Apache-2.0',
        layoutHint: region?.layoutAscii,
      };
    }

    const actionManifest = worldActionPathToLingBotManifest(defaultExplorePath(), {
      styleHint: req.world.styleAnchor.artStyle,
      framesPerAction: 6,
    });

    // Probe readiness so real→mock when ckpt/repo missing
    let readyReal: boolean | undefined;
    try {
      const healthRes = await fetch(`${root}/health`, {
        signal: AbortSignal.timeout(4000),
      });
      if (healthRes.ok) {
        const h = (await healthRes.json()) as { readyReal?: boolean };
        readyReal = h.readyReal;
      }
    } catch {
      markSidecarUnreachable(root);
      return {
        ok: false,
        backend: this.id,
        message: `LingBot sidecar unreachable at ${root}; defer to MiniMax poster`,
        licenseNote: 'CC BY-NC-SA 4.0 (weights); adapter Apache-2.0',
        layoutHint: region?.layoutAscii,
      };
    }

    const body: LingBotSidecarGenerateBody = {
      prompt,
      regionId: req.regionId,
      worldTitle: req.world.meta.title,
      styleAnchor: req.world.styleAnchor,
      actionManifest,
      frameNum: resolveConsumerFrameNum(
        actionManifest.frameCount,
        req.frameNum,
      ),
      mode: resolveLingBotMode(req.mode, readyReal),
      seedImageUrl: req.seedImageUrl,
    };

    try {
      const url = `${root}/v1/generate`;
      const timeoutMs = Number(process.env['LINGBOT_FETCH_TIMEOUT_MS'] ?? 1_200_000);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return {
          ok: false,
          backend: this.id,
          message: `LingBot sidecar HTTP ${res.status}: ${text.slice(0, 200)}`,
          licenseNote: 'CC BY-NC-SA 4.0',
        };
      }
      const data = (await res.json()) as LingBotSidecarGenerateResponse & {
        fallbackFromReal?: boolean;
      };
      const poster = data.frameUrl ?? data.posterUrl;
      // Prefer data URI / http media URL — never file:// for browsers
      let videoUrl = data.videoUrl;
      if (videoUrl?.startsWith('file:')) {
        videoUrl = data.httpUrl ?? undefined;
      }
      return {
        ok: Boolean(data.ok),
        backend: this.id,
        videoUrl,
        localPath: data.localPath,
        assetUrl: poster ?? videoUrl,
        message:
          data.message ||
          `LingBot ${data.mock ? 'mock' : 'real'} clip for ${region?.name ?? req.regionId}`,
        licenseNote: data.license ?? 'CC BY-NC-SA 4.0',
        layoutHint: region?.layoutAscii,
      };
    } catch (err) {
      // Offline / no sidecar — do NOT stamp 1×1 mock posters.
      // Worker applySpatialResults will MiniMax-generate a real region poster.
      markSidecarUnreachable(root);
      return {
        ok: false,
        backend: 'lingbot',
        assetUrl: undefined,
        videoUrl: undefined,
        message: `LingBot sidecar unreachable for ${region?.name ?? req.regionId}; defer to MiniMax poster (${
          err instanceof Error ? err.message : String(err)
        })`,
        licenseNote: 'CC BY-NC-SA 4.0 (weights); adapter Apache-2.0',
        layoutHint: region?.layoutAscii,
      };
    }
  }
}
