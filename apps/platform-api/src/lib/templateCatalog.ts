/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Official channel = rows with no organization (operator-seeded).
 * Community channel = a tenant published the package.
 */

import { and, desc, eq } from 'drizzle-orm';
import type { DrizzleDb } from '@opengame/platform-db';
import { templatePackages } from '@opengame/platform-db';

export const OFFICIAL_TEMPLATE_SEEDS = [
  {
    slug: 'core',
    version: '1.0.0',
    storageKey: 'official://core',
    name: 'OpenGame Core',
    description:
      'Official Vite + Phaser workspace. Empty projects copy PLATFORM_GAME_TEMPLATE_DIR.',
  },
  {
    slug: 'skeleton',
    version: '1.0.0',
    storageKey: 'official://skeleton',
    name: 'OpenGame Skeleton',
    description:
      'Minimal template-free skeleton. Empty projects copy PLATFORM_RUNTIME_SKELETON_DIR.',
  },
] as const;

/** Idempotent seed so hosts that skip a migration still see the official channel. */
export async function ensureOfficialTemplatePackages(db: DrizzleDb): Promise<void> {
  await db
    .insert(templatePackages)
    .values(
      OFFICIAL_TEMPLATE_SEEDS.map((seed) => ({
        slug: seed.slug,
        version: seed.version,
        storageKey: seed.storageKey,
        name: seed.name,
        description: seed.description,
        organizationId: null,
        isPublic: true,
        pricePoints: 0,
      })),
    )
    .onConflictDoNothing({
      target: [templatePackages.slug, templatePackages.version],
    });
}

export type TemplateChannel = 'official' | 'community' | 'all';

export function parseTemplateChannel(raw: string | undefined | null): TemplateChannel {
  const v = (raw ?? 'all').trim().toLowerCase();
  if (v === 'official' || v === 'community') return v;
  return 'all';
}

export function isOfficialTemplate(organizationId: string | null | undefined): boolean {
  return organizationId == null;
}

export async function findTemplateBySlugVersion(
  db: DrizzleDb,
  slug: string,
  version?: string | null,
): Promise<typeof templatePackages.$inferSelect | null> {
  if (version?.trim()) {
    const [row] = await db
      .select()
      .from(templatePackages)
      .where(and(eq(templatePackages.slug, slug), eq(templatePackages.version, version.trim())))
      .limit(1);
    return row ?? null;
  }
  const [row] = await db
    .select()
    .from(templatePackages)
    .where(eq(templatePackages.slug, slug))
    .orderBy(desc(templatePackages.createdAt))
    .limit(1);
  return row ?? null;
}
