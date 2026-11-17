/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * The hosted preview can 200 a JavaScript file that the browser cannot parse
 * (HTML fallback, or a Vite one-liner that upload-time comment stripping ate).
 * The studio left pane and the society LLM do not load that file, so they keep
 * talking while the right-hand stage stays black. Probe the entry script
 * before we refresh the viewer lease.
 */

export const PREVIEW_BROKEN_MSG = 'opengame-preview-broken';

export type PreviewBundleReason =
  | 'html-as-js'
  | 'syntax'
  | 'empty'
  | 'http'
  | 'not-found'
  | 'cors'
  | 'timeout';

export type PreviewBundleProbe = {
  readonly ok: boolean;
  readonly reason?: PreviewBundleReason;
  readonly failedUrl?: string;
  readonly statusCode?: number;
};

export function classifyFetchFailure(err: unknown): PreviewBundleReason {
  const name = err instanceof Error ? err.name : '';
  const msg = err instanceof Error ? err.message : String(err);
  if (name === 'AbortError' || /timeout|aborted/i.test(msg)) return 'timeout';
  if (/cors|failed to fetch|networkerror|load failed/i.test(msg)) return 'cors';
  return 'http';
}

export function classifyHttpStatus(status: number): PreviewBundleReason {
  if (status === 404 || status === 410) return 'not-found';
  return 'http';
}

/** 404 / timeout / CORS while a job is still writing dist — not a broken script. */
export function isTransientPreviewFailure(reason?: PreviewBundleReason): boolean {
  return (
    reason === 'http' ||
    reason === 'not-found' ||
    reason === 'cors' ||
    reason === 'timeout'
  );
}

/** The Phaser stage is black — lock walk. A live iframe must still be walkable. */
export function isStageKillingPreviewFailure(
  reason?: PreviewBundleReason,
): boolean {
  return reason === 'syntax' || reason === 'html-as-js' || reason === 'empty';
}

/**
 * HTTP `diagnosePlayJs` lies on minified Vite. A 404/410 pack is a real miss.
 * Scanner "syntax" must never condemn a town the iframe can already run.
 */
export function previewProbeShouldCondemn(
  reason?: PreviewBundleReason,
): boolean {
  return reason === 'not-found';
}

/**
 * Who is allowed to freeze talks / fast-forward / the shared clock.
 *
 * Phaser live always wins. An iframe stub (`opengame-preview-broken`) is the
 * only confirmed black stage. A mounted iframe is presumed walkable. The HTTP
 * probe may only freeze the desk when nothing is on screen yet and the pack
 * is actually missing.
 */
export function previewStageIsDead(input: {
  readonly broken?: boolean;
  readonly probeBroken?: boolean;
  readonly probeReason?: PreviewBundleReason;
  readonly iframeReady?: boolean;
  readonly phaserLive?: boolean;
  readonly confirmedByIframe?: boolean;
}): boolean {
  if (input.phaserLive) return false;
  if (input.confirmedByIframe) return true;
  if (previewProbeShouldCondemn(input.probeReason)) return true;
  if (input.iframeReady) return false;
  return Boolean(input.probeBroken ?? input.broken);
}

/** Final publish often lands a beat after `job.success`. Keep waiting, do not flash the red strip. */
export const PREVIEW_SETTLE_MS = 20_000;
export const PREVIEW_PROBE_RETRY_MS = 4_000;

export function previewShouldWait(input: {
  readonly reason?: PreviewBundleReason;
  readonly isGenerating?: boolean;
  readonly settling?: boolean;
}): boolean {
  if (!input.reason || !isTransientPreviewFailure(input.reason)) return false;
  return Boolean(input.isGenerating || input.settling);
}

/**
 * Hard failure = show the red strip. Mid-job / post-success missing files are a wait.
 * The second argument is "still waiting" (generating or settling), not only isGenerating.
 */
export function previewFailureIsHard(
  reason: PreviewBundleReason | undefined,
  waiting: boolean,
): boolean {
  if (!reason) return false;
  return !previewShouldWait({ reason, isGenerating: waiting });
}

export type PreviewRetryKind = 'wait' | 'lease' | 'job' | 'rebuild';

