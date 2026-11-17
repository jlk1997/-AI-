/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

export interface LeaderboardEntry {
  readonly rank: number;
  readonly playerName: string;
  readonly score: number;
  readonly achievedAt: string;
  readonly metadata?: Record<string, unknown>;
}

export interface LeaderboardOptions {
  /** Game id assigned by the platform after publish. Required for remote submit. */
  readonly gameId?: string;
  /** Override API base; defaults to relative `/v1` from the host page. */
  readonly apiBaseUrl?: string;
}

export const SCORE_MESSAGE_TYPE = 'opengame:score';
const OG_GAME_ID_PARAM = 'ogGameId';

function gameIdFromLocation(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    return new URLSearchParams(window.location.search).get(OG_GAME_ID_PARAM) || undefined;
  } catch {
    return undefined;
  }
}

function postScoreToParent(payload: {
  readonly score: number;
  readonly playerName: string;
  readonly metadata?: Record<string, unknown>;
  readonly gameId?: string;
}): void {
  if (typeof window === 'undefined') return;
  if (!window.parent || window.parent === window) return;
  window.parent.postMessage({ type: SCORE_MESSAGE_TYPE, ...payload }, '*');
}

/**
 * Submit/fetch scores against the platform's `/community/games/:id/scores`
 * and `/leaderboard` endpoints. Falls back to no-op when `gameId` is absent
 * (e.g. during development preview before publish).
 *
 * Community play loads this runtime inside an iframe on a different origin
 * than the signed-in parent, so a direct POST cannot carry the JWT. When
 * framed, we also post the score to the parent — that is the path that
 * actually lands on the community leaderboard.
 */
export class Leaderboard {
  constructor(private readonly opts: LeaderboardOptions = {}) {}

  private gameId(): string | undefined {
    return this.opts.gameId || gameIdFromLocation();
  }

  private base(): string {
    return this.opts.apiBaseUrl ?? '/v1';
  }

  async submit(
    score: number,
    playerName = 'Anonymous',
    metadata?: Record<string, unknown>,
  ): Promise<{ rank: number } | null> {
    const gameId = this.gameId();
    postScoreToParent({ score, playerName, metadata, gameId });
    if (!gameId) return null;
    if (typeof fetch === 'undefined') return null;
    const res = await fetch(
      `${this.base()}/community/games/${gameId}/scores`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ score, playerName, metadata }),
      },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { rank?: number };
    return { rank: data.rank ?? 0 };
  }

  async top(limit = 10): Promise<LeaderboardEntry[]> {
    const gameId = this.gameId();
    if (!gameId || typeof fetch === 'undefined') return [];
    const res = await fetch(
      `${this.base()}/community/games/${gameId}/leaderboard?limit=${limit}`,
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { leaderboard?: LeaderboardEntry[] };
    return data.leaderboard ?? [];
  }
}
