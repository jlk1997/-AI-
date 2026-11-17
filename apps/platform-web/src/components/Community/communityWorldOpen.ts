/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Community "open observatory" must not send strangers to /observatory/:id —
 * that desk is org-member only and 403s. Guests already have the shared town
 * on the work page; a new window is the same guest play surface.
 */

export function communityWorldOpenHref(input: {
  readonly viewerIsAuthor?: boolean;
  readonly authorProjectId?: string | null;
  readonly slug?: string | null;
  readonly gameId?: string | null;
}): { readonly href: string; readonly kind: 'author' | 'guest' } | null {
  if (input.viewerIsAuthor && input.authorProjectId?.trim()) {
    return {
      href: `/observatory/${input.authorProjectId.trim()}`,
      kind: 'author',
    };
  }
  const slug = (input.slug ?? input.gameId ?? '').trim();
  if (!slug) return null;
  return { href: `/play/${slug}`, kind: 'guest' };
}