export type PreviewStageFace = 'empty' | 'baking' | 'broken' | 'load' | 'live';

/**
 * Skeleton preview is published before portraits finish. A signed URL means
 * the worker already shipped a walkable pack — do not cover it with baking
 * just because the world job is still drawing.
 *
 * Baking is only: no URL yet, or the short hang after a final publish.
 */
export function previewStageFace(input: {
  readonly previewUrl: string | null;
  readonly bundleReady: boolean;
  readonly isGenerating?: boolean;
  readonly settling?: boolean;
  /** @deprecated use isGenerating + settling */
  readonly waiting?: boolean;
  readonly broken: boolean;
  readonly iframeReady: boolean;
  readonly phaserLive?: boolean;
  readonly confirmedByIframe?: boolean;
}): PreviewStageFace {
  const generating = input.isGenerating ?? Boolean(input.waiting);
  const settling = input.settling ?? false;
  const hasUrl = Boolean(input.previewUrl);
  if (!hasUrl) return generating || settling ? 'baking' : 'empty';
  if (input.phaserLive) return 'live';
  if (input.confirmedByIframe) return 'broken';
  if (input.iframeReady) return 'live';
  if (!generating && settling && !input.bundleReady) return 'baking';
  if (input.broken && !generating && !settling) return 'broken';
  return 'load';
}

export function readWorldAssetProgress(
  summaries: readonly (string | null | undefined)[],
): { readonly done: number; readonly total: number } | null {
  for (let i = summaries.length - 1; i >= 0; i -= 1) {
    const line = summaries[i];
    if (!line) continue;
    const match = /(?:立绘|portrait)\s*(\d+)\s*\/\s*(\d+)/i.exec(line);
    if (!match) continue;
    const done = Number(match[1]);
    const total = Number(match[2]);
    if (Number.isFinite(done) && Number.isFinite(total) && total > 0) {
      return { done, total };
    }
  }
  return null;
}

/**
 * Leftover failed cards must not cover a run that already reached preview.
 */
export function studioOverlayGenerateFailed(input: {
  readonly hasCurrentWorldFail: boolean;
  readonly isGenerating?: boolean;
  readonly generationState?: string;
  readonly jobLifecycleStatus?: string;
}): boolean {
  if (!input.hasCurrentWorldFail || input.isGenerating) return false;
  if (input.generationState === 'preview') return false;
  if (input.jobLifecycleStatus === 'done') return false;
  return true;
}

/**
 * Refetching a signed URL cannot invent files a failed world job never wrote.
 */
export function previewRetryKind(input: {
  readonly reason?: PreviewBundleReason;
  readonly isGenerating?: boolean;
  readonly settling?: boolean;
  readonly generateFailed?: boolean;
  readonly leaseAttempts?: number;
}): PreviewRetryKind {
  if (!input.reason) return 'wait';
  if (
    previewShouldWait({
      reason: input.reason,
      isGenerating: input.isGenerating,
      settling: input.settling,
    })
  ) {
    return 'wait';
  }
  if (input.generateFailed && isTransientPreviewFailure(input.reason)) return 'job';
  // Re-signing the same /preview-dist/:id URL cannot invent index.html.
  if (input.reason === 'not-found' || input.reason === 'http') return 'rebuild';
  if (isTransientPreviewFailure(input.reason)) {
    return (input.leaseAttempts ?? 0) >= 1 ? 'rebuild' : 'lease';
  }
  return 'rebuild';
}

export function previewHintKey(
  kind: PreviewRetryKind,
  reason?: PreviewBundleReason,
): string {
  switch (kind) {
    case 'wait':
      return 'preview.diag.bakingHint';
    case 'job':
      return 'preview.diag.hintJobFailed';
    case 'lease':
      return 'preview.diag.hintLease';
    case 'rebuild':
      return reason === 'syntax' ||
        reason === 'html-as-js' ||
        reason === 'empty'
        ? 'preview.diag.hint'
        : 'preview.diag.hintMissingPack';
  }
}

export function previewRetryAction(
  kind: PreviewRetryKind,
): 'job' | 'lease' | 'rebuild' {
  if (kind === 'job') return 'job';
  if (kind === 'rebuild') return 'rebuild';
  return 'lease';
}

