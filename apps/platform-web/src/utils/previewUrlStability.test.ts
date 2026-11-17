/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  previewDeploymentIdentity,
  previewSiblingAssetUrl,
  withPreviewBustParam,
} from './previewUrlStability.js';

describe('previewUrlStability', () => {
  it('extracts deployment id from preview-dist path', () => {
    expect(
      previewDeploymentIdentity(
        '/v1/preview-dist/dep-abc/tok.en.jwt/index.html',
      ),
    ).toBe('dep-abc');
  });

  it('ignores rotating token when comparing identity', () => {
    const a = previewDeploymentIdentity(
      '/v1/preview-dist/dep-1/tokenA/index.html',
    );
    const b = previewDeploymentIdentity(
      '/v1/preview-dist/dep-1/tokenB/index.html',
    );
    expect(a).toBe(b);
  });

  it('maps preview html to a sibling asset without query tokens', () => {
    expect(
      previewSiblingAssetUrl(
        '/v1/preview-dist/dep-1/tok/index.html?mode=observe&_pv=1',
        'assets/bgm.mp3',
      ),
    ).toBe('/v1/preview-dist/dep-1/tok/assets/bgm.mp3');
  });

  it('appends bust without dropping path', () => {
    const out = withPreviewBustParam(
      '/v1/preview-dist/dep-1/tok/index.html',
      '1-0',
    );
    expect(out).toContain('_pv=1-0');
    expect(out).toContain('/preview-dist/dep-1/tok/index.html');
  });
});
