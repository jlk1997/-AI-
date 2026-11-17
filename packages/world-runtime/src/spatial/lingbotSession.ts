/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Client for OpenGame lingbot-sidecar interactive sessions.
 * Presentation-only — never treat frames as gameplay authority.
 */

import {
  worldActionToLingBotManifest,
  type LingBotActionManifest,
  type WorldActionKind,
} from './lingbotActionBridge.js';

export interface LingBotSessionCreateRequest {
  readonly prompt: string;
  readonly regionId: string;
  readonly worldTitle?: string;
  readonly styleAnchor?: {
    artStyle?: string;
    palette?: string[];
    mood?: string;
  };
  readonly seedImageUrl?: string;
  readonly mode?: 'mock' | 'real';
}

export interface LingBotSessionStepRequest {
  readonly action?: WorldActionKind;
  readonly wasd?: string;
  readonly textEvent?: string;
  readonly yawDelta?: number;
  readonly pitchDelta?: number;
  readonly holdFrames?: number;
}

export interface LingBotSessionState {
  readonly sessionId: string;
  readonly mode: string;
  frameUrl?: string;
  videoUrl?: string;
  step: number;
  readonly license?: string;
}

export class LingBotSessionClient {
  constructor(
    private readonly baseUrl = process.env['LINGBOT_SIDECAR_URL'] ??
      'http://127.0.0.1:8091',
  ) {}

  private root(): string {
    return this.baseUrl.replace(/\/$/, '');
  }

  async health(): Promise<{
    ok: boolean;
    mode?: string;
    sessions?: number;
    profile?: string;
    readyReal?: boolean;
    weightsReady?: boolean;
    weights?: {
      weightsReady?: boolean;
      shardComplete?: number;
      shardExpected?: number;
      canSwitchReal?: boolean;
    };
    ckpt?: string | null;
    repo?: string | null;
    seedImage?: string | null;
    gpu?: {
      ok?: boolean;
      name?: string;
      vramTotalMb?: number;
      vramFreeMb?: number;
      count?: number;
      consumerLikely?: boolean;
    };
    recommended?: {
      nproc?: number;
      frameNum?: number;
      size?: string;
      timeoutSec?: number;
      fallbackMock?: boolean;
    };
    warnings?: string[];
    note?: string;
  }> {
    try {
      const res = await fetch(`${this.root()}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return { ok: false };
      return (await res.json()) as {
        ok: boolean;
        mode?: string;
        sessions?: number;
        profile?: string;
        readyReal?: boolean;
        ckpt?: string | null;
        repo?: string | null;
        seedImage?: string | null;
        gpu?: {
          ok?: boolean;
          name?: string;
          vramTotalMb?: number;
          vramFreeMb?: number;
          count?: number;
          consumerLikely?: boolean;
        };
        recommended?: {
          nproc?: number;
          frameNum?: number;
          size?: string;
          timeoutSec?: number;
          fallbackMock?: boolean;
        };
        warnings?: string[];
        note?: string;
      };
    } catch {
      return { ok: false };
    }
  }

  async createSession(
    req: LingBotSessionCreateRequest,
  ): Promise<LingBotSessionState> {
    const res = await fetch(`${this.root()}/v1/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      throw new Error(`LingBot session create failed: HTTP ${res.status}`);
    }
    const data = (await res.json()) as {
      sessionId: string;
      mode: string;
      frameUrl?: string;
      videoUrl?: string;
      license?: string;
    };
    return {
      sessionId: data.sessionId,
      mode: data.mode,
      frameUrl: data.frameUrl,
      videoUrl: data.videoUrl,
      step: 0,
      license: data.license,
    };
  }

  async step(
    sessionId: string,
    req: LingBotSessionStepRequest,
  ): Promise<LingBotSessionState> {
    const res = await fetch(`${this.root()}/v1/sessions/${sessionId}/step`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      throw new Error(`LingBot step failed: HTTP ${res.status}`);
    }
    const data = (await res.json()) as {
      sessionId: string;
      step: number;
      frameUrl?: string;
      message?: string;
      license?: string;
    };
    return {
      sessionId: data.sessionId,
      mode: 'session',
      frameUrl: data.frameUrl,
      step: data.step,
      license: data.license,
    };
  }

  async stepAction(
    sessionId: string,
    action: WorldActionKind,
    textEvent?: string,
  ): Promise<LingBotSessionState> {
    const manifest = worldActionToLingBotManifest(action, { holdFrames: 4 });
    return this.step(sessionId, {
      action,
      wasd: manifest.frames[0]?.wasd,
      textEvent: textEvent ?? manifest.frames[0]?.textEvent,
      holdFrames: 4,
    });
  }

  async close(sessionId: string): Promise<{ actionPath?: unknown }> {
    const res = await fetch(`${this.root()}/v1/sessions/${sessionId}`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return {};
    return (await res.json()) as { actionPath?: unknown };
  }

  async convertAction(
    manifest: LingBotActionManifest,
    writeNpy = false,
  ): Promise<{ ok: boolean; dir?: string; npy?: boolean; message?: string }> {
    const res = await fetch(`${this.root()}/v1/convert-action`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ actionManifest: manifest, writeNpy }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return { ok: false, message: `HTTP ${res.status}` };
    return (await res.json()) as {
      ok: boolean;
      dir?: string;
      npy?: boolean;
      message?: string;
    };
  }

  /** Offline clip from session action_path (档 B — not real-time /step). */
  async generateClip(
    sessionId: string,
    opts?: { mode?: 'mock' | 'real'; frameNum?: number },
  ): Promise<{
    ok: boolean;
    videoUrl?: string;
    httpUrl?: string;
    localPath?: string;
    message?: string;
    mock?: boolean;
    fallbackFromReal?: boolean;
    realError?: string;
    profile?: string;
  }> {
    const timeoutMs = Number(process.env['LINGBOT_FETCH_TIMEOUT_MS'] ?? 1_200_000);
    const res = await fetch(
      `${this.root()}/v1/sessions/${sessionId}/generate`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(opts ?? {}),
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, message: `HTTP ${res.status}: ${text.slice(0, 200)}` };
    }
    return (await res.json()) as {
      ok: boolean;
      videoUrl?: string;
      httpUrl?: string;
      localPath?: string;
      message?: string;
      mock?: boolean;
      fallbackFromReal?: boolean;
      realError?: string;
      profile?: string;
    };
  }
}
