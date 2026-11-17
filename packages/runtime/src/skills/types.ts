/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Entity } from '../core/Entity.js';

export type SkillTriggerKind =
  | 'onTick'
  | 'onKey'
  | 'onPointerDown'
  | 'onCollision'
  | 'onTimer'
  | 'manual';

export interface SkillTrigger {
  readonly kind: SkillTriggerKind;
  readonly key?: string;
  readonly otherTag?: string;
  readonly periodSec?: number;
}

export type SkillEffectKind =
  | 'spawn'
  | 'damage'
  | 'heal'
  | 'destroy'
  | 'emit'
  | 'setState'
  | 'addScore'
  | 'playSound';

export interface SkillEffect {
  readonly kind: SkillEffectKind;
  readonly payload?: Record<string, unknown>;
}

export interface SkillDef {
  readonly id: string;
  readonly trigger: SkillTrigger;
  readonly effects: ReadonlyArray<SkillEffect>;
  readonly cooldownSec?: number;
}

export type SkillEffectHandler = (
  entity: Entity,
  effect: SkillEffect,
) => void;
