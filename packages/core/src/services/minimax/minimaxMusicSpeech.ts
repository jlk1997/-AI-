/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * MiniMax **music** and **speech** HTTP clients (`music_generation`, `t2a_v2`).
 *
 * When `OPENGAME_AUDIO_PROVIDER=minimax`, `generate_game_assets` calls these
 * first for BGM/SFX MP3; helpers also remain available for direct imports.
 *
 * @see https://platform.minimaxi.com/docs/api-reference/music-generation.md
 * @see https://platform.minimaxi.com/docs/api-reference/speech-t2a-http.md
 */

const DEFAULT_HOST = 'https://api.minimaxi.com';

/**
 * Music / speech endpoints live on the API host root (`/v1/music_generation`,
 * `/v1/t2a_v2`). OpenGame's audio **chat** base may be `.../v1` for
 * `/v1/chat/completions` — strip a trailing `/v1` so we never call `/v1/v1/...`.
 */
export function minimaxMultimodalApiHost(baseUrl?: string): string {
  const raw = (baseUrl || DEFAULT_HOST).replace(/\/+$/g, '');
  return raw.replace(/\/v1\/?$/i, '') || DEFAULT_HOST;
}

function apiRoot(baseUrl?: string): string {
  return minimaxMultimodalApiHost(baseUrl);
}

function assertMiniMaxBase(
  data: { base_resp?: { status_code?: number; status_msg?: string } },
  ctx: string,
): void {
  const code = data.base_resp?.status_code;
  if (typeof code === 'number' && code !== 0) {
    throw new Error(
      `MiniMax ${ctx}: ${code} ${data.base_resp?.status_msg ?? ''}`,
    );
  }
}

export interface MusicGenerationParams {
  apiKey: string;
  /** API host, default https://api.minimaxi.com */
  baseUrl?: string;
  model: string;
  prompt: string;
  lyrics?: string;
  isInstrumental?: boolean;
  lyricsOptimizer?: boolean;
  outputFormat?: 'url' | 'hex';
}

/**
 * Calls `POST /v1/music_generation`. When `output_format` is `hex`, returns raw
 * bytes decoded from the hex string in `data.audio`.
 */
export async function minimaxGenerateMusic(
  params: MusicGenerationParams,
): Promise<{ audioBytes: Buffer; mime: string }> {
  const root = apiRoot(params.baseUrl);
  const url = `${root}/v1/music_generation`;
  const output_format = params.outputFormat ?? 'hex';

  const body: Record<string, unknown> = {
    model: params.model,
    prompt: params.prompt,
    stream: false,
    output_format,
  };
  if (params.lyrics !== undefined) body['lyrics'] = params.lyrics;
  if (params.isInstrumental !== undefined) {
    body['is_instrumental'] = params.isInstrumental;
  }
  if (params.lyricsOptimizer !== undefined) {
    body['lyrics_optimizer'] = params.lyricsOptimizer;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`MiniMax music_generation failed: ${res.status} ${t}`);
  }

  const data = (await res.json()) as {
    data?: { status?: number; audio?: string };
    base_resp?: { status_code?: number; status_msg?: string };
  };
  assertMiniMaxBase(data, 'music_generation');

  const hex = data.data?.audio;
  if (!hex || data.data?.status !== 2) {
    throw new Error('MiniMax music_generation: missing completed hex audio');
  }

  const audioBytes = Buffer.from(hex, 'hex');
  return { audioBytes, mime: 'audio/mpeg' };
}

export interface SpeechT2AParams {
  apiKey: string;
  baseUrl?: string;
  model: string;
  text: string;
  voiceId?: string;
}

/**
 * Calls `POST /v1/t2a_v2` (sync). Decodes hex audio from the JSON payload.
 */
export async function minimaxSpeechT2A(
  params: SpeechT2AParams,
): Promise<Buffer> {
  const root = apiRoot(params.baseUrl);
  const url = `${root}/v1/t2a_v2`;

  const body = {
    model: params.model,
    text: params.text,
    stream: false,
    voice_setting: {
      voice_id: params.voiceId ?? 'male-qn-qingse',
      speed: 1,
      vol: 1,
      pitch: 0,
    },
    audio_setting: {
      sample_rate: 32000,
      bitrate: 128000,
      format: 'mp3',
      channel: 1,
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`MiniMax t2a_v2 failed: ${res.status} ${t}`);
  }

  const data = (await res.json()) as {
    data?: { audio?: string };
    base_resp?: { status_code?: number; status_msg?: string };
  };
  assertMiniMaxBase(data, 't2a_v2');

  const hex = data.data?.audio;
  if (!hex) {
    throw new Error('MiniMax t2a_v2 returned no audio hex');
  }
  return Buffer.from(hex, 'hex');
}
