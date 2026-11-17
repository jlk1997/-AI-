/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * Shell-only service worker.
 *
 * It caches the app shell so the phone H5 opens instantly on a flaky network.
 * It deliberately never caches:
 *   - `/v1/**` — session-scoped API responses and play tickets
 *   - `/v1/play/**` and `/v1/preview-dist/**` — hosted game bundles, which are
 *     served under short-lived signed sessions. Persisting them to CacheStorage
 *     would hand an offline copy of someone's game to any later visitor on the
 *     device, which is exactly the thing hosted playback exists to prevent.
 */

const SHELL_CACHE = 'opengame-shell-v1';
const SHELL_ASSETS = ['/', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

function isNeverCached(url) {
  return (
    url.pathname.startsWith('/v1/') ||
    url.pathname.startsWith('/embed.js') ||
    url.searchParams.has('ogPlaySession')
  );
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (isNeverCached(url)) return;

  // Navigations: network first so a published build is never stale, with the
  // cached shell as the offline answer.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put('/', copy)).catch(() => undefined);
          return res;
        })
        .catch(() => caches.match('/').then((hit) => hit ?? Response.error())),
    );
    return;
  }

  // Hashed Vite assets are immutable — cache first.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ??
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(SHELL_CACHE).then((c) => c.put(req, copy)).catch(() => undefined);
            }
            return res;
          }),
      ),
    );
  }
});

self.addEventListener('push', (event) => {
  let payload = { title: 'OpenGame', body: '', url: '/' };
  try {
    if (event.data) {
      payload = { ...payload, ...event.data.json() };
    }
  } catch {
    /* ignore malformed payloads */
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag ?? 'opengame-course',
      data: { url: payload.url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification?.data?.url;
  if (!url) return;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
      return undefined;
    }),
  );
});
