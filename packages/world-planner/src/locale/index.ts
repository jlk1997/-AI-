/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

export {
  coversPromisedPlace,
  coversPromisedPlaceLoose,
  coversPromisedOccupation,
  extractPlacePromises,
  isMostlyAsciiText,
  occupationForPlace,
  PLACE_OCCUPATIONS,
  PLACE_SLUGS,
} from './extractPlaces.js';
export {
  defaultOccupation,
  emptyPlacesFor,
  fillerPlacesFor,
  npcProse,
  residentPool,
  societyMetaCopy,
} from './residents.js';
export { extraRegionCopy, societyPadsFor } from './pads.js';
export type { SocietyPad } from './pads.js';
export { stanceCardFor, stampMissingStanceCards } from './stanceCard.js';
