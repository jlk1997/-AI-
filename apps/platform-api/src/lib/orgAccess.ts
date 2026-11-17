/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Helpers for "see every game I can edit" and honest collaborator invites.
 * Generate/build still authorize via organization_members of the *project's*
 * org — not the JWT's personal org, and not project_members alone.
 */

/** Missing / `all` means union every org the caller belongs to. */
export function wantsAllMembershipProjects(
  organizationId: string | undefined | null,
): boolean {
  if (typeof organizationId !== 'string') {
    return true;
  }
  const raw = organizationId.trim().toLowerCase();
  return raw === '' || raw === 'all';
}

/**
 * Peers see a masked address; owner/admin keep the full one so they can
 * re-invite. WeChat-only accounts have no email.
 */
export function maskEmailForPeer(
  email: string | null | undefined,
  reveal: boolean,
): string | null {
  if (!email) {
    return null;
  }
  const trimmed = email.trim();
  if (!trimmed) {
    return null;
  }
  if (reveal) {
    return trimmed;
  }
  const at = trimmed.indexOf('@');
  if (at <= 0) {
    return '***';
  }
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  if (!domain) {
    return '***';
  }
  const keep = local.slice(0, Math.min(2, local.length));
  return `${keep}***@${domain}`;
}

/** Invite never creates an owner. Admin is reserved for an existing owner. */
export function resolveInviteOrgRole(
  raw: string | undefined | null,
): 'member' | 'admin' {
  return raw === 'admin' ? 'admin' : 'member';
}
