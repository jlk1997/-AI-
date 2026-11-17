/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Retrying a parent that already grew a child must follow that child,
 * not toast 409 and freeze the studio on the old fail card.
 */

import { ApiError } from '../services/api';

export function followRetryJobId(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  if (error.code !== 'CONFLICT' && error.status !== 409) return null;
  const id = error.details?.jobId;
  if (typeof id !== 'string' || id.length === 0 || id === 'claiming') return null;
  return id;
}
