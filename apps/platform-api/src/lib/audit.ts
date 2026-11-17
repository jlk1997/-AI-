/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sensitive-action audit. Human reports stay the source of truth for
 * takedowns; this table is the operator trail (who published, hid, restored).
 */

import type { DrizzleDb } from '@opengame/platform-db';
import { auditLog } from '@opengame/platform-db';

export type AuditAction =
  | 'community.publish'
  | 'community.takedown'
  | 'community.restore'
  | 'admin.report.resolve'
  | 'deployment.domain'
  | 'generate.ugc_block';

export async function writeAudit(
  db: DrizzleDb,
  entry: {
    readonly action: AuditAction | string;
    readonly actorUserId?: string | null;
    readonly organizationId?: string | null;
    readonly target?: string | null;
    readonly meta?: Record<string, unknown> | null;
  },
): Promise<void> {
  try {
    await db.insert(auditLog).values({
      actorUserId: entry.actorUserId ?? null,
      organizationId: entry.organizationId ?? null,
      action: entry.action,
      target: entry.target ?? null,
      meta: entry.meta ?? null,
    });
  } catch (err) {
    console.error('[audit] write failed', entry.action, err);
  }
}
