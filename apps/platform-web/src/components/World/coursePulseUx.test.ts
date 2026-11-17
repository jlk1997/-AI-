/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import { coursePulseToastKey } from './coursePulseUx';

describe('coursePulseToastKey', () => {
  it('maps pulse kinds to toast keys', () => {
    expect(coursePulseToastKey({ kind: 'won' })).toBe('product.obs.course.toast.won');
    expect(coursePulseToastKey({ kind: 'closed' })).toBe('product.obs.course.toast.closed');
    expect(coursePulseToastKey({ kind: 'voided', voidReason: 'uncontested' })).toBe(
      'product.obs.course.void.uncontested',
    );
  });
});
