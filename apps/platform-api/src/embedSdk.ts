/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Hono } from 'hono';

import type { PlatformEnv } from './env.js';

/**
 * Mounts `/embed.js` — a tiny zero-dep JS SDK that third-party sites drop into
 * their pages to render an OpenGame iframe:
 *
 * ```html
 * <div data-opengame="my-game-slug" data-width="800" data-height="600"></div>
 * <script src="https://api.opengame.example.com/embed.js" defer></script>
 * ```
 *
 * The SDK fetches `/api/public/games/<slug>/embed` (anonymous + CORS-open),
 * then injects a sized `<iframe>` with strict `sandbox` flags. The host page
 * needs zero API key. We aggressively cache the file (1 day) so the 3rd-party
 * site costs OpenGame ~0 bytes after the first cold load.
 */
export function mountEmbedSdk(app: Hono, env: PlatformEnv): void {
  const apiBase = env.publicBaseUrl ?? '';
  const sdkSource = `/* OpenGame Embed SDK v1 — MIT */
(function () {
  var API_BASE = ${JSON.stringify(apiBase || '')};
  function resolveBase() {
    if (API_BASE) return API_BASE.replace(/\\/$/, '');
    var s = document.currentScript;
    if (s && s.src) {
      try { var u = new URL(s.src); return u.origin; } catch (e) { /* noop */ }
    }
    return '';
  }
  var BASE = resolveBase();

  function hydrate(el) {
    if (el.dataset.opengameInjected === '1') return;
    el.dataset.opengameInjected = '1';
    var slug = el.dataset.opengame;
    if (!slug) return;
    var width = el.dataset.width || '800';
    var height = el.dataset.height || '600';

    fetch(BASE + '/api/public/games/' + encodeURIComponent(slug) + '/embed')
      .then(function (r) {
        if (!r.ok) throw new Error('opengame: embed lookup failed ' + r.status);
        return r.json();
      })
      .then(function (data) {
        var iframe = document.createElement('iframe');
        iframe.src = data.iframeUrl;
        iframe.title = data.title || slug;
        iframe.width = width;
        iframe.height = height;
        iframe.loading = 'lazy';
        iframe.allow = 'autoplay; fullscreen; gamepad; pointer-lock';
        iframe.setAttribute('sandbox', data.iframeSandbox || 'allow-scripts allow-same-origin');
        iframe.style.border = '0';
        iframe.style.maxWidth = '100%';
        el.appendChild(iframe);
      })
      .catch(function (err) {
        el.textContent = 'OpenGame embed failed: ' + (err && err.message || err);
      });
  }

  function scan() {
    var nodes = document.querySelectorAll('[data-opengame]');
    for (var i = 0; i < nodes.length; i++) hydrate(nodes[i]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scan);
  } else {
    scan();
  }

  // Allow imperative hydration for SPAs:
  window.OpenGame = window.OpenGame || {};
  window.OpenGame.render = function (el) {
    if (!el) return;
    hydrate(el);
  };
  window.OpenGame.rescan = scan;
})();
`;

  app.get('/embed.js', (c) => {
    c.header('Content-Type', 'application/javascript; charset=utf-8');
    c.header('Cache-Control', 'public, max-age=86400, immutable');
    c.header('Access-Control-Allow-Origin', '*');
    return c.body(sdkSource);
  });
}
