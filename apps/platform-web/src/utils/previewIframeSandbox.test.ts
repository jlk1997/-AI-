/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  previewIframeAllow,
  previewIframeSandbox,
} from './previewIframeSandbox.js';

describe('previewIframeSandbox', () => {
  it('allows autoplay on the framed presenter', () => {
    expect(previewIframeAllow()).toContain('autoplay');
  });

  it('keeps same-origin for root-relative preview urls', () => {
    expect(
      previewIframeSandbox('/v1/preview-dist/dep/tok/index.html'),
    ).toContain('allow-same-origin');
  });
});
