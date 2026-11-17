/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * The homepage hero shows a live town when one is published, and a labeled
 * sample when the platform is still empty.
 */

export interface LandingLine {
  readonly speaker: string;
  readonly text: string;
  readonly town?: string;
}

export interface LandingPreview {
  readonly mode: 'live' | 'sample';
  readonly lines: readonly LandingLine[];
  readonly residents: number | null;
  readonly townTitle: string | null;
}

const SAMPLE_LINES: readonly LandingLine[] = [
  { speaker: '面包店老板', text: '涨价的告示贴出来了。我先看看邻居怎么说。' },
  { speaker: '学生', text: '听说镇长要修路，可钱从哪来还没人讲清楚。' },
  { speaker: '退休教师', text: '别急着站队。等今晚的议论再决定。' },
];

export function buildLandingPreview(input: {
  readonly lines: readonly LandingLine[];
  readonly residents: number | null;
  readonly townTitle: string | null;
}): LandingPreview {
  const live = input.lines.filter((line) => line.text.trim().length > 0).slice(0, 4);
  if (live.length === 0) {
    return {
      mode: 'sample',
      lines: SAMPLE_LINES,
      residents: null,
      townTitle: null,
    };
  }
  return {
    mode: 'live',
    lines: live,
    residents: input.residents,
    townTitle: input.townTitle,
  };
}
