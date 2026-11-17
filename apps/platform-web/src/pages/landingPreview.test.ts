/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import { buildLandingPreview } from './landingPreview.js';

describe('homepage preview', () => {
  it('uses a labeled sample when no town is public yet', () => {
    const preview = buildLandingPreview({ lines: [], residents: null, townTitle: null });
    expect(preview.mode).toBe('sample');
    expect(preview.lines.length).toBeGreaterThan(0);
    expect(preview.residents).toBeNull();
  });

  it('shows live dialogue and the resident count when a town exists', () => {
    const preview = buildLandingPreview({
      lines: [{ speaker: '阿禾', text: '今晚的规定我不同意。', town: '河湾镇' }],
      residents: 48,
      townTitle: '河湾镇',
    });
    expect(preview.mode).toBe('live');
    expect(preview.lines[0]?.text).toContain('不同意');
    expect(preview.residents).toBe(48);
    expect(preview.townTitle).toBe('河湾镇');
  });
});
