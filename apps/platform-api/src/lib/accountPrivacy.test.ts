/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import {
  anonymizedEmail,
  anonymizedHandle,
  canPublishPublicly,
  currentAgeFromBirthYear,
  isOldEnoughToPublish,
} from './accountPrivacy.js';

describe('accountPrivacy helpers', () => {
  it('computes age from birth year', () => {
    expect(currentAgeFromBirthYear(2000, new Date('2026-08-21T00:00:00Z'))).toBe(
      26,
    );
    expect(isOldEnoughToPublish(2015, 16, new Date('2026-01-01T00:00:00Z'))).toBe(
      false,
    );
    expect(isOldEnoughToPublish(2008, 16, new Date('2026-01-01T00:00:00Z'))).toBe(
      true,
    );
    expect(isOldEnoughToPublish(null)).toBe(false);
    expect(
      canPublishPublicly({
        birthYear: 2000,
        acceptedLegalAt: new Date('2026-01-01'),
      }),
    ).toBe(true);
    expect(
      canPublishPublicly({ birthYear: 2000, acceptedLegalAt: null }),
    ).toBe(false);
  });

  it('anonymizes identity without leaking the original handle', () => {
    const id = '11111111-2222-3333-4444-555555555555';
    expect(anonymizedEmail(id)).toMatch(/^deleted\+/);
    expect(anonymizedHandle(id)).toMatch(/^deleted_/);
    expect(anonymizedEmail(id)).not.toContain('@gmail');
  });
});
