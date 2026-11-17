/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Direct MiniMax image / music / speech client for worker asset materialization.
 */

import { isLlmAuthErrorLike, isLlmKeyRotateErrorLike, isLlmQuotaErrorLike } from '@opengame/platform-shared';

import { arkGenerateImagePng, ensurePngBuffer, hasArkImageCredentials } from './arkImageClient.js';

const DEFAULT_HOST = 'https://api.minimaxi.com';

/** Accumulated by asset phases for product timeline visibility. */
let providerFailoverNotes: string[] = [];

/**
 * User-visible notes only — pool exhausted / soft-skip after ALL keys fail.
 * Silent mid-pool rotations stay out of the chat UI.
 */
let userVisibleFailoverNotes: string[] = [];

/**
 * Keys that already returned Token Plan / 429 this process.
 * Avoids re-hitting a dead primary on every image/sfx slot (…bVM→…pXl0 × N).
 */
const quotaExhaustedKeys = new Set<string>();

/** Drain all failover notes since last take (order preserved). Includes internal. */
export function takeProviderFailoverNotes(): string[] {
  const n = providerFailoverNotes;
  providerFailoverNotes = [];
  return n;
}

/** Drain notes safe to show end users (pool exhausted / soft-skip only). */
export function takeUserVisibleFailoverNotes(): string[] {
  const n = userVisibleFailoverNotes;
  userVisibleFailoverNotes = [];
  return n;
}

/** Drain and return the latest note only (compat). */
export function takeProviderFailoverNote(): string | null {
  const all = takeProviderFailoverNotes();
  return all.length ? (all[all.length - 1] ?? null) : null;
}

/** Test helper — clear sticky quota marks between cases. */
export function resetMinimaxQuotaStickyKeys(): void {
  quotaExhaustedKeys.clear();
}

function noteFailover(
  msg: string,
  opts?: { readonly userVisible?: boolean },
): void {
  providerFailoverNotes.push(msg);
  if (opts?.userVisible) userVisibleFailoverNotes.push(msg);
  console.warn(`[provider-failover] ${msg}`);
}

function markKeyQuotaExhausted(key: string, modality: string): void {
  if (quotaExhaustedKeys.has(key)) return;
  quotaExhaustedKeys.add(key);
  // Sticky mark is operator/debug only — never surface as a product warning.
  console.warn(
    `[provider-failover] ${modality} mark …${key.slice(-4)} exhausted for this worker process (skip on later slots)`,
  );
}

function orderedKeysSkippingExhausted(keys: string[]): string[] {
  const live = keys.filter((k) => !quotaExhaustedKeys.has(k));
  return live.length > 0 ? live : keys;
}

export function minimaxApiHost(baseUrl?: string): string {
  const raw = (baseUrl || DEFAULT_HOST).replace(/\/+$/g, '');
  return raw.replace(/\/v1\/?$/i, '') || DEFAULT_HOST;
}

function apiKey(): string {
  return listMinimaxAudioApiKeys()[0] || listMinimaxImageApiKeys()[0] || '';
}

function splitKeys(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[,\n]/)
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

function isArkBaseUrl(url: string): boolean {
  return /volces\.com|ark\.cn-beijing/i.test(url);
}

/**
 * Ordered MiniMax image keys: primary → OPENGAME_IMAGE_API_KEYS →
 * OPENGAME_IMAGE_FALLBACK_API_KEY → MiniMax FALLBACK_* .
 * Volcengine FALLBACK keys are excluded here (handled only by the opt-in Ark path).
 */
