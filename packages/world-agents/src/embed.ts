/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Deterministic bag-of-tokens embedding for retrieval when no remote embed API.
 * Same text → same vector; good enough for cosine relevance in society sim.
 */

const DIM = 64;

/** Dimension of the offline fallback space (see `embedProvider.isHashSpace`). */
export const HASH_EMBED_DIM = DIM;

/** Stable FNV-1a style hash → unit vector dim. */
export function hashEmbed(text: string, dim = DIM): number[] {
  const v = new Array<number>(dim).fill(0);
  const tokens = text
    .toLowerCase()
    .split(/[\s,，。.!？?；;：:\-/|]+/)
    .filter((t) => t.length > 1);
  if (!tokens.length) {
    v[0] = 1;
    return v;
  }
  for (const tok of tokens) {
    let h = 2166136261;
    for (let i = 0; i < tok.length; i++) {
      h ^= tok.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const idx = Math.abs(h) % dim;
    v[idx]! += 1;
    v[(idx + 7) % dim]! += 0.35;
  }
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  return v.map((x) => x / norm);
}

export function ensureEmbedding(
  text: string,
  existing?: readonly number[],
): readonly number[] {
  if (existing && existing.length > 0) return existing;
  return hashEmbed(text);
}
