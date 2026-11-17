/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Real text embeddings for memory retrieval.
 *
 * Retrieval scored relevance with a 64-dim hashed bag-of-tokens, so "听说矿里
 * 出事了" and "矿道塌了" shared no signal and the relevance term was effectively
 * noise. Every remembered detail was equally retrievable, which is why agents
 * never sounded like they had a history.
 *
 * Vectors are folded down to a small dimension before storage: society state is
 * rewritten to Postgres on every tick, and 1536 floats per memory row would
 * dominate the tick budget.
 */

import { hashEmbed, HASH_EMBED_DIM } from './embed.js';

export type EmbedTextsFn = (texts: readonly string[]) => Promise<number[][]>;

/** Stored dimension. Must differ from {@link HASH_EMBED_DIM} so mixed spaces
 * are detectable rather than silently compared. */
export const DEFAULT_EMBED_DIM = 128;

/**
 * Count-sketch style fold: unbiased for inner products, O(n), and keeps rows
 * small enough to persist every tick.
 */
export function foldEmbedding(
  vec: readonly number[],
  dim = DEFAULT_EMBED_DIM,
): number[] {
  if (vec.length === dim) return normalize([...vec]);
  const out = new Array<number>(dim).fill(0);
  for (let i = 0; i < vec.length; i++) {
    let h = 2166136261 ^ i;
    h = Math.imul(h, 16777619);
    h ^= h >>> 13;
    const idx = Math.abs(h) % dim;
    const sign = (h & 1) === 0 ? 1 : -1;
    out[idx]! += vec[i]! * sign;
  }
  return normalize(out);
}

function normalize(v: number[]): number[] {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map((x) => x / n);
}

export type EmbedDialect = 'openai' | 'minimax';

export interface EmbedderOptions {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly dialect?: EmbedDialect;
  readonly dim?: number;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

function parseVectors(body: unknown): number[][] | undefined {
  const obj = body as {
    data?: Array<{ embedding?: unknown }>;
    vectors?: unknown;
  };
  if (Array.isArray(obj?.vectors)) {
    const rows = obj.vectors.filter(Array.isArray) as number[][];
    if (rows.length) return rows;
  }
  if (Array.isArray(obj?.data)) {
    const rows = obj.data
      .map((d) => d?.embedding)
      .filter(Array.isArray) as number[][];
    if (rows.length) return rows;
  }
  return undefined;
}

export function createEmbedder(options: EmbedderOptions): EmbedTextsFn {
  const dim = options.dim ?? DEFAULT_EMBED_DIM;
  const dialect =
    options.dialect ??
    (/minimax/i.test(options.baseUrl) ? 'minimax' : 'openai');
  const url = `${options.baseUrl.replace(/\/+$/, '')}/embeddings`;
  const doFetch = options.fetchImpl ?? fetch;
  return async (texts) => {
    if (!texts.length) return [];
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      options.timeoutMs ?? 8_000,
    );
    try {
      const body =
        dialect === 'minimax'
          ? { model: options.model, texts: [...texts], type: 'db' }
          : { model: options.model, input: [...texts] };
      const res = await doFetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`embed ${res.status}`);
      }
      const vectors = parseVectors(await res.json());
      if (!vectors || vectors.length !== texts.length) {
        throw new Error('embed response shape');
      }
      return vectors.map((v) => foldEmbedding(v, dim));
    } finally {
      clearTimeout(timer);
    }
  };
}

/** Memoize by text so repeated plan/converse queries cost one call. */
export function createCachedEmbedder(
  fn: EmbedTextsFn,
  maxEntries = 4_000,
): EmbedTextsFn {
  const cache = new Map<string, number[]>();
  return async (texts) => {
    const missing = [...new Set(texts.filter((t) => !cache.has(t)))];
    if (missing.length) {
      const vectors = await fn(missing);
      missing.forEach((t, i) => {
        const v = vectors[i];
        if (v) cache.set(t, v);
      });
      while (cache.size > maxEntries) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined) break;
        cache.delete(oldest);
      }
    }
    return texts.map((t) => cache.get(t) ?? foldEmbedding(hashEmbed(t)));
  };
}

