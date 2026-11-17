/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Stable, machine-readable error codes returned by the platform API.
 *
 * The frontend (or any other client) can map these to localized strings
 * without having to parse English-only `error` text. Server logs still keep
 * the human prose in the `message` field for debugging.
 *
 * Contract:
 *   - Codes are SCREAMING_SNAKE and never change once shipped.
 *   - Adding a new code is a minor version bump; removing a code is a major.
 *   - Clients should treat unknown codes as `INTERNAL`.
 */
export const ErrorCode = {
  RATE_LIMITED: 'RATE_LIMITED',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  INVALID_INPUT: 'INVALID_INPUT',
  CONFLICT: 'CONFLICT',
  UNAVAILABLE: 'UNAVAILABLE',
  INTERNAL: 'INTERNAL',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface ApiErrorBody {
  readonly error: string;
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;
}

export function apiError(
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
): ApiErrorBody {
  const body: ApiErrorBody = { error: message, code };
  if (details) (body as { details?: Record<string, unknown> }).details = details;
  return body;
}
