/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import {
  OFFICIAL_TEMPLATE_SEEDS,
  isOfficialTemplate,
  parseTemplateChannel,
} from './templateCatalog.js';

describe('templateCatalog', () => {
  it('parses the official / community / all channels', () => {
    expect(parseTemplateChannel('official')).toBe('official');
    expect(parseTemplateChannel('Community')).toBe('community');
    expect(parseTemplateChannel('')).toBe('all');
    expect(parseTemplateChannel(undefined)).toBe('all');
  });

  it('treats a missing organization as the official channel', () => {
    expect(isOfficialTemplate(null)).toBe(true);
    expect(isOfficialTemplate(undefined)).toBe(true);
    expect(isOfficialTemplate('org-1')).toBe(false);
  });

  it('pins official seeds to official:// storage keys', () => {
    expect(OFFICIAL_TEMPLATE_SEEDS.map((s) => s.storageKey)).toEqual([
      'official://core',
      'official://skeleton',
    ]);
  });
});
