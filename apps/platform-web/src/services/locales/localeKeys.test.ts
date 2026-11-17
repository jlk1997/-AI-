/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Dual-launch copy: zh-CN and en must stay the same key set. A missing
 * English key ships Chinese leftovers to overseas users.
 */

import { describe, expect, it } from 'vitest';

import { en } from './en';
import { zhCN } from './zh-CN';

describe('locale key alignment', () => {
  it('keeps zh-CN and en on the same keys', () => {
    const zhKeys = Object.keys(zhCN).sort();
    const enKeys = Object.keys(en).sort();
    const missingInEn = zhKeys.filter((k) => !(k in en));
    const missingInZh = enKeys.filter((k) => !(k in zhCN));
    expect(missingInEn, `missing in en: ${missingInEn.join(', ')}`).toEqual([]);
    expect(missingInZh, `missing in zh-CN: ${missingInZh.join(', ')}`).toEqual(
      [],
    );
  });
});
