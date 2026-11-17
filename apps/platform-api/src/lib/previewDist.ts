/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

import { GetObjectCommand, type S3Client } from '@aws-sdk/client-s3';

import type { DrizzleDb } from '@opengame/platform-db';
import { artifacts, deployments } from '@opengame/platform-db';
import { eq } from 'drizzle-orm';

import type { PlatformEnv } from '../env.js';
import { encryptDslJson, injectPlayTicket } from './playCrypto.js';

export type PreviewDistPayload = {
  v: number;
  deploymentId: string;
  exp: number;
  distPrefix: string;
};

type ViteArtifactManifest = {
  kind?: string;
  distPrefix?: string;
  entryKey?: string;
};

export function inferDistPrefixFromPreviewUrl(previewUrl: string): string | null {
  if (!previewUrl || previewUrl.includes('..')) return null;
  const normalized = previewUrl.replace(/\\/g, '/').replace(/^\/+/, '');
  if (normalized.endsWith('/index.html')) {
    return normalized.slice(0, -'/index.html'.length).replace(/\/+$/, '');
  }
  const last = normalized.lastIndexOf('/');
  if (last <= 0) return null;
  return normalized.slice(0, last).replace(/\/+$/, '');
}

export function resolveDistPrefix(
  previewUrl: string | null | undefined,
  manifest: unknown,
  storagePrefix?: string | null,
): string | null {
  const m = manifest as ViteArtifactManifest | null | undefined;
  if (m?.distPrefix && typeof m.distPrefix === 'string' && !m.distPrefix.includes('..')) {
    return m.distPrefix.replace(/\/+$/, '').replace(/^\/+/, '');
  }
  const normalizedStorage =
    storagePrefix &&
    typeof storagePrefix === 'string' &&
    !storagePrefix.includes('..')
      ? storagePrefix.replace(/\/+$/, '').replace(/^\/+/, '')
      : null;
  if (previewUrl) {
    const inferred = inferDistPrefixFromPreviewUrl(previewUrl);
    const normalizedPreview = previewUrl.replace(/\\/g, '/').replace(/^\/+/, '');
    // Legacy world pipeline wrote fake `/preview/{deploymentId}/` URLs — prefer artifact storage.
    const looksFakePreviewPath =
      normalizedPreview.startsWith('preview/') ||
      (inferred !== null && inferred.startsWith('preview/'));
    if (looksFakePreviewPath && normalizedStorage) {
      return normalizedStorage;
    }
    if (inferred) return inferred;
  }
  if (normalizedStorage) return normalizedStorage;
  return null;
}

export function signPreviewDistToken(secret: string, payload: PreviewDistPayload): string {
  const body = JSON.stringify({
    v: payload.v,
    deploymentId: payload.deploymentId,
    exp: payload.exp,
    distPrefix: payload.distPrefix,
  });
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  const bundle = JSON.stringify({ body, sig });
  return Buffer.from(bundle, 'utf8').toString('base64url');
}

