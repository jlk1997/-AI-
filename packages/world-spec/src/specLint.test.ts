/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';

import { lintSpecField, lintSpecFields } from './specLint.js';

describe('lintSpecField', () => {
  it('flags too_short', () => {
    const issues = lintSpecField('meta.summary', '短的');
    expect(issues.some((i) => i.code === 'too_short')).toBe(true);
  });

  it('flags chinese cliche', () => {
    const issues = lintSpecField(
      'presentation.openingRumor',
      '神秘的森林里有一只传说中的狐狸。',
    );
    expect(issues.some((i) => i.code === 'template_cliche')).toBe(true);
  });

  it('flags english cliche', () => {
    const issues = lintSpecField(
      'regions.r0.description',
      'Once upon a time, in a mysterious forest, there lived an ancient dragon.',
    );
    expect(issues.some((i) => i.code === 'template_cliche')).toBe(true);
  });

  it('flags repeated ngrams', () => {
    // 让连续二元组出现足够多次触发重复告警
    const text =
      '清晨的码头有清晨的码头有清晨的码头有渔婆点灯 渔婆点灯 渔婆点灯 等船靠岸 等船靠岸';
    const issues = lintSpecField('meta.summary', text, {
      ngramSize: 2,
      repeatThreshold: 3,
    });
    expect(issues.some((i) => i.code === 'duplicate_ngram')).toBe(true);
  });

  it('returns empty for clean text', () => {
    const issues = lintSpecField(
      'meta.summary',
      '清晨六点，码头的渔婆把灯笼挂在木桩上，等第一艘船靠岸。',
    );
    expect(issues.filter((i) => i.severity !== 'info')).toHaveLength(0);
  });

  it('handles null/undefined gracefully', () => {
    expect(lintSpecField('x', null)).toEqual([]);
    expect(lintSpecField('x', undefined)).toEqual([]);
  });
});

describe('lintSpecFields', () => {
  it('detects identical fields across paths', () => {
    const text = '古老的村庄在山脚下，夜里能听到钟声从教堂传出来';
    const issues = lintSpecFields([
      { path: 'meta.summary', text },
      { path: 'presentation.openingRumor', text },
    ]);
    expect(issues.some((i) => i.code === 'identical_fields')).toBe(true);
  });

  it('treats whitespace-only differences as identical', () => {
    const issues = lintSpecFields([
      { path: 'a', text: '小镇的钟楼在夜里会响十二下' },
      { path: 'b', text: '  小镇的钟楼在夜里会响十二下  ' },
    ]);
    expect(issues.some((i) => i.code === 'identical_fields')).toBe(true);
  });

  it('does not flag different fields', () => {
    const issues = lintSpecFields([
      { path: 'a', text: '清晨六点的渔婆在码头点灯。' },
      { path: 'b', text: '夜晚的钟声从山脚的教堂里传出来。' },
    ]);
    expect(issues.filter((i) => i.severity === 'error')).toHaveLength(0);
  });
});