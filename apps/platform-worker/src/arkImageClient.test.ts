/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import sharp from 'sharp';

import {
  buildArkImageRequestBody,
  ensurePngBuffer,
  seedreamSupportsOutputFormat,
} from './arkImageClient.js';
import { probePngBuffer } from './assetAuthenticity.js';

async function noisyJpeg(): Promise<Buffer> {
  const w = 96;
  const h = 96;
  const rgb = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    rgb[i * 3] = (i * 17) % 256;
    rgb[i * 3 + 1] = (i * 41) % 256;
    rgb[i * 3 + 2] = (i * 73) % 256;
  }
  return sharp(rgb, { raw: { width: w, height: h, channels: 3 } })
    .jpeg({ quality: 85 })
    .toBuffer();
}

describe('arkImageClient Seedream request body', () => {
  it('does not send output_format for Seedream 4.x (would 400)', () => {
    expect(seedreamSupportsOutputFormat('doubao-seedream-4-0-250828')).toBe(
      false,
    );
    const body = buildArkImageRequestBody({
      model: 'doubao-seedream-4-0-250828',
      prompt: 'hero sprite',
      aspectRatio: '1:1',
    });
    expect(body).not.toHaveProperty('output_format');
    expect(body).not.toHaveProperty('n');
    expect(body['response_format']).toBe('url');
    expect(body['watermark']).toBe(false);
    expect(body['size']).toBe('1024x1024');
  });

  it('sends output_format png only for Seedream 5.x', () => {
    expect(seedreamSupportsOutputFormat('doubao-seedream-5-0-260128')).toBe(
      true,
    );
    const body = buildArkImageRequestBody({
      model: 'doubao-seedream-5-0-260128',
      prompt: 'hero',
    });
    expect(body['output_format']).toBe('png');
  });
});

describe('arkImageClient ensurePngBuffer', () => {
  it('converts JPEG (Seedream 4.x default) to PNG that passes authenticity', async () => {
    const jpeg = await noisyJpeg();
    expect(jpeg[0]).toBe(0xff);
    expect(jpeg[1]).toBe(0xd8);

    const png = await ensurePngBuffer(jpeg);
    expect(png[0]).toBe(0x89);
    expect(png[1]).toBe(0x50);
    const probe = probePngBuffer(png);
    expect(probe.ok, probe.reason).toBe(true);
  });
});
