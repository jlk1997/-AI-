/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Entity } from '../core/Entity.js';
import { registerSkillEffect } from './SkillChain.js';
import type { SkillEffect, SkillEffectKind } from './types.js';

const installedScenes = new WeakSet<object>();

/**
 * Registers built-in skill effect handlers on a Phaser scene (once per scene).
 */
export function installDefaultSkillEffects(sceneLike: unknown): void {
  if (!sceneLike || typeof sceneLike !== 'object') return;
  if (installedScenes.has(sceneLike)) return;
  installedScenes.add(sceneLike);

  const reg = (
    kind: SkillEffectKind | string,
    handler: (entity: Entity, effect: SkillEffect) => void,
  ) => registerSkillEffect(sceneLike, kind as SkillEffectKind, handler);

  reg('addScore', (entity, effect) => {
    const delta = Number(effect.payload?.['delta'] ?? effect.payload?.['amount'] ?? 1);
    const next = (entity.scene.registry.get('score') as number | undefined ?? 0) + delta;
    entity.scene.registry.set('score', next);
    entity.scene.events.emit('og:score', next);
    // Juice: coin / score tick when MiniMax (or aliased) clip is cached
    try {
      const snd = entity.scene.sound;
      const cache = entity.scene.cache.audio;
      if (cache.exists('sfx_coin')) snd.play('sfx_coin', { volume: 0.4 });
      else if (cache.exists('sfx_win')) snd.play('sfx_win', { volume: 0.28 });
    } catch {
      // autoplay / missing
    }
    const winAt = Number(
      effect.payload?.['winAt'] ?? entity.scene.registry.get('winScore') ?? 0,
    );
    if (winAt > 0 && next >= winAt) {
      entity.scene.registry.set('won', true);
      entity.scene.events.emit('og:win', { score: next, winAt });
      try {
        const snd = entity.scene.sound;
        const cache = entity.scene.cache.audio;
        if (cache.exists('sfx_win')) snd.play('sfx_win', { volume: 0.55 });
      } catch {
        // autoplay / missing
      }
    }
  });

  reg('playSound', (entity, effect) => {
    const key = String(effect.payload?.['assetId'] ?? effect.payload?.['key'] ?? '');
    if (key) {
      try {
        entity.scene.sound.play(key, {
          volume: Number(effect.payload?.['volume'] ?? 1),
        });
      } catch {
        // asset may not be loaded
      }
    }
  });

  reg('damage', (entity, effect) => {
    const amount = Number(effect.payload?.['amount'] ?? 1);
    const hp = entity.scene.registry.get('hp') as number | undefined;
    if (hp !== undefined) {
      const next = Math.max(0, hp - amount);
      entity.scene.registry.set('hp', next);
      try {
        const snd = entity.scene.sound;
        const cache = entity.scene.cache.audio;
        if (next <= 0 && cache.exists('sfx_lose')) {
          snd.play('sfx_lose', { volume: 0.5 });
        }
      } catch {
        /* ignore */
      }
    }
  });

  reg('heal', (entity, effect) => {
    const amount = Number(effect.payload?.['amount'] ?? 1);
    const hp = entity.scene.registry.get('hp') as number | undefined;
    if (hp !== undefined) {
      entity.scene.registry.set('hp', hp + amount);
    }
  });

  reg('setState', (entity, effect) => {
    const key = String(effect.payload?.['key'] ?? '');
    const value = effect.payload?.['value'];
    if (key) entity.scene.registry.set(key, value);
  });

  reg('destroy', (entity) => {
    entity.destroy();
  });

  reg('emit', (entity, effect) => {
    const event = String(effect.payload?.['event'] ?? 'skill');
    entity.scene.events.emit(event, effect.payload);
  });

  reg('spawn', (entity, effect) => {
    entity.scene.events.emit('og:spawn', effect.payload ?? {});
  });
}
