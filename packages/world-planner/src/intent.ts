/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Compile-time intent extracted from a world prompt. Not persisted.
 */

import {
  clampNamedResidentCount,
  genreProfileById,
  genreProfileWithPopulation,
  SCAFFOLD_TOWN_REGION_IDS,
  type GenreProfile,
} from '@opengame/world-spec';
import {
  extractPlacePromises,
  occupationForPlace,
} from './locale/extractPlaces.js';
import {
  extractResidentPromises,
  type ResidentPromise,
} from './locale/extractResidents.js';

export type { ResidentPromise };

export type IntentPackId = GenreProfile['id'];

export interface IntentIR {
  readonly packId: IntentPackId;
  readonly places: readonly string[];
  readonly occupations: readonly string[];
  /** Named people from the prompt — must not be overwritten by residentPool. */
  readonly residents: readonly ResidentPromise[];
  readonly populationHint?: number;
  readonly classicTown: boolean;
  readonly profile: GenreProfile;
  /** Scaffold town ids the synthesizer must not emit (empty for classic town). */
  readonly forbiddenIds: readonly string[];
}

const CLASSIC_TOWN_RE =
  /城镇广场|住宅巷|学堂院|客栈巷|斯坦福小镇|stanford\s*town|town\s*square|home_row/;

/** Users write 不要塌回无名广场模板 — that is a prohibition, not a classic-town request. */
const CLASSIC_TOWN_NEGATION_RE =
  /不要.{0,24}(无名广场|城镇广场|斯坦福|广场模板|square)|别.{0,16}(塌回|无名广场|斯坦福)|勿(?:要|用).{0,16}(广场|斯坦福)|don'?t.{0,32}(town.?square|nameless square|generic square)|not (?:to |a |the )?(?:generic )?(?:town )?square/i;

export function isClassicTownPrompt(prompt: string): boolean {
  if (CLASSIC_TOWN_NEGATION_RE.test(prompt)) return false;
  return CLASSIC_TOWN_RE.test(prompt);
}

const CREW_RE =
  /空间站|船员|货船|舰桥|休眠舱|运河船|潜艇|舱室|值班|温室舱|space.?station|starship|cargo.?ship|sleep.?bay|watch.?rotation|\bcrew\b|\bvessel\b|\bgalley\b/;
const CLOISTER_RE = /修道院|礼拜堂|抄经|日课|僧院|monastery|cloister|abbey|scriptorium/;

export function parsePopulationHint(prompt: string): number | undefined {
  const named =
    prompt.match(/至少\s*(\d{1,3})\s*名/) ??
    prompt.match(/共\s*(\d{1,3})\s*名/) ??
    prompt.match(/at least\s+(\d{1,3})\s+named/i);
  if (named) return clampNamedResidentCount(Number(named[1]));
  // Pack leftovers like「约 18–25 人」must not override「至少 10 名」.
  const stripped = prompt.replace(
    /\d{1,3}\s*[–—-]\s*\d{1,3}\s*(?:人|people)/gi,
    '',
  );
  const m =
    stripped.match(/约\s*(\d{1,3})\s*人/) ??
    stripped.match(/(\d{1,3})\s*人/) ??
    stripped.match(/(\d{1,3})\s*(?:people|crew|residents|npcs?)\b/i) ??
    stripped.match(/\b(?:crew|team|population)\s+(?:of\s+)?(\d{1,3})\b/i);
  if (!m) return undefined;
  return clampNamedResidentCount(Number(m[1]));
}

export function inferPackId(prompt: string): IntentPackId {
  if (CLOISTER_RE.test(prompt)) return 'society.cloister';
  if (CREW_RE.test(prompt)) return 'society.crew';
  return 'society.town';
}

export type IntentParseOptions = {
  readonly populationHint?: number;
  /** Structured create brief — wins over keyword pack inference. */
  readonly packId?: IntentPackId;
  /** Structured create brief places — prepended, skip hash bags when set. */
  readonly places?: readonly string[];
};

export function parseIntentFromPrompt(
  prompt: string,
  options?: IntentParseOptions,
): IntentIR {
  const packId = options?.packId ?? inferPackId(prompt);
  const baseProfile = genreProfileById(packId);
  const classicTown = isClassicTownPrompt(prompt);
  const briefPlaces = (options?.places ?? [])
    .map((p) => p.trim())
    .filter((p) => p.length >= 2);
  // Structured brief places win; do not let prompt keywords / hash bags add a plaza.
  const places = briefPlaces.length
    ? [...new Set(briefPlaces)].slice(0, 6)
    : [...new Set(extractPlacePromises(prompt, packId))].slice(0, 6);
  const residents = extractResidentPromises(prompt);
  const occupations = [
    ...residents.map((r) => r.occupation).filter((o): o is string => Boolean(o)),
    ...places.map((p) => occupationForPlace(p)).filter((o): o is string => Boolean(o)),
  ].filter((o, i, all) => all.indexOf(o) === i);
  const fromPopPrompt = parsePopulationHint(prompt);
  const fromOpts = options?.populationHint;
  const rawHint =
    fromOpts != null && Number.isFinite(fromOpts)
      ? Math.round(fromOpts)
      : fromPopPrompt;
  const populationHint =
    rawHint != null ? clampNamedResidentCount(rawHint) : undefined;
  const profile =
    populationHint != null
      ? genreProfileWithPopulation(baseProfile, populationHint)
      : baseProfile;
  return {
    packId,
    places,
    occupations,
    residents,
    ...(populationHint != null ? { populationHint } : {}),
    classicTown,
    profile,
    forbiddenIds: classicTown ? [] : [...SCAFFOLD_TOWN_REGION_IDS],
  };
}
