/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CommunityGameLicense } from '@opengame/platform-db';

/**
 * Remix licensing.
 *
 * "Change one line" is the growth loop, so the default stays open — but it is
 * now something the author chose rather than something the platform assumed.
 * Because playback is hosted and the source is never handed to the visitor,
 * this check is the only door into someone else's work, which is what makes it
 * worth enforcing in one place.
 */

const LICENSES: readonly CommunityGameLicense[] = ['remix-ok', 'remix-credit', 'no-remix'];

export function normalizeLicense(raw: unknown): CommunityGameLicense {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return (LICENSES as readonly string[]).includes(value)
    ? (value as CommunityGameLicense)
    : 'remix-ok';
}

export function isRemixAllowed(license: unknown): boolean {
  return normalizeLicense(license) !== 'no-remix';
}

/** True when a fork has to carry a visible "remixed from" credit. */
export function requiresCredit(license: unknown): boolean {
  return normalizeLicense(license) === 'remix-credit';
}

export class LicenseError extends Error {
  constructor(readonly license: CommunityGameLicense) {
    super(`remix not permitted under license "${license}"`);
    this.name = 'LicenseError';
  }
}

export function assertRemixAllowed(license: unknown): void {
  const normalized = normalizeLicense(license);
  if (normalized === 'no-remix') throw new LicenseError(normalized);
}

/**
 * Origins allowed to frame a work. Author-declared origins are additive to our
 * own; an empty author list keeps the work on-platform only, which is the
 * point of hosted playback.
 */
export function resolveEmbedOrigins(
  authorDeclared: unknown,
  platformOrigins: readonly string[],
): readonly string[] {
  const out = new Set<string>();
  const add = (value: unknown): void => {
    if (typeof value !== 'string') return;
    try {
      out.add(new URL(value).origin);
    } catch {
      /* ignore malformed entries */
    }
  };
  for (const origin of platformOrigins) add(origin);
  if (Array.isArray(authorDeclared)) {
    for (const value of authorDeclared) add(value);
  }
  return [...out];
}

export function isOriginAllowed(
  origin: string | null | undefined,
  allowed: readonly string[],
): boolean {
  if (!origin) return false;
  return allowed.includes(origin);
}
