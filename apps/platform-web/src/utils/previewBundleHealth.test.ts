/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import {
  asPreviewReason,
  classifyFetchFailure,
  classifyHttpStatus,
  diagnosePlayJs,
  isStageKillingPreviewFailure,
  isTransientPreviewFailure,
  previewFailureIsHard,
  previewHintKey,
  previewRetryKind,
  previewStageFace,
  previewStageIsDead,
  previewProbeShouldCondemn,
  previewShouldWait,
  probePreviewBundle,
  readWorldAssetProgress,
  shortenPreviewFailedUrl,
  studioOverlayGenerateFailed,
} from './previewBundleHealth';

describe('diagnosePlayJs', () => {
  it('accepts a minified entry that contains // inside strings', () => {
    expect(diagnosePlayJs('function e(){return"//cdn.example.com/x"}console.log(1);').ok).toBe(
      true,
    );
    expect(diagnosePlayJs('return/^"/.test(s);const n=1;').ok).toBe(true);
  });

  it('rejects HTML-as-JS and the leftover of a regex comment strip', () => {
    expect(diagnosePlayJs('<!DOCTYPE html><html>').reason).toBe('html-as-js');
    expect(diagnosePlayJs('function e(){return"').reason).toBe('syntax');
    expect(diagnosePlayJs('const r="syntax";window.parent.postMessage({type:"opengame-preview-broken"}').reason).toBe(
      'syntax',
    );
    expect(
      diagnosePlayJs('function e(){return`//${"/assets/x.js"}`}console.log(1);').ok,
    ).toBe(true);
    expect(
      diagnosePlayJs(
        `${'x'.repeat(3000)}vite bundle mentioning opengame-preview-broken in a comment\nfunction boot(){return 1}`,
      ).ok,
    ).toBe(true);
  });
});

describe('previewStageIsDead', () => {
  it('does not freeze a painted town over a probe miss', () => {
    expect(previewStageIsDead({ broken: true, iframeReady: true })).toBe(false);
    expect(previewStageIsDead({ broken: true, iframeReady: false })).toBe(true);
    expect(previewStageIsDead({ broken: false, iframeReady: false })).toBe(false);
  });

  it('lets Phaser live win, and only an iframe stub confirms death', () => {
    expect(
      previewStageIsDead({
        probeBroken: true,
        probeReason: 'syntax',
        iframeReady: false,
        phaserLive: true,
      }),
    ).toBe(false);
    expect(
      previewStageIsDead({
        confirmedByIframe: true,
        iframeReady: true,
        phaserLive: false,
      }),
    ).toBe(true);
    expect(
      previewStageIsDead({
        confirmedByIframe: true,
        phaserLive: true,
      }),
    ).toBe(false);
    expect(
      previewStageIsDead({
        probeReason: 'not-found',
        iframeReady: true,
        phaserLive: false,
      }),
    ).toBe(true);
  });
});

describe('previewProbeShouldCondemn', () => {
  it('only condemns a missing pack, not a scanner syntax miss', () => {
    expect(previewProbeShouldCondemn('not-found')).toBe(true);
    expect(previewProbeShouldCondemn('syntax')).toBe(false);
    expect(previewProbeShouldCondemn('html-as-js')).toBe(false);
    expect(previewProbeShouldCondemn('http')).toBe(false);
  });
});

