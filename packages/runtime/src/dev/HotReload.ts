/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type Phaser from 'phaser';

import { compileDslToScenes } from '../dsl/loader.js';
import { sceneStartCandidates, type GameDsl } from '../dsl/schema.js';

import { tunables } from './TunableRegistry.js';

export type HotReloadMessage =
  | { kind: 'opengame:reload-dsl'; dsl: GameDsl }
  | { kind: 'opengame:tunable-set'; entityId: string; key: string; value: number | string | boolean }
  | { kind: 'opengame:request-tunables' }
  | {
      kind: 'opengame:tunables';
      entries: ReadonlyArray<{
        entityId: string;
        key: string;
        type: 'number' | 'string' | 'boolean';
        value: number | string | boolean;
        min?: number;
        max?: number;
        step?: number;
        label?: string;
      }>;
    };

interface HotReloadOptions {
  readonly game: Phaser.Game;
  readonly onTunableChange?: (entityId: string, key: string, value: unknown) => void;
}

/**
 * Wires `window.postMessage` <-> Phaser so the IDE can:
 *   - swap the entire game.json without a page reload
 *   - tune any `tunable` declared in the DSL on the fly
 *
 * `enableHotReload` is **dev only** by convention; the skeleton wraps it in
 * `if (import.meta.env.DEV) { ... }` so the build artifact stays clean.
 */
export function enableHotReload(opts: HotReloadOptions): () => void {
  const onMessage = (event: MessageEvent): void => {
    const data = event.data as HotReloadMessage | undefined;
    if (!data || typeof data !== 'object') return;
    if (data.kind === 'opengame:reload-dsl') {
      try {
        const { sceneClasses, initialKey } = compileDslToScenes(data.dsl);
        // customModule-only games register Scenes via bootstrap({ extraScenes }).
        // Wiping the scene manager here would brick Title/Level/GameOver and leave
        // a black / Game-Over loop. Tunables still work via other message kinds.
        if (sceneClasses.length === 0) {
          console.warn(
            '[opengame/hot] reload-dsl skipped: DSL has no compileable scenes (extraScenes/customModule game)',
          );
          return;
        }
        // Phaser doesn't expose a clean "swap all scenes" helper, so we
        // teardown existing keys then add+start the new ones.
        for (const s of opts.game.scene.scenes.slice()) {
          opts.game.scene.remove(s.scene.key);
        }
        sceneClasses.forEach((klass, i) => {
          opts.game.scene.add(`__og_hot_${i}`, klass as never, false);
        });
        const hotKey = '__og_hot_0';
        if (opts.game.scene.getScene(hotKey)) {
          opts.game.scene.start(hotKey);
        } else {
          for (const key of sceneStartCandidates(data.dsl, initialKey)) {
            if (opts.game.scene.getScene(key)) {
              opts.game.scene.start(key);
              break;
            }
          }
        }
      } catch (err) {
        console.error('[opengame/hot] reload failed:', err);
      }
    } else if (data.kind === 'opengame:tunable-set') {
      tunables.set(data.entityId, data.key, data.value);
      opts.onTunableChange?.(data.entityId, data.key, data.value);
    } else if (data.kind === 'opengame:request-tunables') {
      const replyTarget = event.source as Window | null;
      if (!replyTarget) return;
      replyTarget.postMessage(
        {
          kind: 'opengame:tunables',
          entries: tunables.list().map((t) => ({
            entityId: t.entityId,
            key: t.key,
            type: t.spec.type,
            value: t.spec.value,
            ...(t.spec.min !== undefined ? { min: t.spec.min } : {}),
            ...(t.spec.max !== undefined ? { max: t.spec.max } : {}),
            ...(t.spec.step !== undefined ? { step: t.spec.step } : {}),
            ...(t.spec.label !== undefined ? { label: t.spec.label } : {}),
          })),
        } satisfies HotReloadMessage,
        '*',
      );
    }
  };
  window.addEventListener('message', onMessage);
  return () => window.removeEventListener('message', onMessage);
}

/**
 * Post a tunable update from outside the iframe (e.g. from the IDE's
 * TunablePanel). Returns false when called in a non-browser context.
 */
export function postTunable(
  target: Window,
  entityId: string,
  key: string,
  value: number | string | boolean,
): boolean {
  if (typeof window === 'undefined') return false;
  target.postMessage(
    { kind: 'opengame:tunable-set', entityId, key, value } satisfies HotReloadMessage,
    '*',
  );
  return true;
}
