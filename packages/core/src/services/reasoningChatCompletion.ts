/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { type ProviderName } from './providerConfig.js';
import { withProviderPoolFailover } from './providerPool.js';

/** MiniMax OpenAI-compat chat embeds optional `<think>…</think>` blocks. */
export function stripInterleavedThinking(content: string): string {
  return content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

export interface ChatMessage {
  role: string;
  content: string;
}

export interface PostChatCompletionsOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  /** Max completion tokens (OpenAI `max_tokens` or MiniMax `max_completion_tokens`). */
  maxTokens?: number;
  stream?: boolean;
  responseFormat?: { type: string };
  /** OpenGame-only extension for providers that support chain-of-thought flags. */
  thinking?: { type: string };
  signal?: AbortSignal;
  provider: ProviderName;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message: string;
  };
}

function trimSlashes(url: string): string {
  return url.replace(/\/+$/g, '');
}

async function postOpenAiChatCompletionOnce(
  options: PostChatCompletionsOptions,
): Promise<string> {
  const {
    baseUrl,
    apiKey,
    model,
    messages,
    temperature = 0.7,
    maxTokens = 2048,
    stream = false,
    responseFormat,
    thinking,
    signal,
    provider,
  } = options;

  const root = trimSlashes(baseUrl);
  const url = `${root}/chat/completions`;

  const body: Record<string, unknown> = {
    model,
    messages,
    temperature,
    stream,
  };

  if (provider === 'minimax') {
    body['max_completion_tokens'] = maxTokens;
    // M3 defaults thinking ON if omitted. Short JSON (classify / ABC / talks)
    // should skip it; callers that want CoT pass `thinking: { type: 'adaptive' }`.
    body['thinking'] = thinking ?? { type: 'disabled' };
    if (responseFormat) {
      body['response_format'] = responseFormat;
    }
  } else {
    body['max_tokens'] = maxTokens;
    if (responseFormat) {
      body['response_format'] = responseFormat;
    }
    if (thinking !== undefined) {
      body['thinking'] = thinking;
    }
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Chat completion failed: ${response.status} - ${errorBody}`);
  }

  const data = (await response.json()) as ChatCompletionResponse;

  if (data.error) {
    throw new Error(`Model API error: ${data.error.message}`);
  }

  const raw = data.choices?.[0]?.message?.content;
  if (!raw) {
    throw new Error('No content returned from the model');
  }

  return provider === 'minimax' ? stripInterleavedThinking(raw) : raw;
}

/**
 * POST /chat/completions against an OpenAI-compatible base (includes MiniMax
 * `https://api.minimaxi.com/v1` per
 * https://platform.minimaxi.com/docs/api-reference/text-chat-openai.md).
 * On quota/429/arrears, rotates through the reasoning key pool
 * (OPENGAME_REASONING_API_KEYS + OPENGAME_FALLBACK_*) instead of retrying the
 * same exhausted key.
 */
export async function postOpenAiChatCompletion(
  options: PostChatCompletionsOptions,
): Promise<string> {
  return withProviderPoolFailover(
    'reasoning',
    options.provider,
    () => postOpenAiChatCompletionOnce(options),
    (cfg) =>
      postOpenAiChatCompletionOnce({
        ...options,
        baseUrl: cfg.baseUrl,
        apiKey: cfg.apiKey,
        model: cfg.model,
        provider: cfg.provider,
      }),
  );
}
