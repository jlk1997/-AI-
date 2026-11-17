/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CourseReturnHint, PublicAuthor, WorldStatusDto } from '../services/api.js';

/**
 * A community row as the list endpoints return it. The API still types these
 * as `any`; the phone shell pins the fields it actually renders so a shape
 * change surfaces at compile time instead of as a blank card.
 */
export interface CommunityWorkCard {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly description?: string | null;
  readonly thumbnail?: string | null;
  readonly category: string;
  readonly playCount?: number;
  readonly rating?: number;
  readonly ratingCount?: number;
  readonly publishedAt?: string;
  readonly deploymentId?: string;
  readonly author?: PublicAuthor | null;
  readonly world?: WorldStatusDto | null;
  readonly course?: CourseReturnHint | null;
  readonly license?: string | null;
}

export function isWorld(work: Pick<CommunityWorkCard, 'category'>): boolean {
  return work.category === 'world';
}
