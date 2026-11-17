/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';

/**
 * A cheap, stable print of a published work. After a report we can compare
 * this against other rows without opening the bundle — title + description +
 * licence is enough to catch a copy-paste republish, which is the theft that
 * actually happens here.
 */
export function workFingerprint(input: {
  readonly title: string;
  readonly description?: string | null;
  readonly category: string;
  readonly license: string;
}): string {
  const body = JSON.stringify({
    t: input.title.trim().toLowerCase(),
    d: (input.description ?? '').trim().toLowerCase(),
    c: input.category,
    l: input.license,
  });
  return createHash('sha256').update(body).digest('hex').slice(0, 32);
}
