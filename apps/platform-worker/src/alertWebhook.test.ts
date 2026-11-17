/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import { postAlertWebhook, silentOpsAlertWarning } from './alertWebhook.js';

describe('postAlertWebhook', () => {
  it('is a no-op without a URL', async () => {
    await expect(postAlertWebhook(undefined, { kind: 'test' })).resolves.toBeUndefined();
    await expect(postAlertWebhook('  ', { kind: 'test' })).resolves.toBeUndefined();
  });

  it('warns in production when ops will never hear about a dead letter', () => {
    expect(silentOpsAlertWarning(undefined, 'production')).toMatch(/PLATFORM_ALERT_WEBHOOK_URL/);
    expect(silentOpsAlertWarning('https://hooks.example/dead', 'production')).toBeNull();
    expect(silentOpsAlertWarning(undefined, 'development')).toBeNull();
  });
});
