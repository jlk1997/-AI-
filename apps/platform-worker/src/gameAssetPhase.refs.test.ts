/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { persistChatReferenceImages } from './gameAssetPhase.js';

describe('persistChatReferenceImages', () => {
  it('writes data-URL uploads to public/refs and REFERENCE_IMAGES.json', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-ref-'));
    fs.mkdirSync(path.join(dir, 'public'), { recursive: true });
    // 1x1 PNG
    const png =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const hints = await persistChatReferenceImages(dir, [
      `data:image/png;base64,${png}`,
      'https://cdn.example/style.jpg',
      'watercolor wash mood',
    ]);
    expect(hints.some((h) => h.includes('refs/ref_0.png'))).toBe(true);
    expect(hints).toContain('https://cdn.example/style.jpg');
    expect(fs.existsSync(path.join(dir, 'public', 'refs', 'ref_0.png'))).toBe(
      true,
    );
    const manifest = JSON.parse(
      fs.readFileSync(
        path.join(dir, 'public', 'REFERENCE_IMAGES.json'),
        'utf8',
      ),
    ) as { localRefs?: string[]; urls?: string[]; hints?: string[] };
    expect(manifest.localRefs?.[0]).toMatch(/refs\/ref_0/);
    expect(manifest.urls?.[0]).toContain('cdn.example');
    expect(manifest.hints?.join(' ')).toMatch(/watercolor/i);
  });
});
