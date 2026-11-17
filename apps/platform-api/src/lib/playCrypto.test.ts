/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import {
  decryptDslJson,
  derivePlayDslKey,
  encryptDslJson,
  injectPlayTicket,
  isEncryptedDsl,
} from './playCrypto.js';

describe('play dsl wrapping', () => {
  it('round-trips a game.json body', () => {
    const key = derivePlayDslKey('secret', 'token-1');
    const plain = JSON.stringify({ meta: { title: 'Tiny' }, scenes: [] });
    const enc = encryptDslJson(plain, key);
    expect(isEncryptedDsl(enc)).toBe(true);
    expect(decryptDslJson(enc, key)).toBe(plain);
  });

  it('refuses a key from a different session', () => {
    const enc = encryptDslJson('{}', derivePlayDslKey('secret', 'a'));
    expect(() => decryptDslJson(enc, derivePlayDslKey('secret', 'b'))).toThrow();
  });

  it('injects the ticket before </head>', () => {
    const html = injectPlayTicket('<html><head></head><body></body></html>', 'abc');
    expect(html).toContain('window.__OG_PLAY_KEY="abc"');
    expect(html.indexOf('__OG_PLAY_KEY')).toBeLessThan(html.indexOf('</head>'));
  });
});
