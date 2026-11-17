/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Genre packs on top of the society kernel. Town = diurnal plaza;
 * crew = watch clock + bridge/mess hub (no home_row sleep).
 */

import { resolveGenreProfile, type GenreProfile } from '@opengame/world-spec';

export type SocietyPackId = GenreProfile['id'];

export interface ResolvedSocietyPack {
  readonly id: SocietyPackId;
  readonly clockKind: GenreProfile['clock']['kind'];
  readonly hubKind: GenreProfile['hubKind'];
  readonly verbs: GenreProfile['verbs'];
  readonly profile: GenreProfile;
}

export function resolveSocietyPack(spec?: {
  readonly presentation?: { readonly genreProfile?: unknown };
}): ResolvedSocietyPack {
  const profile = resolveGenreProfile(spec ?? {});
  return {
    id: profile.id,
    clockKind: profile.clock.kind,
    hubKind: profile.hubKind,
    verbs: profile.verbs,
    profile,
  };
}

export function packAllowsGathering(pack: ResolvedSocietyPack): boolean {
  return pack.verbs.includes('host_gathering');
}