export function listMinimaxImageApiKeys(
  env: NodeJS.ProcessEnv = process.env,
  opts?: { readonly includeFallback?: boolean },
): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  const push = (k: string): void => {
    if (!k || seen.has(k)) return;
    seen.add(k);
    keys.push(k);
  };
  push(
    env['OPENGAME_IMAGE_API_KEY'] ||
      env['OPENGAME_AUDIO_API_KEY'] ||
      env['MINIMAX_API_KEY'] ||
      env['OPENAI_API_KEY'] ||
      '',
  );
  for (const k of splitKeys(env['OPENGAME_IMAGE_API_KEYS'])) push(k);

  if (opts?.includeFallback === false) return keys;

  const imageFbBase = env['OPENGAME_IMAGE_FALLBACK_BASE_URL']?.trim() || '';
  if (!imageFbBase || !isArkBaseUrl(imageFbBase)) {
    for (const k of splitKeys(env['OPENGAME_IMAGE_FALLBACK_API_KEY'])) push(k);
  }

  const fbBase =
    env['OPENGAME_FALLBACK_BASE_URL']?.trim() ||
    env['OPENAI_FALLBACK_BASE_URL']?.trim() ||
    '';
  if (!fbBase || !isArkBaseUrl(fbBase)) {
    for (const k of splitKeys(env['OPENGAME_FALLBACK_API_KEYS'])) push(k);
    for (const k of splitKeys(env['OPENGAME_FALLBACK_API_KEY'])) push(k);
    for (const k of splitKeys(env['OPENAI_FALLBACK_API_KEYS'])) push(k);
    for (const k of splitKeys(env['OPENAI_FALLBACK_API_KEY'])) push(k);
  }
  return keys;
}

/** Same key order as image — music / speech share MiniMax account quotas. */
export function listMinimaxAudioApiKeys(
  env: NodeJS.ProcessEnv = process.env,
  opts?: { readonly includeFallback?: boolean },
): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  const push = (k: string): void => {
    if (!k || seen.has(k)) return;
    seen.add(k);
    keys.push(k);
  };
  push(
    env['OPENGAME_AUDIO_API_KEY'] ||
      env['OPENGAME_IMAGE_API_KEY'] ||
      env['MINIMAX_API_KEY'] ||
      env['OPENAI_API_KEY'] ||
      '',
  );
  for (const k of splitKeys(env['OPENGAME_AUDIO_API_KEYS'])) push(k);
  for (const k of splitKeys(env['OPENGAME_IMAGE_API_KEYS'])) push(k);

  if (opts?.includeFallback === false) return keys;

  const audioFbBase = env['OPENGAME_AUDIO_FALLBACK_BASE_URL']?.trim() || '';
  if (!audioFbBase || !isArkBaseUrl(audioFbBase)) {
    for (const k of splitKeys(env['OPENGAME_AUDIO_FALLBACK_API_KEY'])) push(k);
  }
  const fbBase =
    env['OPENGAME_FALLBACK_BASE_URL']?.trim() ||
    env['OPENAI_FALLBACK_BASE_URL']?.trim() ||
    '';
  if (!fbBase || !isArkBaseUrl(fbBase)) {
    for (const k of splitKeys(env['OPENGAME_FALLBACK_API_KEYS'])) push(k);
    for (const k of splitKeys(env['OPENGAME_FALLBACK_API_KEY'])) push(k);
  }
  return keys;
}

export function hasMinimaxCredentials(): boolean {
  return listMinimaxImageApiKeys().length > 0;
}

