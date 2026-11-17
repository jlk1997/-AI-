/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import { parseExtraCorsOrigins, resolveV1CorsOrigin } from './corsOrigins.js';

const prod = {
  allowDevAuth: false,
  webBaseUrl: 'https://play.example',
  publicBaseUrl: 'https://api.example',
  wechatShareOrigins: ['https://mp.example'] as const,
};

describe('resolveV1CorsOrigin', () => {
  it('echoes the request origin under dev auth', () => {
    expect(
      resolveV1CorsOrigin('http://127.0.0.1:5173', {
        ...prod,
        allowDevAuth: true,
      }),
    ).toBe('http://127.0.0.1:5173');
  });

  it('rejects unknown origins in production', () => {
    expect(resolveV1CorsOrigin('https://evil.example', prod)).toBeUndefined();
  });

  it('allows the web and WeChat origins', () => {
    expect(resolveV1CorsOrigin('https://play.example', prod)).toBe('https://play.example');
    expect(resolveV1CorsOrigin('https://mp.example', prod)).toBe('https://mp.example');
  });

  it('echoes a trailing-dot origin for the same host', () => {
    const one = {
      ...prod,
      webBaseUrl: 'https://loveaibaby.cn',
      publicBaseUrl: undefined,
      wechatShareOrigins: [] as const,
    };
    expect(resolveV1CorsOrigin('https://loveaibaby.cn.', one)).toBe(
      'https://loveaibaby.cn.',
    );
    expect(resolveV1CorsOrigin('https://evil.example', one)).toBeUndefined();
    expect(resolveV1CorsOrigin('null', one)).toBe('null');
  });
});

describe('parseExtraCorsOrigins', () => {
  it('keeps only parseable URLs', () => {
    expect(parseExtraCorsOrigins('https://a.example, not-a-url, https://b.example/x')).toEqual([
      'https://a.example',
      'https://b.example',
    ]);
  });
});
