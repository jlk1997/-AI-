/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import { courseBoardModuleHrefs } from './courseSettleLoop.js';
import { resetCourseSteeringLoaderCache } from './courseSteeringLoader.js';

describe('courseSteeringLoader', () => {
  it('resolves the course board module next to the worker', () => {
    const hrefs = courseBoardModuleHrefs();
    expect(hrefs.length).toBeGreaterThan(0);
    expect(hrefs.some((href) => href.includes('courseBoard'))).toBe(true);
  });

  it('allows cache reset between loads', () => {
    resetCourseSteeringLoaderCache();
    expect(true).toBe(true);
  });
});
