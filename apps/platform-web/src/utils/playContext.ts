/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * The play iframe is a published static build. It cannot read the parent's
 * JWT, so the only thing we can honestly give it is the community game id —
 * the parent then owns submitting the score.
 */

export const OG_GAME_ID_PARAM = 'ogGameId';
export const OG_DEPLOYMENT_PARAM = 'ogDeploymentId';
export const SCORE_MESSAGE_TYPE = 'opengame:score';
export const SESSION_MESSAGE_TYPE = 'opengame:session';

export function withPlayDeploymentContext(url: string, deploymentId: string): string {
  if (!url || !deploymentId) return url;
  try {
    const parsed = new URL(url, 'https://opengame.local');
    parsed.searchParams.set(OG_DEPLOYMENT_PARAM, deploymentId);
    if (url.startsWith('/') || url.startsWith('?')) {
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
    return parsed.toString();
  } catch {
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}${OG_DEPLOYMENT_PARAM}=${encodeURIComponent(deploymentId)}`;
  }
}

export function postPlaySession(
  iframe: HTMLIFrameElement | null,
  session: { token?: string | null; deploymentId?: string | null },
): void {
  const win = iframe?.contentWindow;
  if (!win) return;
  win.postMessage(
    {
      type: SESSION_MESSAGE_TYPE,
      ...(session.token ? { token: session.token } : {}),
      ...(session.deploymentId ? { deploymentId: session.deploymentId } : {}),
    },
    '*',
  );
}

export function withCommunityPlayContext(url: string, gameId: string): string {
  if (!url || !gameId) return url;
  try {
    const parsed = new URL(url, 'https://opengame.local');
    parsed.searchParams.set(OG_GAME_ID_PARAM, gameId);
    if (url.startsWith('/') || url.startsWith('?')) {
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
    return parsed.toString();
  } catch {
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}${OG_GAME_ID_PARAM}=${encodeURIComponent(gameId)}`;
  }
}

export interface PlayScoreMessage {
  readonly type: typeof SCORE_MESSAGE_TYPE;
  readonly score: number;
  readonly playerName?: string;
  readonly gameId?: string;
}

export function parsePlayScoreMessage(data: unknown): PlayScoreMessage | null {
  if (!data || typeof data !== 'object') return null;
  const raw = data as Record<string, unknown>;
  if (raw['type'] !== SCORE_MESSAGE_TYPE) return null;
  const score = raw['score'];
  if (typeof score !== 'number' || !Number.isFinite(score) || score < 0) return null;
  return {
    type: SCORE_MESSAGE_TYPE,
    score,
    ...(typeof raw['playerName'] === 'string' ? { playerName: raw['playerName'] } : {}),
    ...(typeof raw['gameId'] === 'string' ? { gameId: raw['gameId'] } : {}),
  };
}