async function minimaxGenerateImagePngWithKey(
  key: string,
  options: {
    readonly prompt: string;
    readonly aspectRatio?: string;
    readonly subjectReferenceImageFile?: string;
  },
): Promise<Buffer> {
  const host = minimaxApiHost(
    process.env['OPENGAME_IMAGE_BASE_URL'] || process.env['OPENAI_BASE_URL'],
  );
  const model = process.env['OPENGAME_IMAGE_MODEL'] || 'image-01';
  const body: Record<string, unknown> = {
    model,
    prompt: options.prompt.slice(0, 1500),
    aspect_ratio: options.aspectRatio ?? '1:1',
    response_format: 'url',
    n: 1,
  };
  const ref = options.subjectReferenceImageFile?.trim();
  if (ref) {
    body['subject_reference'] = [
      {
        type: 'character',
        image_file: ref.slice(0, 8_000_000),
      },
    ];
  }
  const res = await fetch(`${host}/v1/image_generation`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`MiniMax image HTTP ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    data?: { image_urls?: string[]; image_base64?: string[] };
    base_resp?: { status_code?: number; status_msg?: string };
  };
  if (
    typeof data.base_resp?.status_code === 'number' &&
    data.base_resp.status_code !== 0
  ) {
    throw new Error(
      `MiniMax image status ${data.base_resp.status_code} ${data.base_resp.status_msg ?? ''}`,
    );
  }
  const url = data.data?.image_urls?.[0];
  if (url) {
    const img = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!img.ok) throw new Error(`Download image failed HTTP ${img.status}`);
    return Buffer.from(await img.arrayBuffer());
  }
  const b64 = data.data?.image_base64?.[0];
  if (b64) return Buffer.from(b64, 'base64');
  throw new Error('MiniMax image returned no url/base64');
}

/**
 * MiniMax image generation with dual-key rotation.
 * Order: primary MiniMax keys → MiniMax FALLBACK_* → (opt-in) Volcengine Ark only
 * when FALLBACK base URL is explicitly Ark.
 */
export async function minimaxGenerateImagePng(options: {
  readonly prompt: string;
  readonly aspectRatio?: string;
  /** Public URL or data:image/...;base64,... for MiniMax subject_reference (character). */
  readonly subjectReferenceImageFile?: string;
  /** Paid generate / world_generate may rotate onto MiniMax FALLBACK + Ark. */
  readonly allowFallback?: boolean;
}): Promise<Buffer> {
  const allKeys = listMinimaxImageApiKeys(process.env, {
    includeFallback: options.allowFallback !== false,
  });
  const keys = orderedKeysSkippingExhausted(allKeys);
  if (keys.length === 0) {
    throw new Error('MiniMax API key missing for image generation');
  }

  let lastErr: unknown;
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i]!;
    try {
      const raw = await minimaxGenerateImagePngWithKey(key, options);
      return ensurePngBuffer(raw);
    } catch (err) {
      lastErr = err;
      const rotatable = isLlmKeyRotateErrorLike(err);
      if (rotatable) markKeyQuotaExhausted(key, 'image');
      const moreKeys = i < keys.length - 1;
      if (!rotatable || !moreKeys) {
        if (!rotatable) throw err;
        const authPoolDead = isLlmAuthErrorLike(err) && !isLlmQuotaErrorLike(err);
        noteFailover(
          authPoolDead
            ? `出图失败：MiniMax Key 池鉴权均失败（末路 …${key.slice(-4)}）`
            : `出图失败：MiniMax Key 池已全部额度满（末路 …${key.slice(-4)}）`,
          { userVisible: true },
        );
        break;
      }
      const why =
        err instanceof Error
          ? err.message.replace(/\s+/g, ' ').slice(0, 160)
          : String(err).slice(0, 160);
      const next = keys[i + 1]!;
      noteFailover(
        `image silent rotate …${key.slice(-4)}→…${next.slice(-4)} (${why})`,
      );
    }
  }

  if (
    options.allowFallback !== false &&
    lastErr &&
    isLlmKeyRotateErrorLike(lastErr) &&
    hasArkImageCredentials()
  ) {
    const why =
      lastErr instanceof Error
        ? lastErr.message.replace(/\s+/g, ' ').slice(0, 160)
        : String(lastErr).slice(0, 160);
    noteFailover(`image minimax→doubao/ark (Seedream) because: ${why}`);
    return arkGenerateImagePng({
      prompt: options.prompt,
      aspectRatio: options.aspectRatio,
    });
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(String(lastErr ?? 'MiniMax image failed'));
}

async function minimaxGenerateMusicMp3WithKey(
  key: string,
  options: { readonly prompt: string },
): Promise<Buffer> {
  const host = minimaxApiHost(
    process.env['OPENGAME_AUDIO_BASE_URL'] ||
      process.env['OPENGAME_IMAGE_BASE_URL'] ||
      process.env['OPENAI_BASE_URL'],
  );
  const model = process.env['OPENGAME_AUDIO_MUSIC_MODEL'] || 'music-2.6';
  const res = await fetch(`${host}/v1/music_generation`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      prompt: options.prompt.slice(0, 500),
      stream: false,
      output_format: 'hex',
      is_instrumental: true,
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`MiniMax music HTTP ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    data?: { status?: number; audio?: string };
    base_resp?: { status_code?: number; status_msg?: string };
  };
  if (
    typeof data.base_resp?.status_code === 'number' &&
    data.base_resp.status_code !== 0
  ) {
    throw new Error(
      `MiniMax music status ${data.base_resp.status_code} ${data.base_resp.status_msg ?? ''}`,
    );
  }
  const hex = data.data?.audio;
  if (!hex || data.data?.status !== 2) {
    throw new Error('MiniMax music: missing completed hex audio');
  }
  return Buffer.from(hex, 'hex');
}

