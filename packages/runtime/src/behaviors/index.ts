/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

export { Behavior } from './IBehavior.js';
export { Patrol, type PatrolOptions } from './Patrol.js';
export { Chase, type ChaseOptions } from './Chase.js';
export { Shoot, type ShootOptions } from './Shoot.js';
export { EightWayMovement, type EightWayMovementOptions } from './EightWayMovement.js';
export { Dialog, type DialogOptions, type DialogLine } from './Dialog.js';
export {
  SceneTransition,
  CollectOnTouch,
  DamageOnTouch,
  type SceneTransitionOptions,
  type CollectOnTouchOptions,
  type DamageOnTouchOptions,
} from './WorldLink.js';
export {
  Velocity,
  Lifetime,
  Spawner,
  Bounds,
  Draggable,
  GridSnap,
  type VelocityOptions,
  type LifetimeOptions,
  type SpawnerOptions,
  type BoundsOptions,
  type GridSnapOptions,
} from './extras.js';

/**
 * Capability category cheatsheet for the Planner Agent. Each entry maps a
 * game category to the runtime exports it should reach for first. We export
 * this so the Planner Playbook stays in lockstep with code (and so external
 * docs can be generated from it later).
 */
export const CAPABILITY_CATEGORIES = {
  arcade: ['Velocity', 'Bounds', 'Lifetime', 'Spawner', 'Shoot'],
  platformer: ['EightWayMovement', 'Bounds'],
  top_down: ['EightWayMovement', 'Chase', 'Patrol'],
  shooter: ['Shoot', 'Velocity', 'Lifetime', 'Spawner', 'Bounds'],
  puzzle: ['GridSnap', 'Draggable', 'Bounds'],
  match3: ['GridSnap', 'Draggable'],
  tower_defense: ['Patrol', 'Shoot', 'Spawner'],
  rpg: [
    'EightWayMovement',
    'Dialog',
    'Chase',
    'SceneTransition',
    'CollectOnTouch',
    'DamageOnTouch',
  ],
  visual_novel: ['Dialog'],
  endless_runner: ['Velocity', 'Spawner', 'Bounds'],
  bullet_hell: ['Spawner', 'Shoot', 'Velocity', 'Bounds', 'Lifetime'],
} as const;
export type CapabilityCategory = keyof typeof CAPABILITY_CATEGORIES;
