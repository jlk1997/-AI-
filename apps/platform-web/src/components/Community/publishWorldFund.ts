/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Already-listed worlds still need a live lamp before going public again.
 */

export function publishListedWorldAction(input: {
  readonly existingSlug?: string | null;
  readonly kind: 'game' | 'world';
  readonly isPublic: boolean;
  readonly townFunded: boolean;
  /** False while the lamp fetch has not come back. Hit the API then. */
  readonly lampKnown?: boolean;
}): 'publish' | 'already' | 'need_fund' {
  if (!input.existingSlug) return 'publish';
  if (input.kind === 'world' && input.isPublic && !input.townFunded) {
    return input.lampKnown === false ? 'publish' : 'need_fund';
  }
  return 'already';
}
