/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';

import {
  announceProgress,
  describeProgressBar,
  shouldDismissOnEscape,
} from './a11y.js';

describe('a11y.describeProgressBar', () => {
  it('clamps current index and yields 5 steps by default', () => {
    const d = describeProgressBar({
      currentIndex: 3,
      totalSteps: 5,
      stepLabelKey: 'step',
      statusLabelKey: 'status',
      groupAriaLabel: 'group',
    });
    expect(d.currentIndex).toBe(3);
    expect(d.totalSteps).toBe(5);
    expect(d.steps).toHaveLength(5);
    expect(d.steps[0]?.state).toBe('done');
    expect(d.steps[1]?.state).toBe('done');
    expect(d.steps[2]?.state).toBe('active');
    expect(d.steps[3]?.state).toBe('pending');
    expect(d.steps[4]?.state).toBe('pending');
  });

  it('clamps current index to [1, total]', () => {
    const low = describeProgressBar({
      currentIndex: 0,
      totalSteps: 5,
      stepLabelKey: 'a',
      statusLabelKey: 'b',
      groupAriaLabel: 'c',
    });
    expect(low.currentIndex).toBe(1);
    const high = describeProgressBar({
      currentIndex: 99,
      totalSteps: 3,
      stepLabelKey: 'a',
      statusLabelKey: 'b',
      groupAriaLabel: 'c',
    });
    expect(high.currentIndex).toBe(3);
  });

  it('guards against zero or negative total', () => {
    const d = describeProgressBar({
      currentIndex: 1,
      totalSteps: 0,
      stepLabelKey: 'a',
      statusLabelKey: 'b',
      groupAriaLabel: 'c',
    });
    expect(d.totalSteps).toBe(1);
    expect(d.steps).toHaveLength(1);
  });
});

describe('a11y.announceProgress', () => {
  it('uses assertive for error and warn', () => {
    expect(announceProgress({ messageKey: 'm', severity: 'error' }).politeness).toBe(
      'assertive',
    );
    expect(announceProgress({ messageKey: 'm', severity: 'warn' }).politeness).toBe(
      'assertive',
    );
  });
  it('uses polite for info and success', () => {
    expect(announceProgress({ messageKey: 'm', severity: 'info' }).politeness).toBe(
      'polite',
    );
    expect(
      announceProgress({ messageKey: 'm', severity: 'success' }).politeness,
    ).toBe('polite');
  });
});

describe('a11y.shouldDismissOnEscape', () => {
  it('matches Escape only', () => {
    expect(shouldDismissOnEscape({ key: 'Escape' })).toBe(true);
    expect(shouldDismissOnEscape({ key: 'Enter' })).toBe(false);
    expect(shouldDismissOnEscape({ key: 'Tab' })).toBe(false);
  });
});