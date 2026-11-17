/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

export * from './core/index.js';
export * from './behaviors/index.js';
export * from './skills/index.js';
export * from './ui/index.js';
export * from './services/index.js';
export * from './dsl/index.js';
export * from './dev/index.js';
export * from './input/index.js';
export { bootstrap, pickBootSceneKey, type BootstrapOptions } from './bootstrap.js';
export { applyJiaxiMessage, installJiaxiBus, type JiaxiMessage } from './jiaxiBus.js';

export const RUNTIME_VERSION = '0.1.0' as const;
