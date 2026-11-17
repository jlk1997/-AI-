/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

export {
  DSL_VERSION,
  normalizeGameDsl,
  validateGameDsl,
  isPlausibleDataImageUrl,
  sceneDeferredToCustomPhaser,
  sceneIsLayoutOnly,
  sceneSkippedByDslCompile,
  sceneStartCandidates,
  type GameDsl,
  type GameMeta,
  type AssetRef,
  type EntitySpec,
  type BehaviorSpec,
  type TunableSpec,
  type SceneSpec,
} from './schema.js';

export {
  INITIAL_SCENE,
  compileDslToScenes,
  registerBehavior,
} from './loader.js';
export { DialogueRunner } from './DialogueRunner.js';
export { EntityStateRegistry } from '../core/EntityState.js';
