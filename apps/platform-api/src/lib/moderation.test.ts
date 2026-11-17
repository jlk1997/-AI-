/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import { isReportReason, isReportTarget, normalizeDetail } from './moderation.js';

describe('report validation', () => {
  it('accepts only the reasons a curator can act on', () => {
    expect(isReportReason('stolen')).toBe(true);
    expect(isReportReason('nsfw')).toBe(true);
    // Anything outside the list would reach the queue with no defined outcome.
    expect(isReportReason('i-dont-like-it')).toBe(false);
    expect(isReportReason(null)).toBe(false);
    expect(isReportReason(42)).toBe(false);
  });

  it('accepts only the two things that can be reported', () => {
    expect(isReportTarget('game')).toBe(true);
    expect(isReportTarget('comment')).toBe(true);
    expect(isReportTarget('user')).toBe(false);
  });
});

describe('normalizeDetail', () => {
  it('treats blank text as no detail at all', () => {
    expect(normalizeDetail('   ')).toBeNull();
    expect(normalizeDetail('')).toBeNull();
    expect(normalizeDetail(undefined)).toBeNull();
    expect(normalizeDetail(123)).toBeNull();
  });

  it('collapses whitespace so the queue stays readable', () => {
    expect(normalizeDetail('  copied\n\nfrom   me ')).toBe('copied from me');
  });

  it('caps length: this is a report, not an essay', () => {
    expect(normalizeDetail('x'.repeat(900))).toHaveLength(500);
  });
});