export function previewRetryLabelKey(kind: PreviewRetryKind): string {
  switch (kind) {
    case 'job':
      return 'preview.diag.retryJob';
    case 'lease':
    case 'wait':
      return 'preview.diag.refreshUrl';
    case 'rebuild':
      return 'product.obs.rebuildPresenter';
  }
}

export function shortenPreviewFailedUrl(url: string, max = 72): string {
  const trimmed = url.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, 32)}…${trimmed.slice(-24)}`;
}

const PREVIEW_REASONS: readonly PreviewBundleReason[] = [
  'html-as-js',
  'syntax',
  'empty',
  'http',
  'not-found',
  'cors',
  'timeout',
];

export function asPreviewReason(raw: unknown): PreviewBundleReason {
  return typeof raw === 'string' &&
    (PREVIEW_REASONS as readonly string[]).includes(raw)
    ? (raw as PreviewBundleReason)
    : 'syntax';
}

export function previewReasonCopyKey(reason?: PreviewBundleReason): string {
  switch (reason) {
    case 'not-found':
      return 'preview.diag.notFound';
    case 'cors':
      return 'preview.diag.cors';
    case 'timeout':
      return 'preview.diag.timeout';
    case 'html-as-js':
      return 'preview.diag.htmlAsJs';
    case 'empty':
      return 'preview.diag.empty';
    case 'syntax':
      return 'preview.diag.syntax';
    case 'http':
      return 'preview.diag.http';
    default:
      return 'preview.diag.unknown';
  }
}

export function diagnosePlayJs(js: string): PreviewBundleProbe {
  const t = js.trimStart();
  if (!t) return { ok: false, reason: 'empty' };
  if (t.startsWith('<')) return { ok: false, reason: 'html-as-js' };
  // Only the tiny API stub is a hard fail. A real Vite bundle may mention the
  // message type in comments or source maps without being that stub.
  if (t.includes('ogPreviewBroken') && t.length < 2_048) {
    return { ok: false, reason: 'syntax' };
  }
  if (t.includes(PREVIEW_BROKEN_MSG) && t.length < 2_048) {
    return { ok: false, reason: 'syntax' };
  }
  if (playJsUnclosedLiteral(js)) return { ok: false, reason: 'syntax' };
  return { ok: true };
}

function slashStartsRegex(src: string, slashAt: number): boolean {
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

function playJsUnclosedLiteral(src: string): boolean {
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
    if (c === '/' && slashStartsRegex(src, i)) {
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

const PREVIEW_PROBE_MS = 8_000;

async function fetchPreview(url: string): Promise<Response> {
  return fetch(url, {
    credentials: 'same-origin',
    signal: AbortSignal.timeout(PREVIEW_PROBE_MS),
  });
}

export async function probePreviewBundle(previewUrl: string): Promise<PreviewBundleProbe> {
  try {
    const htmlRes = await fetchPreview(previewUrl);
    if (!htmlRes.ok) {
      return {
        ok: false,
        reason: classifyHttpStatus(htmlRes.status),
        failedUrl: previewUrl,
        statusCode: htmlRes.status,
      };
    }
    const html = await htmlRes.text();
    const match = /<script[^>]+src=["']([^"']+\.js)["']/i.exec(html);
    if (!match?.[1]) return { ok: true };
    const jsUrl = new URL(match[1], previewUrl).href;
    try {
      const jsRes = await fetchPreview(jsUrl);
      if (!jsRes.ok) {
        return {
          ok: false,
          reason: classifyHttpStatus(jsRes.status),
          failedUrl: jsUrl,
          statusCode: jsRes.status,
        };
      }
      const diagnosed = diagnosePlayJs(await jsRes.text());
      return diagnosed.ok
        ? diagnosed
        : { ...diagnosed, failedUrl: jsUrl, statusCode: jsRes.status };
    } catch (err) {
      return {
        ok: false,
        reason: classifyFetchFailure(err),
        failedUrl: jsUrl,
      };
    }
  } catch (err) {
    return {
      ok: false,
      reason: classifyFetchFailure(err),
      failedUrl: previewUrl,
    };
  }
}
