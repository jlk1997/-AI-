/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Volcengine Ark (doubao) image generation for MiniMax failover.
 * POST {base}/images/generations — Seedream family.
 *
 * Docs: https://console.volcengine.com/ark/region:cn-beijing/docs/82379/1099455
 * Seedream 4.x: JPEG only — do NOT send `output_format` (400 InvalidParameter).
 * Seedream 5.x: may accept `output_format: png|jpeg`.
 * Product gates require PNG magic — always re-encode via sharp.
 */

import sharp from 'sharp';

const DEFAULT_ARK = 'https://ark.cn-beijing.volces.com/api/v3';

function arkApiKey(): string {
  // Only Volcengine keys — never reuse MiniMax OPENGAME_FALLBACK_* / IMAGE_FALLBACK_*.
  return (
    process.env['OPENGAME_ARK_API_KEY']?.trim() ||
    process.env['OPENGAME_SEEDREAM_API_KEY']?.trim() ||
    ''
  );
}

function arkBaseUrl(): string {
  const raw =
    process.env['OPENGAME_ARK_BASE_URL']?.trim() ||
    process.env['OPENGAME_SEEDREAM_BASE_URL']?.trim() ||
    DEFAULT_ARK;
  return raw.replace(/\/+$/g, '');
}

function arkImageModel(): string {
  return (
    process.env['OPENGAME_ARK_IMAGE_MODEL']?.trim() ||
    process.env['OPENGAME_SEEDREAM_MODEL']?.trim() ||
    'doubao-seedream-4-0-250828'
  );
}

export function hasArkImageCredentials(): boolean {
  const key = arkApiKey();
  if (!key) return false;
  const base = arkBaseUrl();
  return /volces\.com|ark\.cn-beijing/i.test(base);
}

/** Seedream 5.x supports output_format; 4.x rejects it with HTTP 400. */
export function seedreamSupportsOutputFormat(model: string): boolean {
  const m = model.toLowerCase();
  return /seedream-?5|seedream_5|5-0-|5\.0/.test(m);
}

/**
 * Map MiniMax-style aspect ratios to Ark size strings.
 * Seedream 4.x requires total pixels ∈ [921600, 16777216] — use官方推荐 1K 档。
 * @see https://console.volcengine.com/ark/region:cn-beijing/docs/82379/1099455
 */
export function aspectToSize(aspectRatio?: string): string {
  switch (aspectRatio) {
    case '16:9':
      return '1280x720';
    case '9:16':
      return '720x1280';
    case '4:3':
      return '1152x864';
    case '3:4':
      return '864x1152';
    default:
      return '1024x1024';
  }
}

/** Build Seedream request body per model capability (avoid unsupported params). */
export function buildArkImageRequestBody(options: {
  readonly model: string;
  readonly prompt: string;
  readonly aspectRatio?: string;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: options.model,
    prompt: options.prompt.slice(0, 1500),
    size: aspectToSize(options.aspectRatio),
    response_format: 'url',
    watermark: false,
  };
  // Seedream 4.x 组图/多图用 sequential_image_generation；单图勿强塞 n（部分接入点会拒）
  // 仅 5.x 传 output_format；4.x 传了会 InvalidParameter（你刚踩到的坑）
  if (seedreamSupportsOutputFormat(options.model)) {
    body['output_format'] = 'png';
  }
  return body;
}

/** Ensure buffer is a non-trivial PNG (Seedream 4.x often returns JPEG). */
export async function ensurePngBuffer(raw: Buffer): Promise<Buffer> {
  try {
    return await sharp(raw).png().toBuffer();
  } catch (err) {
    const tip = err instanceof Error ? err.message : String(err);
    throw new Error(`Ark image not convertible to PNG: ${tip.slice(0, 160)}`);
  }
}

export async function arkGenerateImagePng(options: {
  readonly prompt: string;
  readonly aspectRatio?: string;
}): Promise<Buffer> {
  const key = arkApiKey();
  if (!key) throw new Error('Ark fallback API key missing (OPENGAME_ARK_API_KEY)');
  const base = arkBaseUrl();
  const model = arkImageModel();
  const body = buildArkImageRequestBody({
    model,
    prompt: options.prompt,
    aspectRatio: options.aspectRatio,
  });
  const res = await fetch(`${base}/images/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Ark image HTTP ${res.status}: ${t.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    data?: Array<{ url?: string; b64_json?: string }>;
    error?: { message?: string };
  };
  if (data.error?.message) {
    throw new Error(`Ark image error: ${data.error.message}`);
  }
  let raw: Buffer | undefined;
  const url = data.data?.[0]?.url;
  if (url) {
    const img = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!img.ok) throw new Error(`Ark download image failed HTTP ${img.status}`);
    raw = Buffer.from(await img.arrayBuffer());
  } else {
    const b64 = data.data?.[0]?.b64_json;
    if (b64) raw = Buffer.from(b64, 'base64');
  }
  if (!raw?.length) throw new Error('Ark image returned no url/b64_json');
  return ensurePngBuffer(raw);
}
