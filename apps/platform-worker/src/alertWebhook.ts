/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Optional ops ping. Missing URL is silence, not a fake success.
 * Authors still see the dead letter in studio — that alert is always on.
 */

/** Production without a webhook is honest silence, not a hidden failure. */
export function silentOpsAlertWarning(
  webhookUrl: string | undefined,
  nodeEnv: string | undefined,
): string | null {
  if (nodeEnv !== 'production') return null;
  if (webhookUrl?.trim()) return null;
  return 'PLATFORM_ALERT_WEBHOOK_URL is empty; dead letters only show in the studio Quality strip';
}

export async function postAlertWebhook(
  url: string | undefined,
  payload: Record<string, unknown>,
): Promise<void> {
  const target = url?.trim();
  if (!target) return;
  try {
    const res = await fetch(target, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        source: 'opengame-platform-worker',
        ts: new Date().toISOString(),
        ...payload,
      }),
    });
    if (!res.ok) {
      console.error('[alert-webhook] non-2xx', res.status);
    }
  } catch (err) {
    console.error('[alert-webhook] failed', err);
  }
}