describe('preview fetch classification', () => {
  it('maps abort, CORS, and generic HTTP failures', () => {
    expect(
      classifyFetchFailure(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })),
    ).toBe('timeout');
    expect(classifyFetchFailure(new Error('Failed to fetch'))).toBe('cors');
    expect(classifyFetchFailure(new Error('boom'))).toBe('http');
    expect(classifyHttpStatus(404)).toBe('not-found');
    expect(classifyHttpStatus(410)).toBe('not-found');
    expect(classifyHttpStatus(502)).toBe('http');
    expect(asPreviewReason('cors')).toBe('cors');
    expect(asPreviewReason('nope')).toBe('syntax');
  });

  it('treats missing files as a wait while the world job is still writing', () => {
    expect(isTransientPreviewFailure('not-found')).toBe(true);
    expect(isTransientPreviewFailure('http')).toBe(true);
    expect(isTransientPreviewFailure('timeout')).toBe(true);
    expect(isTransientPreviewFailure('syntax')).toBe(false);
    expect(isStageKillingPreviewFailure('syntax')).toBe(true);
    expect(isStageKillingPreviewFailure('http')).toBe(false);
    expect(previewFailureIsHard('not-found', true)).toBe(false);
    expect(previewFailureIsHard('http', true)).toBe(false);
    expect(previewFailureIsHard('syntax', true)).toBe(true);
    expect(previewFailureIsHard('not-found', false)).toBe(true);
    expect(
      previewShouldWait({ reason: 'not-found', settling: true }),
    ).toBe(true);
    expect(
      previewRetryKind({
        reason: 'not-found',
        settling: true,
        generateFailed: true,
      }),
    ).toBe('wait');
  });

  it('does not flash Load World or a failed-job overlay after success', () => {
    expect(
      previewStageFace({
        previewUrl: null,
        bundleReady: false,
        isGenerating: true,
        broken: false,
        iframeReady: false,
      }),
    ).toBe('baking');
    expect(
      previewStageFace({
        previewUrl: 'http://127.0.0.1/v1/preview-dist/x/index.html',
        bundleReady: false,
        isGenerating: true,
        broken: false,
        iframeReady: false,
      }),
    ).toBe('load');
    expect(
      previewStageFace({
        previewUrl: 'http://127.0.0.1/v1/preview-dist/x/index.html',
        bundleReady: false,
        isGenerating: false,
        settling: true,
        broken: false,
        iframeReady: false,
      }),
    ).toBe('baking');
    expect(
      previewStageFace({
        previewUrl: 'http://127.0.0.1/v1/preview-dist/x/index.html',
        bundleReady: false,
        isGenerating: false,
        settling: true,
        broken: false,
        iframeReady: true,
      }),
    ).toBe('live');
    expect(
      previewStageFace({
        previewUrl: 'http://127.0.0.1/v1/preview-dist/x/index.html',
        bundleReady: true,
        isGenerating: false,
        broken: false,
        iframeReady: true,
      }),
    ).toBe('live');
    expect(
      previewStageFace({
        previewUrl: 'http://127.0.0.1/v1/preview-dist/x/index.html',
        bundleReady: false,
        isGenerating: false,
        broken: true,
        iframeReady: true,
        confirmedByIframe: true,
      }),
    ).toBe('broken');
    expect(
      previewStageFace({
        previewUrl: 'http://127.0.0.1/v1/preview-dist/x/index.html',
        bundleReady: false,
        isGenerating: false,
        broken: true,
        iframeReady: false,
        phaserLive: true,
      }),
    ).toBe('live');
    expect(readWorldAssetProgress(['小镇立绘 6/10 · 小荷'])).toEqual({
      done: 6,
      total: 10,
    });
    expect(
      studioOverlayGenerateFailed({
        hasCurrentWorldFail: true,
        generationState: 'preview',
        jobLifecycleStatus: 'done',
      }),
    ).toBe(false);
    expect(
      studioOverlayGenerateFailed({
        hasCurrentWorldFail: true,
        generationState: 'error',
        jobLifecycleStatus: 'failed',
      }),
    ).toBe(true);
  });

  it('does not offer a lease refetch after the world job already failed', () => {
    expect(
      previewRetryKind({
        reason: 'not-found',
        generateFailed: true,
      }),
    ).toBe('job');
    expect(
      previewRetryKind({
        reason: 'http',
        isGenerating: false,
        leaseAttempts: 0,
      }),
    ).toBe('rebuild');
    expect(
      previewRetryKind({
        reason: 'not-found',
        isGenerating: false,
        leaseAttempts: 0,
      }),
    ).toBe('rebuild');
    expect(
      previewRetryKind({
        reason: 'cors',
        isGenerating: false,
        leaseAttempts: 0,
      }),
    ).toBe('lease');
    expect(
      previewRetryKind({
        reason: 'http',
        leaseAttempts: 1,
      }),
    ).toBe('rebuild');
    expect(
      previewRetryKind({
        reason: 'not-found',
        isGenerating: true,
        generateFailed: true,
      }),
    ).toBe('wait');
    expect(previewHintKey('rebuild', 'http')).toBe(
      'preview.diag.hintMissingPack',
    );
    expect(previewHintKey('rebuild', 'syntax')).toBe('preview.diag.hint');
    expect(shortenPreviewFailedUrl('https://short.example/a.js')).toBe(
      'https://short.example/a.js',
    );
    expect(
      shortenPreviewFailedUrl(
        'http://127.0.0.1:3847/v1/preview-dist/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/very-long-token/index.html',
        40,
      ),
    ).toMatch(/…/);
  });

  it('does not treat a 404 as a healthy preview', async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response('missing', { status: 404 })) as typeof fetch;
    try {
      const result = await probePreviewBundle('https://cdn.example/preview/');
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('not-found');
      expect(result.statusCode).toBe(404);
      expect(result.failedUrl).toBe('https://cdn.example/preview/');
    } finally {
      globalThis.fetch = orig;
    }
  });
});
