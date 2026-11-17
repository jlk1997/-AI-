/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 3: pluggable spatial backends (Marble-like / Meshy / local Three).
 * OpenGame owns World Spec consistency; backends only produce spatial assets.
 */

import type { WorldSpec } from '@opengame/world-spec';

import { LingBotSpatialBackend } from './lingbot.js';

export interface SpatialGenerateRequest {
  readonly world: WorldSpec;
  readonly regionId: string;
  readonly prompt?: string;
  /** Override consumer short-clip frame count (e.g. 17 on RTX 4070). */
  readonly frameNum?: number;
  readonly mode?: 'mock' | 'real';
  /** Optional I2V / cinematic seed (MiniMax image URL or data URI). */
  readonly seedImageUrl?: string;
}

export interface SpatialGenerateResult {
  readonly ok: boolean;
  readonly backend: string;
  /** glTF / splat / scene-graph URL or data URI when available. */
  readonly assetUrl?: string;
  /** Interactive / cinematic video URL (e.g. LingBot-World-v2). */
  readonly videoUrl?: string;
  /** Absolute path on the sidecar/worker host (never ship file:// to browsers). */
  readonly localPath?: string;
  readonly layoutHint?: string;
  readonly message: string;
  /** License reminder for non-Apache backends (e.g. CC BY-NC-SA). */
  readonly licenseNote?: string;
}

export interface SpatialBackend {
  readonly id: string;
  readonly label: string;
  generateRegion(req: SpatialGenerateRequest): Promise<SpatialGenerateResult>;
}

/** Stub backend — records intent without calling external APIs. */
export class NullSpatialBackend implements SpatialBackend {
  readonly id = 'null';
  readonly label = 'Null (2D only)';

  async generateRegion(
    req: SpatialGenerateRequest,
  ): Promise<SpatialGenerateResult> {
    const region = req.world.space.regions.find((r) => r.id === req.regionId);
    return {
      ok: true,
      backend: this.id,
      message: `Skipped 3D generate for ${region?.name ?? req.regionId}; using Phaser 2D presenter.`,
      layoutHint: region?.layoutAscii,
    };
  }
}

/**
 * Placeholder for World Labs Marble / similar APIs.
 * Configure via env WORLD_SPATIAL_BACKEND=marble and WORLD_SPATIAL_API_KEY.
 */
export class MarbleSpatialBackend implements SpatialBackend {
  readonly id = 'marble';
  readonly label = 'World Labs Marble (plugin)';

  constructor(
    private readonly apiKey: string | undefined,
    private readonly baseUrl = 'https://api.worldlabs.ai',
  ) {}

  async generateRegion(
    req: SpatialGenerateRequest,
  ): Promise<SpatialGenerateResult> {
    if (!this.apiKey) {
      return {
        ok: false,
        backend: this.id,
        message:
          'WORLD_SPATIAL_API_KEY not set — cannot call Marble. Falling back to 2D.',
      };
    }
    const region = req.world.space.regions.find((r) => r.id === req.regionId);
    const prompt =
      req.prompt ??
      `${req.world.styleAnchor.artStyle} 3D world region: ${region?.name}. ${region?.description ?? ''}`;
    // Product path: Marble is not wired — refuse silently green stub.
    return {
      ok: false,
      backend: this.id,
      assetUrl: undefined,
      videoUrl: undefined,
      message:
        `Marble backend is a stub (no public API). Use spatialBackend=lingbot or null. ` +
        `Refused fake generate for "${prompt.slice(0, 80)}…"`,
    };
  }
}

/** Local Three.js scene-graph exporter (metadata only in Phase 3 scaffold). */
export class ThreeSpatialBackend implements SpatialBackend {
  readonly id = 'three';
  readonly label = 'Three.js scene graph';

  async generateRegion(
    req: SpatialGenerateRequest,
  ): Promise<SpatialGenerateResult> {
    const region = req.world.space.regions.find((r) => r.id === req.regionId);
    const sceneGraph = {
      type: 'Scene',
      name: region?.name ?? req.regionId,
      children: req.world.entities
        .filter((e) => e.regionId === req.regionId)
        .map((e) => ({
          type: 'Object3D',
          name: e.name,
          position: [e.pos.x, 0, e.pos.y],
          userData: { entityId: e.id, kind: e.kind },
        })),
    };
    const dataUri = `data:application/json,${encodeURIComponent(JSON.stringify(sceneGraph))}`;
    return {
      ok: true,
      backend: this.id,
      assetUrl: dataUri,
      message: `Built Three scene-graph for ${region?.name ?? req.regionId}`,
    };
  }
}

export function resolveSpatialBackend(
  id?: string,
  apiKey?: string,
): SpatialBackend {
  const key = (id ?? process.env['WORLD_SPATIAL_BACKEND'] ?? 'null').toLowerCase();
  const token = apiKey ?? process.env['WORLD_SPATIAL_API_KEY'];
  switch (key) {
    case 'marble':
      return new MarbleSpatialBackend(token);
    case 'three':
      return new ThreeSpatialBackend();
    case 'lingbot':
    case 'lingbot-world':
    case 'lingbot-world-v2':
      return new LingBotSpatialBackend();
    default:
      return new NullSpatialBackend();
  }
}