/**
 * Build an embedder from env, or undefined to keep the deterministic hash
 * fallback (tests and offline runs must not need network).
 */
export function embedderFromEnv(
  env: Record<string, string | undefined> = process.env,
): EmbedTextsFn | undefined {
  const mode = (env['WORLD_EMBED_PROVIDER'] ?? 'auto').toLowerCase();
  if (mode === 'none' || mode === 'off' || mode === 'false') return undefined;
  const apiKey =
    env['WORLD_EMBED_API_KEY'] ??
    env['MINIMAX_API_KEY'] ??
    env['OPENAI_API_KEY'];
  if (!apiKey) return undefined;
  const minimax =
    mode === 'minimax' ||
    (mode === 'auto' && Boolean(env['MINIMAX_API_KEY']));
  const baseUrl =
    env['WORLD_EMBED_BASE_URL'] ??
    (minimax
      ? 'https://api.minimaxi.com/v1'
      : (env['OPENAI_BASE_URL'] ?? 'https://api.openai.com/v1'));
  const model =
    env['WORLD_EMBED_MODEL'] ??
    (minimax ? 'embo-01' : 'text-embedding-3-small');
  const dimRaw = Number(env['WORLD_EMBED_DIM']);
  return createCachedEmbedder(
    createEmbedder({
      baseUrl,
      apiKey,
      model,
      dialect: minimax ? 'minimax' : 'openai',
      dim: Number.isFinite(dimRaw) && dimRaw >= 16 ? Math.floor(dimRaw) : undefined,
      timeoutMs: Number(env['WORLD_EMBED_TIMEOUT_MS']) || undefined,
    }),
  );
}

/** Embed one query, falling back to the hash space on any provider failure. */
export async function embedQuery(
  text: string,
  embed?: EmbedTextsFn,
): Promise<number[]> {
  if (!embed) return hashEmbed(text);
  try {
    const [vec] = await embed([text]);
    if (vec?.length) return vec;
  } catch (err) {
    console.warn('[embed] query failed, using hash fallback', err);
  }
  return hashEmbed(text);
}

export function isHashSpace(vec: readonly number[] | undefined): boolean {
  return !vec?.length || vec.length === HASH_EMBED_DIM;
}

export interface EmbeddableStream {
  list(agentId: string): readonly {
    readonly id: string;
    readonly text: string;
    readonly embedding?: readonly number[];
    readonly importance: number;
    readonly simTime: number;
  }[];
  setEmbedding(agentId: string, id: string, embedding: readonly number[]): void;
}

/**
 * Upgrade memories that are still in the hash space, newest and most important
 * first, under a per-call cap so one tick cannot spend the whole token budget.
 */
export async function upgradeMemoryEmbeddings(input: {
  readonly stream: EmbeddableStream;
  readonly agentIds: readonly string[];
  readonly embed?: EmbedTextsFn;
  readonly maxTexts?: number;
}): Promise<number> {
  if (!input.embed) return 0;
  const cap = Math.max(0, input.maxTexts ?? 24);
  if (!cap) return 0;
  const pending: Array<{ agentId: string; id: string; text: string; rank: number }> =
    [];
  for (const agentId of input.agentIds) {
    for (const m of input.stream.list(agentId)) {
      if (!isHashSpace(m.embedding)) continue;
      pending.push({
        agentId,
        id: m.id,
        text: m.text,
        rank: m.simTime + m.importance,
      });
    }
  }
  if (!pending.length) return 0;
  pending.sort((a, b) => b.rank - a.rank);
  const batch = pending.slice(0, cap);
  try {
    const vectors = await input.embed(batch.map((b) => b.text));
    let n = 0;
    batch.forEach((b, i) => {
      const v = vectors[i];
      if (!v?.length) return;
      input.stream.setEmbedding(b.agentId, b.id, v);
      n += 1;
    });
    return n;
  } catch (err) {
    console.warn('[embed] memory upgrade failed, keeping hash vectors', err);
    return 0;
  }
}
