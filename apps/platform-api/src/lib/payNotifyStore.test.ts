/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import { payNotifyRedisKey } from './payNotifyStore.js';

describe('payNotifyStore', () => {
  it('namespaces notify payloads by outTradeNo', () => {
    expect(payNotifyRedisKey('og20260101abc')).toBe('pay:notify:og20260101abc');
  });
});
