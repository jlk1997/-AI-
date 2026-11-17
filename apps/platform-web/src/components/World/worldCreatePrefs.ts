/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Standing choices for the first world generate. Art style is shared with
 * `opengame_art_style_id`; pack / scene / venues live here so generate
 * composes a unique brief instead of matching a demo-town seed.
 */

import {
  DEFAULT_ART_STYLE_ID,
  isArtStyleId,
  type ArtStyleId,
} from '@opengame/world-spec';

import { readStoredArtStyleId, storeArtStyleId } from '../Params/ArtStyleBar';

export type WorldScaleId = 'compact' | 'standard' | 'crowded' | 'large' | 'city';
export type WorldLivedInId = 'dawn' | 'morning' | 'full_day' | 'long_day';
export type WorldPackId = 'society.town' | 'society.crew' | 'society.cloister';
export type WorldUseCaseId =
  | 'xiangyi'
  | 'showcase'
  | 'campus'
  | 'workplace'
  | 'scenic'
  | 'courtyard';
export type WorldVenueId =
  | 'night_market'
  | 'wharf'
  | 'kiln'
  | 'school'
  | 'mine'
  | 'workshop'
  | 'inn'
  | 'teahouse'
  | 'herb_hut'
  | 'hunting_ground'
  | 'coop'
  | 'bridge'
  | 'greenhouse'
  | 'sleep_bay'
  | 'chapel'
  | 'scriptorium'
  | 'garden';

export interface WorldCreatePrefs {
  readonly artStyleId: ArtStyleId;
  readonly scale: WorldScaleId;
  readonly livedIn: WorldLivedInId;
  readonly packId: WorldPackId;
  readonly useCase: WorldUseCaseId;
  readonly venues: readonly WorldVenueId[];
  /** Person one, e.g. "林嫂，夜市摊主". */
  readonly castA: string;
  /** Person two, e.g. "阿禾，补网人". */
  readonly castB: string;
  /** Tonight's talk — one sentence. */
  readonly rumor: string;
  /** Composed sentence sent to generate. Kept for older stored prefs. */
  readonly note: string;
}

export const WORLD_SCALE_POPULATION: Record<WorldScaleId, number> = {
  compact: 10,
  standard: 22,
  crowded: 36,
  /** Shown only when the demo open-world flag is on. Server still clamps. */
  large: 100,
  /** Needs OPENGAME_MAX_NAMED_RESIDENTS at or above this. Portraits stay shared. */
  city: 300,
};

export const WORLD_LIVED_IN_HOURS: Record<WorldLivedInId, number> = {
  dawn: 4,
  morning: 8,
  full_day: 16,
  long_day: 24,
};

export const WORLD_SCALE_IDS: readonly WorldScaleId[] = [
  'compact',
  'standard',
  'crowded',
];

export const WORLD_LIVED_IN_IDS: readonly WorldLivedInId[] = [
  'dawn',
  'morning',
  'full_day',
  'long_day',
];

export const WORLD_PACK_ID_LIST: readonly WorldPackId[] = [
  'society.town',
  'society.crew',
  'society.cloister',
];

export const WORLD_USE_CASE_ID_LIST: readonly WorldUseCaseId[] = [
  'xiangyi',
  'showcase',
  'campus',
  'workplace',
  'scenic',
  'courtyard',
];

export const WORLD_VENUE_ID_LIST: readonly WorldVenueId[] = [
  'night_market',
  'wharf',
  'kiln',
  'school',
  'mine',
  'workshop',
  'inn',
  'teahouse',
  'herb_hut',
  'hunting_ground',
  'coop',
  'bridge',
  'greenhouse',
  'sleep_bay',
  'chapel',
  'scriptorium',
  'garden',
];

const STORE_KEY = 'opengame_world_create_prefs';

const DEFAULT_PREFS: WorldCreatePrefs = {
  artStyleId: DEFAULT_ART_STYLE_ID,
  scale: 'standard',
  livedIn: 'full_day',
  packId: 'society.town',
  useCase: 'xiangyi',
  venues: ['night_market', 'teahouse'],
  castA: '',
  castB: '',
  rumor: '',
  note: '',
};

