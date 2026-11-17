/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  HOSTED_GDD_SYSTEM_PREFIX,
  hostedPhysicsHint,
  hostedSection3,
  isLegacyGddDocsEnabled,
} from './hostedGddContract.js';

describe('hostedGddContract', () => {
  afterEach(() => {
    delete process.env['PLATFORM_GDD_LEGACY_DOCS'];
  });

  it('is on by default and forbids template copy', () => {
    expect(isLegacyGddDocsEnabled()).toBe(false);
    expect(HOSTED_GDD_SYSTEM_PREFIX).toContain('_Template');
    expect(HOSTED_GDD_SYSTEM_PREFIX).toContain('Do NOT copy');
    expect(hostedSection3('grid_logic')).toContain('BoardTurnScene');
    expect(hostedSection3('grid_logic')).toMatch(/Do \*\*not\*\* name/);
    expect(hostedPhysicsHint('grid_logic')).not.toContain('_Template');
    expect(hostedPhysicsHint('platformer')).toContain('gravity');
  });

  it('can opt back into legacy docs', () => {
    process.env['PLATFORM_GDD_LEGACY_DOCS'] = '1';
    expect(isLegacyGddDocsEnabled()).toBe(true);
  });
});
