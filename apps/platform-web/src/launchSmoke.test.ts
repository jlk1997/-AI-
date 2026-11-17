/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Dual-launch smoke contracts (copy + honesty). Full browser paths stay
 * manual on launch day; these must stay green in CI.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { en } from './services/locales/en';
import { zhCN } from './services/locales/zh-CN';

describe('launch-week smoke contracts', () => {
  it('never tells the visitor to wait for the next hour as the only action', () => {
    for (const [key, line] of Object.entries({ ...zhCN, ...en })) {
      if (key.startsWith('society.overlay.') || key.startsWith('society.desk.')) {
        continue;
      }
      expect(line).not.toMatch(/等到整点|wait until the hour|wait for the hour/i);
    }
  });

  it('keeps empty-wallet copy honest', () => {
    expect(en['kai.needPoints']).toMatch(/wallet|pack/i);
    expect(zhCN['kai.needPoints']).toMatch(/钱包|礼包/);
    expect(en['wallet.paywall.need']).not.toMatch(/already credited/i);
  });

  it('hides the budget mute once remaining talks come back', () => {
    expect(en['product.obs.talkBudgetLeft']?.length).toBeGreaterThan(0);
    expect(zhCN['product.obs.talkBudgetLeft']?.length).toBeGreaterThan(0);
    expect(zhCN['product.obs.talkFloorEmpty']).toMatch(/资助过期/);
    expect(en['product.obs.talkFloorEmpty']).toMatch(/Funding expired/);
  });

  it('keeps the play → change one line → publish loop on the console', () => {
    expect(zhCN['app.tagline']).toMatch(/AI 小镇/);
    expect(en['app.tagline']).toMatch(/AI town/i);
    expect(en['app.brand.short']).toBe('Gebi');
  });

  it('names the overseas landing Gebi, not the research CLI', () => {
    const html = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html'),
      'utf8',
    );
    expect(html).toMatch(/隔壁 · AI 小镇/);
    expect(html).toMatch(/会自己过日子/);
    expect(html).not.toMatch(/OpenGame/);
  });

  it('keeps the PWA and empty alley on the product, not the research IDE', () => {
    const manifest = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'manifest.webmanifest'),
      'utf8',
    );
    expect(manifest).toMatch(/AI 小镇/);
    expect(manifest).toMatch(/会自己过日子/);
    expect(manifest).not.toMatch(/OpenGame/);
    expect(en['community.noGames']).not.toMatch(/IDE/i);
    expect(zhCN['community.noGames']).toMatch(/工作室/);
    expect(en['developer.subtitle']).not.toMatch(/OpenGame/);
  });
});