function isScaleId(value: unknown): value is WorldScaleId {
  return (
    value === 'compact' ||
    value === 'standard' ||
    value === 'crowded' ||
    value === 'large' ||
    value === 'city'
  );
}

function isLivedInId(value: unknown): value is WorldLivedInId {
  return (
    value === 'dawn' ||
    value === 'morning' ||
    value === 'full_day' ||
    value === 'long_day'
  );
}

function isPackId(value: unknown): value is WorldPackId {
  return (
    value === 'society.town' ||
    value === 'society.crew' ||
    value === 'society.cloister'
  );
}

function isUseCaseId(value: unknown): value is WorldUseCaseId {
  return (
    value === 'xiangyi' ||
    value === 'showcase' ||
    value === 'campus' ||
    value === 'workplace' ||
    value === 'scenic' ||
    value === 'courtyard'
  );
}

function hydrateTownCast(
  parsed: Partial<WorldCreatePrefs>,
): Pick<WorldCreatePrefs, 'castA' | 'castB' | 'rumor' | 'note'> {
  const castA =
    typeof parsed.castA === 'string' ? parsed.castA.trim().slice(0, 32) : '';
  const castB =
    typeof parsed.castB === 'string' ? parsed.castB.trim().slice(0, 32) : '';
  const storedNote =
    typeof parsed.note === 'string' ? parsed.note.trim().slice(0, 200) : '';
  const rumor =
    typeof parsed.rumor === 'string' && parsed.rumor.trim()
      ? parsed.rumor.trim().slice(0, 200)
      : !castA && !castB
        ? storedNote
        : '';
  const people = [castA, castB].filter(Boolean).join('和');
  const note = (
    people && rumor ? `${people}：${rumor}` : people || rumor || storedNote
  ).slice(0, 200);
  return { castA, castB, rumor, note };
}

function isVenueId(value: unknown): value is WorldVenueId {
  return (
    typeof value === 'string' &&
    (WORLD_VENUE_ID_LIST as readonly string[]).includes(value)
  );
}

export function defaultWorldCreatePrefs(
  artStyleId: ArtStyleId = DEFAULT_ART_STYLE_ID,
): WorldCreatePrefs {
  return {
    ...DEFAULT_PREFS,
    artStyleId,
    venues: [...DEFAULT_PREFS.venues],
    castA: '',
    castB: '',
    rumor: '',
    note: '',
  };
}

export function readWorldCreatePrefs(): WorldCreatePrefs {
  const storedArt = readStoredArtStyleId() ?? DEFAULT_ART_STYLE_ID;
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return defaultWorldCreatePrefs(storedArt);
    const parsed = JSON.parse(raw) as Partial<WorldCreatePrefs>;
    const venues = Array.isArray(parsed.venues)
      ? parsed.venues.filter(isVenueId)
      : [...DEFAULT_PREFS.venues];
    return {
      artStyleId: isArtStyleId(parsed.artStyleId)
        ? parsed.artStyleId
        : storedArt,
      scale: isScaleId(parsed.scale) ? parsed.scale : DEFAULT_PREFS.scale,
      livedIn: isLivedInId(parsed.livedIn)
        ? parsed.livedIn
        : DEFAULT_PREFS.livedIn,
      packId: isPackId(parsed.packId) ? parsed.packId : DEFAULT_PREFS.packId,
      useCase: isUseCaseId(parsed.useCase)
        ? parsed.useCase
        : DEFAULT_PREFS.useCase,
      venues: venues.length ? venues : [...DEFAULT_PREFS.venues],
      ...hydrateTownCast(parsed),
    };
  } catch {
    return defaultWorldCreatePrefs(storedArt);
  }
}

export function storeWorldCreatePrefs(prefs: WorldCreatePrefs): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore quota */
  }
  storeArtStyleId(prefs.artStyleId);
}

export function worldPopulationOf(prefs: WorldCreatePrefs): number {
  return WORLD_SCALE_POPULATION[prefs.scale];
}

/** Residents besides the two named people in the create form. */
export function townExtrasOf(prefs: WorldCreatePrefs): number {
  return Math.max(0, worldPopulationOf(prefs) - 2);
}

export function societySeedHoursOf(prefs: WorldCreatePrefs): number {
  return WORLD_LIVED_IN_HOURS[prefs.livedIn];
}