/** MiniMax instrumental music (throws on failure including quota). */
export async function minimaxGenerateMusicMp3(options: {
  readonly prompt: string;
  readonly allowFallback?: boolean;
}): Promise<Buffer> {
  const keys = orderedKeysSkippingExhausted(
    listMinimaxAudioApiKeys(process.env, {
      includeFallback: options.allowFallback !== false,
    }),
  );
  if (keys.length === 0) throw new Error('MiniMax API key missing for music');
  let lastErr: unknown;
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i]!;
    try {
      return await minimaxGenerateMusicMp3WithKey(key, options);
    } catch (err) {
      lastErr = err;
      const rotatable = isLlmKeyRotateErrorLike(err);
      if (rotatable) markKeyQuotaExhausted(key, 'audio music');
      if (!rotatable || i >= keys.length - 1) {
        if (!rotatable) throw err;
        const authPoolDead = isLlmAuthErrorLike(err) && !isLlmQuotaErrorLike(err);
        noteFailover(
          authPoolDead
            ? `音效失败：MiniMax Key 池音乐鉴权均失败（末路 …${key.slice(-4)}）`
            : `音效失败：MiniMax Key 池音乐额度已全部用尽（末路 …${key.slice(-4)}）`,
          { userVisible: true },
        );
        break;
      }
      const why =
        err instanceof Error
          ? err.message.replace(/\s+/g, ' ').slice(0, 120)
          : String(err).slice(0, 120);
      noteFailover(
        `audio music silent rotate …${key.slice(-4)}→…${keys[i + 1]!.slice(-4)} (${why})`,
      );
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(String(lastErr ?? 'MiniMax music failed'));
}

/**
 * MiniMax music; on quota after all keys returns null so callers can keep
 * prior audio / juice (no non-MiniMax music failover).
 */
/** MiniMax retired `/v1/music_generation` for new accounts (HTTP 410 / 2153). */
export function isRetiredMinimaxMusicError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return (
    /music HTTP 410/i.test(msg) ||
    /status_code["\s:=]+2153\b/.test(msg) ||
    /Music API is no longer available/i.test(msg) ||
    /no longer available to new users/i.test(msg)
  );
}

export async function tryMinimaxGenerateMusicMp3(options: {
  readonly prompt: string;
  readonly allowFallback?: boolean;
}): Promise<Buffer | null> {
  try {
    return await minimaxGenerateMusicMp3(options);
  } catch (err) {
    const why =
      err instanceof Error
        ? err.message.replace(/\s+/g, ' ').slice(0, 120)
        : String(err).slice(0, 120);
    if (isRetiredMinimaxMusicError(err)) {
      noteFailover('音效已跳过：MiniMax 旧音乐接口已下线（410），沿用已有音乐', {
        userVisible: true,
      });
      return null;
    }
    if (isLlmQuotaErrorLike(err)) {
      noteFailover('音效已跳过：MiniMax 音乐额度用尽，沿用已有音乐', {
        userVisible: true,
      });
      return null;
    }
    noteFailover(`音效已跳过：音乐接口失败，沿用已有音乐（${why}）`, {
      userVisible: true,
    });
    return null;
  }
}

