/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * en-US place bags for Intent IR. Locale pack — not the compiler core.
 */

export const EN_PLACE_PROMISE_RULES: ReadonlyArray<{
  readonly re: RegExp;
  readonly places: readonly string[];
}> = [
  {
    re: /fishing.?village|fish.?dock|\bdock\b|boatyard|net.?yard/i,
    places: ['dock', 'boatyard', 'net yard'],
  },
  {
    re: /space.?station|starship|sleep.?bay|greenhouse.?bay/i,
    places: ['bridge', 'greenhouse', 'sleep bay'],
  },
  {
    re: /cargo.?ship|canal.?boat|\bgalley\b|\bdeck\b.*\bcabin\b/i,
    places: ['deck', 'cabin', 'galley'],
  },
  {
    re: /monastery|cloister|abbey|scriptorium/i,
    places: ['chapel', 'scriptorium', 'garden'],
  },
  {
    re: /night.?market|lantern.?lane|grill.?shed/i,
    places: ['night market', 'grill shed', 'lantern lane'],
  },
];

export const EN_FALLBACK_PLACE_BAGS: ReadonlyArray<readonly string[]> = [
  ['dock', 'boatyard', 'net yard'],
  ['kiln', 'ore shed', 'lamp house'],
  ['night market', 'grill shed', 'lantern lane'],
  ['tea house', 'chess table', 'pastry shop'],
  ['pasture', 'stable', 'hay shed'],
  ['temple', 'incense altar', 'bell tower'],
  ['ferry', 'wharf', 'waiting shed'],
  ['night school', 'chalk room', 'yard'],
];

export const EN_PLACE_OCCUPATIONS: Readonly<Record<string, string>> = {
  dock: 'fisher',
  boatyard: 'shipwright',
  'boat yard': 'shipwright',
  'net yard': 'net mender',
  bridge: 'watch officer',
  greenhouse: 'gardener',
  'sleep bay': 'bay steward',
  deck: 'sailor',
  cabin: 'bosun',
  galley: 'cook',
  chapel: 'officiant',
  scriptorium: 'copyist',
  garden: 'gardener',
  'night market': 'stall keeper',
  'grill shed': 'night cook',
  'lantern lane': 'lantern maker',
  kiln: 'kiln hand',
  'ore shed': 'sorter',
  'lamp house': 'lamp keeper',
  alley: 'watch',
  well: 'drawer',
  arcade: 'keeper',
  gathering: 'host',
  workshop: 'maker',
  quarters: 'steward',
  corridor: 'steward',
  lock: 'lock tender',
  'cloister walk': 'walker',
  cells: 'novice',
};

export const EN_PLACE_SLUGS: Readonly<Record<string, string>> = {
  dock: 'dock',
  boatyard: 'boat_yard',
  'boat yard': 'boat_yard',
  'net yard': 'net_yard',
  bridge: 'bridge',
  greenhouse: 'greenhouse',
  'sleep bay': 'sleep_bay',
  deck: 'deck',
  cabin: 'cabin',
  galley: 'galley',
  chapel: 'chapel',
  scriptorium: 'scriptorium',
  garden: 'garden',
  'night market': 'night_market',
  'grill shed': 'grill_shed',
  'lantern lane': 'lantern_lane',
  kiln: 'kiln',
  'ore shed': 'ore_shed',
  'lamp house': 'lamp_house',
  alley: 'alley',
  well: 'well',
  arcade: 'arcade',
  gathering: 'gathering',
  workshop: 'workshop',
  quarters: 'quarters',
  corridor: 'corridor',
  lock: 'lock',
  'cloister walk': 'cloister_walk',
  cells: 'cells',
};
