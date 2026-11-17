/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { Component } from '../core/Component.js';
import type { Entity } from '../core/Entity.js';

import type {
  SkillDef,
  SkillEffect,
  SkillEffectHandler,
  SkillEffectKind,
} from './types.js';

/**
 * Attach a SkillChain to an Entity and the runtime dispatches its triggers
 * each tick (`onTick` / `onTimer`), or via DOM-style listeners (`onKey` /
 * `onPointerDown`). Each fired skill resolves its effects through the
 * scene-level registry so consumer games can plug custom effects without
 * subclassing.
 */
export class SkillChain extends Component {
  override readonly key = 'skillChain';
  private readonly skills: ReadonlyArray<SkillDef>;
  private readonly cooldowns: Map<string, number>;
  private readonly timerAccum: Map<string, number>;
  private readonly keyListeners: Array<() => void> = [];

  constructor(skills: ReadonlyArray<SkillDef>) {
    super();
    this.skills = skills;
    this.cooldowns = new Map();
    this.timerAccum = new Map();
  }

  override attach(entity: Entity): void {
    const scene = entity.scene;
    for (const skill of this.skills) {
      if (skill.trigger.kind === 'onKey' && skill.trigger.key) {
        const key = scene.input.keyboard?.addKey(skill.trigger.key);
        if (key) {
          const onDown = (): void => this.tryFire(entity, skill.id);
          key.on('down', onDown);
          this.keyListeners.push(() => key.off('down', onDown));
        }
      } else if (skill.trigger.kind === 'onPointerDown') {
        const onPointer = (): void => this.tryFire(entity, skill.id);
        scene.input.on('pointerdown', onPointer);
        this.keyListeners.push(() => scene.input.off('pointerdown', onPointer));
      }
    }
  }

  override update(entity: Entity, dt: number): void {
    for (const [id, remaining] of this.cooldowns) {
      const next = remaining - dt;
      if (next <= 0) {
        this.cooldowns.delete(id);
      } else {
        this.cooldowns.set(id, next);
      }
    }
    for (const skill of this.skills) {
      if (skill.trigger.kind === 'onTick') {
        this.tryFire(entity, skill.id);
      } else if (skill.trigger.kind === 'onTimer' && skill.trigger.periodSec) {
        const accum = (this.timerAccum.get(skill.id) ?? 0) + dt;
        if (accum >= skill.trigger.periodSec) {
          this.timerAccum.set(skill.id, accum - skill.trigger.periodSec);
          this.tryFire(entity, skill.id);
        } else {
          this.timerAccum.set(skill.id, accum);
        }
      }
    }
  }

  override detach(_entity: Entity): void {
    for (const off of this.keyListeners) off();
    this.keyListeners.length = 0;
  }

  fire(entity: Entity, id: string): void {
    this.tryFire(entity, id);
  }

  private tryFire(entity: Entity, id: string): void {
    if (this.cooldowns.has(id)) return;
    const skill = this.skills.find((s) => s.id === id);
    if (!skill) return;
    const registry = getSkillEffectRegistry(entity);
    for (const effect of skill.effects) {
      const handler = registry.get(effect.kind);
      if (handler) handler(entity, effect);
    }
    if (skill.cooldownSec && skill.cooldownSec > 0) {
      this.cooldowns.set(id, skill.cooldownSec);
    }
  }
}

interface SkillCarrier {
  __ogSkillEffects?: Map<SkillEffectKind, SkillEffectHandler>;
}

function getSkillEffectRegistry(
  entity: Entity,
): Map<SkillEffectKind, SkillEffectHandler> {
  const scene = entity.scene as unknown as SkillCarrier;
  if (!scene.__ogSkillEffects) {
    scene.__ogSkillEffects = new Map<SkillEffectKind, SkillEffectHandler>();
  }
  return scene.__ogSkillEffects;
}

export function registerSkillEffect(
  sceneLike: unknown,
  kind: SkillEffectKind,
  handler: SkillEffectHandler,
): void {
  const scene = sceneLike as SkillCarrier;
  if (!scene.__ogSkillEffects) {
    scene.__ogSkillEffects = new Map<SkillEffectKind, SkillEffectHandler>();
  }
  scene.__ogSkillEffects.set(kind, handler);
}

export type { SkillDef, SkillEffect, SkillEffectKind, SkillEffectHandler };
