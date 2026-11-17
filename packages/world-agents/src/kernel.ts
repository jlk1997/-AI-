/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pack-agnostic society kernel. Genre packs supply clock, hub, verbs,
 * and gathering copy; locomotion / talk / objects / memory live here.
 */

export {
  createSocietyState,
  finishSocietyTalks,
  runSocietyHours,
  stepLocomotion,
  stepMemory,
  stepMemoryFlush,
  stepObjects,
  stepSociety,
  stepTalk,
} from './tick.js';
export {
  packAllowsGathering,
  resolveSocietyPack,
  type ResolvedSocietyPack,
  type SocietyPackId,
} from './packs.js';