async function minimaxGenerateSpeechMp3WithKey(
  key: string,
  options: { readonly text: string },
): Promise<Buffer> {
  const host = minimaxApiHost(
    process.env['OPENGAME_AUDIO_BASE_URL'] ||
      process.env['OPENGAME_IMAGE_BASE_URL'] ||
      process.env['OPENAI_BASE_URL'],
  );
  const model = process.env['OPENGAME_AUDIO_SPEECH_MODEL'] || 'speech-2.8-turbo';
  const voiceId = process.env['OPENGAME_AUDIO_VOICE_ID'] || 'male-qn-qingse';
  const res = await fetch(`${host}/v1/t2a_v2`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      text: options.text.slice(0, 200),
      stream: false,
      voice_setting: { voice_id: voiceId, speed: 1, vol: 1, pitch: 0 },
      audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3' },
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`MiniMax speech HTTP ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    data?: { audio?: string };
    base_resp?: { status_code?: number; status_msg?: string };
  };
  if (
    typeof data.base_resp?.status_code === 'number' &&
    data.base_resp.status_code !== 0
  ) {
    throw new Error(
      `MiniMax speech status ${data.base_resp.status_code} ${data.base_resp.status_msg ?? ''}`,
    );
  }
  const hex = data.data?.audio;
  if (!hex) throw new Error('MiniMax speech: missing audio hex');
  return Buffer.from(hex, 'hex');
}

/** MiniMax speech/SFX (throws on failure including quota). */
export async function minimaxGenerateSpeechMp3(options: {
  readonly text: string;
  readonly allowFallback?: boolean;
}): Promise<Buffer> {
  const keys = orderedKeysSkippingExhausted(
    listMinimaxAudioApiKeys(process.env, {
      includeFallback: options.allowFallback !== false,
    }),
  );
  if (keys.length === 0) throw new Error('MiniMax API key missing for speech/SFX');
  let lastErr: unknown;
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i]!;
    try {
      return await minimaxGenerateSpeechMp3WithKey(key, options);
    } catch (err) {
      lastErr = err;
      const rotatable = isLlmKeyRotateErrorLike(err);
      if (rotatable) markKeyQuotaExhausted(key, 'audio speech');
      if (!rotatable || i >= keys.length - 1) {
        if (!rotatable) throw err;
        const authPoolDead = isLlmAuthErrorLike(err) && !isLlmQuotaErrorLike(err);
        noteFailover(
          authPoolDead
            ? `音效失败：MiniMax Key 池语音鉴权均失败（末路 …${key.slice(-4)}）`
            : `音效失败：MiniMax Key 池语音额度已全部用尽（末路 …${key.slice(-4)}）`,
          { userVisible: true },
        );
        break;
      }
      const why =
        err instanceof Error
          ? err.message.replace(/\s+/g, ' ').slice(0, 120)
          : String(err).slice(0, 120);
      noteFailover(
        `audio speech silent rotate …${key.slice(-4)}→…${keys[i + 1]!.slice(-4)} (${why})`,
      );
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(String(lastErr ?? 'MiniMax speech failed'));
}

/** Speech/SFX; on quota after all keys returns null so callers can keep prior files. */
export async function tryMinimaxGenerateSpeechMp3(options: {
  readonly text: string;
  readonly allowFallback?: boolean;
}): Promise<Buffer | null> {
  try {
    return await minimaxGenerateSpeechMp3(options);
  } catch (err) {
    const why =
      err instanceof Error
        ? err.message.replace(/\s+/g, ' ').slice(0, 120)
        : String(err).slice(0, 120);
    if (isLlmQuotaErrorLike(err)) {
      noteFailover('音效已跳过：MiniMax 语音额度用尽，沿用已有音效', {
        userVisible: true,
      });
      return null;
    }
    noteFailover(`音效已跳过：语音接口失败，沿用已有音效（${why}）`, {
      userVisible: true,
    });
    return null;
  }
}