export function verifyPreviewDistToken(
  secret: string,
  token: string,
): PreviewDistPayload | null {
  let parsed: { body: string; sig: string };
  try {
    const raw = Buffer.from(token, 'base64url').toString('utf8');
    parsed = JSON.parse(raw) as { body: string; sig: string };
  } catch {
    return null;
  }
  const expectedSig = createHmac('sha256', secret).update(parsed.body).digest('base64url');
  try {
    const a = Buffer.from(parsed.sig, 'utf8');
    const b = Buffer.from(expectedSig, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  let payload: PreviewDistPayload;
  try {
    payload = JSON.parse(parsed.body) as PreviewDistPayload;
  } catch {
    return null;
  }
  if (payload.v !== 1 || typeof payload.deploymentId !== 'string') return null;
  if (typeof payload.exp !== 'number' || typeof payload.distPrefix !== 'string') return null;
  if (!payload.distPrefix || payload.distPrefix.includes('..')) return null;
  if (Math.floor(Date.now() / 1000) > payload.exp) return null;
  return payload;
}

export function buildPreviewObjectKey(distPrefix: string, relPath: string): string | null {
  const prefix = distPrefix.replace(/\/+$/, '').replace(/^\/+/, '');
  const rel = relPath.replace(/^\/+/, '').replace(/\\/g, '/');
  if (!rel || rel.includes('..')) return null;
  return `${prefix}/${rel}`;
}

const EXT_MIME: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  js: 'application/javascript; charset=utf-8',
  mjs: 'application/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  map: 'application/json; charset=utf-8',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  mp4: 'video/mp4',
  webm: 'video/webm',
  wasm: 'application/wasm',
  txt: 'text/plain; charset=utf-8',
};

export function guessContentType(relPath: string): string {
  const base = relPath.split('/').pop() ?? relPath;
  const ext = base.includes('.') ? (base.split('.').pop()?.toLowerCase() ?? '') : '';
  return EXT_MIME[ext] ?? 'application/octet-stream';
}

export function guessCacheControl(relPath: string): string {
  const norm = relPath.replace(/^\/+/, '');
  if (norm === 'index.html' || norm.endsWith('/index.html')) {
    return 'no-store, no-cache, must-revalidate';
  }
  if (
    norm === 'society_replay.json' ||
    norm.endsWith('/society_replay.json') ||
    norm === 'world.json' ||
    norm.endsWith('/world.json')
  ) {
    return 'no-store, no-cache, must-revalidate';
  }
  if (norm.includes('/assets/') || norm.startsWith('assets/')) {
    return 'public, max-age=31536000, immutable';
  }
  return 'public, max-age=3600';
}

/** Path prefix (no trailing slash) for this preview mount; must match preview-url iframe path. */
export function previewDistMountPath(deploymentId: string, token: string): string {
  return `/v1/preview-dist/${deploymentId}/${encodeURIComponent(token)}`;
}

/**
 * Vite default `base: '/'` emits `/assets/...` and quoted absolute JSON paths. Under
 * `/v1/preview-dist/.../index.html` those resolve to the wrong origin path and return HTML
 * (SPA fallback) → `response.json()` throws "Unexpected token '<'".
 */
export function rewritePreviewHtml(html: string, mountPath: string): string {
  const m = mountPath.replace(/\/$/, '');
  return html
    .replaceAll('="/assets/', `="${m}/assets/`)
    .replaceAll("='/assets/", `='${m}/assets/`)
    .replaceAll('="/game.json', `="${m}/game.json`)
    .replaceAll("='/game.json", `='${m}/game.json`)
    .replaceAll('="/gameConfig.json', `="${m}/gameConfig.json`)
    .replaceAll("='/gameConfig.json", `='${m}/gameConfig.json`)
    .replaceAll('("/game.json"', `("${m}/game.json"`)
    .replaceAll("('/game.json'", `('${m}/game.json'`)
    .replaceAll('("/gameConfig.json"', `("${m}/gameConfig.json"`)
    .replaceAll("('/gameConfig.json'", `('${m}/gameConfig.json'`);
}

export function rewritePreviewCss(css: string, mountPath: string): string {
  const m = mountPath.replace(/\/$/, '');
  return css
    .replaceAll('url(/assets/', `url(${m}/assets/`)
    .replaceAll('url("/assets/', `url("${m}/assets/`)
    .replaceAll("url('/assets/", `url('${m}/assets/`)
    .replaceAll('url(/game.json', `url(${m}/game.json`)
    .replaceAll('url("/game.json', `url("${m}/game.json`)
    .replaceAll("url('/game.json", `url('${m}/game.json`);
}

/** Vite-bundled JS often contains `"/assets/` chunk paths and absolute JSON URLs. */
export function rewritePreviewBundledJs(js: string, mountPath: string): string {
  const m = mountPath.replace(/\/$/, '');
  return js
    .replaceAll('"/assets/', `"${m}/assets/`)
    .replaceAll("'/assets/", `'${m}/assets/`)
    .replaceAll('"/game.json', `"${m}/game.json`)
    .replaceAll("'/game.json", `'${m}/game.json`)
    .replaceAll('"/gameConfig.json', `"${m}/gameConfig.json`)
    .replaceAll("'/gameConfig.json", `'${m}/gameConfig.json`)
    .replaceAll('("/game.json"', `("${m}/game.json"`)
    .replaceAll("('/game.json'", `('${m}/game.json'`)
    .replaceAll('("/gameConfig.json"', `("${m}/gameConfig.json"`)
    .replaceAll("('/gameConfig.json'", `('${m}/gameConfig.json'`)
    .replaceAll('import("/assets/', `import("${m}/assets/`)
    .replaceAll("import('/assets/", `import('${m}/assets/`)
    // Some bundles emit template literals for the bootstrap path.
    .replaceAll(`\`/game.json\``, `\`${m}/game.json\``)
    .replaceAll('`/assets/', `\`${m}/assets/`);
}

export const PREVIEW_BROKEN_MSG = 'opengame-preview-broken';

/**
 * Vite one-liners that were comment-stripped with a regex often end mid-string
 * (`function e(){return"`). Serving that as a module is a black screen and
 * `Invalid or unexpected token`. Swap in a tiny stub so the stage can pause
 * talks and the new-window console is readable.
 */
export function previewJsLooksCorrupt(js: string): boolean {
  const t = js.trimStart();
  if (!t) return true;
  if (t.startsWith('<')) return true;
  return previewJsUnclosedLiteral(js);
}

function previewSlashStartsRegex(src: string, slashAt: number): boolean {
  let i = slashAt - 1;
  while (i >= 0 && /\s/.test(src[i]!)) i -= 1;
  if (i < 0) return true;
  const ch = src[i]!;
  if ('({[=,;:!&|?~%<>+-'.includes(ch)) return true;
  if (')]}`"\''.includes(ch)) return false;
  if (/[A-Za-z0-9_$]/.test(ch)) {
    let start = i;
    while (start > 0 && /[A-Za-z0-9_$]/.test(src[start - 1]!)) start -= 1;
    return /^(?:return|case|throw|new|delete|void|typeof|yield|await)$/.test(
      src.slice(start, i + 1),
    );
  }
  return true;
}

function previewJsUnclosedLiteral(src: string): boolean {
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    const n = src[i + 1];
    if (c === '"' || c === "'") {
      i += 1;
      while (i < src.length) {
        if (src[i] === '\\') {
          i += 2;
          continue;
        }
        if (src[i] === c) break;
        if (src[i] === '\n') return true;
        i += 1;
      }
      if (i >= src.length) return true;
      i += 1;
      continue;
    }
    if (c === '`') {
      i += 1;
      while (i < src.length) {
        if (src[i] === '\\') {
          i += 2;
          continue;
        }
        if (src[i] === '`') break;
        if (src[i] === '$' && src[i + 1] === '{') {
          i += 2;
          let depth = 1;
          while (i < src.length && depth > 0) {
            const q = src[i]!;
            if (q === '"' || q === "'") {
              const quote = q;
              i += 1;
              while (i < src.length && src[i] !== quote) {
                if (src[i] === '\\') i += 1;
                i += 1;
              }
              i += 1;
              continue;
            }
            if (q === '{') depth += 1;
            else if (q === '}') depth -= 1;
            i += 1;
          }
          if (depth > 0) return true;
          continue;
        }
        i += 1;
      }
      if (i >= src.length) return true;
      i += 1;
      continue;
    }
    if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && n === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (c === '/' && previewSlashStartsRegex(src, i)) {
      i += 1;
      let inClass = false;
      while (i < src.length) {
        if (src[i] === '\\') {
          i += 2;
          continue;
        }
        if (src[i] === '[') inClass = true;
        else if (src[i] === ']' && inClass) inClass = false;
        else if (src[i] === '/' && !inClass) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    i += 1;
  }
  return false;
}

export function previewBrokenModuleStub(reason: string): string {
  const r = JSON.stringify(reason.replace(/[^\w.-]/g, '').slice(0, 32) || 'syntax');
  return `const r=${r};try{window.parent.postMessage({type:${JSON.stringify(PREVIEW_BROKEN_MSG)},payload:{reason:r}},"*")}catch(e){}const d=document.createElement("div");d.dataset.ogPreviewBroken=r;d.style.cssText="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#09090b;color:#fecaca;font:14px/1.55 system-ui,sans-serif;padding:28px;text-align:center";d.textContent="Preview script is broken and cannot run. Rebuild the presenter.";document.body.replaceChildren(d);\n`;
}

export function buildPreviewProxyUrl(
  env: PlatformEnv,
  deploymentId: string,
  token: string,
): string {
  const tail = `${previewDistMountPath(deploymentId, token)}/index.html`;
  const base = env.publicBaseUrl?.trim();
  if (base) {
    return `${base.replace(/\/$/, '')}${tail}`;
  }
  return tail;
}

export interface PlayWatermark {
  /** Author handle, or a display name when they have not claimed one. */
  readonly author: string;
  readonly title: string;
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The visible "OpenGame · author" corner mark.
 *
 * Injected when the bundle is served rather than when it is built, for two
 * reasons: an author who upgrades to a plan that removes it should see it gone
 * on the next load without rebuilding, and a mark baked into the artifact would
 * travel with a mirrored copy as a mark nobody can turn off.
 *
 * It is not copy protection. It is attribution that survives a screen
 * recording, which is how most of these games actually get shared.
 */
export function watermarkHtml(mark: PlayWatermark): string {
  const author = escapeHtml(mark.author.slice(0, 40));
  const title = escapeHtml(mark.title.slice(0, 60));
  return `
<div id="og-watermark" role="note" aria-label="${title} · ${author}">OpenGame · ${author}</div>
<style>
#og-watermark{position:fixed;right:8px;bottom:8px;z-index:2147483000;pointer-events:none;
font:500 11px/1.4 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;
color:rgba(255,255,255,.82);background:rgba(0,0,0,.34);border-radius:999px;
padding:3px 9px;letter-spacing:.02em;text-shadow:0 1px 2px rgba(0,0,0,.45);
backdrop-filter:blur(2px);user-select:none}
@media (max-width:480px){#og-watermark{font-size:10px;padding:2px 7px}}
</style>`;
}

/** Places the mark just before `</body>`, or appends when the tag is missing. */
function injectWatermark(html: string, mark: PlayWatermark): string {
  const snippet = watermarkHtml(mark);
  const close = html.lastIndexOf('</body>');
  if (close === -1) return html + snippet;
  return `${html.slice(0, close)}${snippet}${html.slice(close)}`;
}

/**
 * Streams one object out of a published `dist/` prefix, rewriting absolute
 * asset paths so a Vite build works from a mounted sub-path. Shared by the
 * owner preview proxy and by hosted play sessions, which differ only in how
 * the caller is authorised and where the bundle is mounted.
 */
export interface ServeDistExtras {
  readonly watermark?: PlayWatermark | null;
  /** AES key for wrapping game.json on hosted play sessions. */
  readonly playDslKey?: Buffer | null;
}

export async function serveDistObject(
  s3: S3Client,
  env: PlatformEnv,
  distPrefix: string,
  mountPath: string,
  relPath: string,
  extras?: PlayWatermark | ServeDistExtras | null,
): Promise<Response> {
  const opts: ServeDistExtras =
    extras && 'author' in extras && 'title' in extras && !('watermark' in extras)
      ? { watermark: extras }
      : ((extras as ServeDistExtras | null) ?? {});
  const watermark = opts.watermark ?? null;
  const playDslKey = opts.playDslKey ?? null;
  const objectKey = buildPreviewObjectKey(distPrefix, relPath);
  if (!objectKey) {
    return new Response('Bad Request', { status: 400 });
  }

  const normRel = relPath.replace(/^\/+/, '');
  const ext = (normRel.split('.').pop() ?? '').toLowerCase();
  const isIndexHtml = normRel === 'index.html' || normRel.endsWith('/index.html');
  const underAssets = normRel.startsWith('assets/') || normRel.includes('/assets/');
  const isDslJson =
    normRel === 'game.json' ||
    normRel.endsWith('/game.json') ||
    normRel === 'gameConfig.json' ||
    normRel.endsWith('/gameConfig.json');
  const rewriteAsText =
    isIndexHtml ||
    isDslJson ||
    (ext === 'css' && underAssets) ||
    (ext === 'js' && underAssets);

  try {
    const out = await s3.send(new GetObjectCommand({ Bucket: env.s3Bucket, Key: objectKey }));
    if (!out.Body) {
      return new Response('Not Found', { status: 404 });
    }

    const contentType = out.ContentType ?? guessContentType(relPath);
    const cacheControl = guessCacheControl(relPath);
    const headers = new Headers({
      'Content-Type': contentType,
      'Cache-Control': cacheControl,
    });

    if (rewriteAsText) {
      const body = out.Body as { transformToString?: (enc?: string) => Promise<string> };
      const transformToString = body.transformToString;
      if (!transformToString) {
        return new Response('Not Found', { status: 404 });
      }
      const raw = await transformToString.call(body, 'utf-8');
      let text = raw;
      if (isIndexHtml) {
        text = rewritePreviewHtml(raw, mountPath);
        if (watermark) text = injectWatermark(text, watermark);
        if (playDslKey) {
          text = injectPlayTicket(text, playDslKey.toString('base64'));
        }
      } else if (isDslJson && playDslKey) {
        text = JSON.stringify(encryptDslJson(raw, playDslKey));
        headers.set('Cache-Control', 'no-store');
      } else if (ext === 'css') {
        text = rewritePreviewCss(raw, mountPath);
      } else if (ext === 'js') {
        if (previewJsLooksCorrupt(raw)) {
          text = previewBrokenModuleStub(
            raw.trimStart().startsWith('<') ? 'html-as-js' : 'syntax',
          );
          headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        } else {
          text = rewritePreviewBundledJs(raw, mountPath);
        }
      }
      // Body differs from S3 object; omit ETag to avoid mismatched 304 caching.
      return new Response(text, { status: 200, headers });
    }

    if (out.ETag) headers.set('ETag', out.ETag);

    const streamable = out.Body as { transformToWebStream?: () => ReadableStream };
    const webBody = streamable.transformToWebStream?.();
    if (!webBody) {
      return new Response('Not Found', { status: 404 });
    }
    return new Response(webBody, { status: 200, headers });
  } catch (err: unknown) {
    const name =
      err && typeof err === 'object' && 'name' in err
        ? String((err as { name: string }).name)
        : '';
    if (name === 'NoSuchKey' || name === 'NotFound') {
      const norm = relPath.replace(/^\/+/, '');
      // Observe stage always fetches this; return empty bundle until first society publish.
      if (norm === 'society_replay.json' || norm.endsWith('/society_replay.json')) {
        return new Response(
          JSON.stringify({
            version: 1,
            simTime: 0,
            agents: [],
            events: [],
            report: null,
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json; charset=utf-8',
              'Cache-Control': 'no-store, no-cache, must-revalidate',
            },
          },
        );
      }
      return new Response('Not Found', { status: 404 });
    }
    console.error('dist GetObject', err);
    return new Response('Internal Error', { status: 500 });
  }
}

export async function servePreviewDistAsset(
  db: DrizzleDb,
  s3: S3Client,
  env: PlatformEnv,
  deploymentId: string,
  token: string,
  relPath: string,
): Promise<Response> {
  const payload = verifyPreviewDistToken(env.jwtSecret, token);
  if (!payload || payload.deploymentId !== deploymentId) {
    return new Response('Forbidden', { status: 403 });
  }

  const [dep] = await db
    .select()
    .from(deployments)
    .where(eq(deployments.id, deploymentId))
    .limit(1);
  if (!dep?.previewUrl) {
    return new Response('Not Found', { status: 404 });
  }

  let manifest: unknown;
  let storagePrefix: string | null = null;
  if (dep.artifactId) {
    const [art] = await db.select().from(artifacts).where(eq(artifacts.id, dep.artifactId)).limit(1);
    manifest = art?.manifest;
    storagePrefix = art?.storagePrefix ?? null;
  }

  const expectedPrefix = resolveDistPrefix(dep.previewUrl, manifest, storagePrefix);
  if (!expectedPrefix || expectedPrefix !== payload.distPrefix) {
    return new Response('Forbidden', { status: 403 });
  }

  return serveDistObject(
    s3,
    env,
    payload.distPrefix,
    previewDistMountPath(deploymentId, token),
    relPath,
  );
}
