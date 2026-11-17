/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Takedown flips isPublic, but play-url / embed must also refuse a row that
 * still carries takenDownAt — restore is the only path that clears both.
 */

export function isPubliclyPlayable(
  game:
    | {
        readonly isPublic?: boolean | null;
        readonly takenDownAt?: Date | string | null;
      }
    | null
    | undefined,
): boolean {
  return Boolean(game?.isPublic) && !game?.takenDownAt;
}
