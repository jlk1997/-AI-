/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { api } from '../../services/api';
import { trackCourseEvent } from './courseTelemetry';

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const base64Safe = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64Safe);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

export function courseWebPushSupported(): boolean {
  return (
    typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window
  );
}

/** Register a Web Push subscription after notification permission is granted. */
export async function registerCourseWebPush(): Promise<boolean> {
  if (!courseWebPushSupported() || Notification.permission !== 'granted') {
    return false;
  }
  try {
    const { publicKey } = await api.me.coursePushVapid();
    if (!publicKey) return false;
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    const sub =
      existing
      ?? (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      }));
    const json = sub.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return false;
    await api.me.coursePushSubscribe({
      endpoint: json.endpoint,
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    });
    trackCourseEvent('course_web_push_subscribe', { ok: true });
    return true;
  } catch {
    trackCourseEvent('course_web_push_subscribe', { ok: false });
    return false;
  }
}
