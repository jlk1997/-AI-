/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  parsePlayScoreMessage,
  SCORE_MESSAGE_TYPE,
  withCommunityPlayContext,
  withPlayDeploymentContext,
} from './playContext';

describe('withCommunityPlayContext', () => {
  it('stamps a relative preview URL without rewriting the host', () => {
    expect(
      withCommunityPlayContext('/v1/preview-dist/dep/tok/index.html?mode=play', 'g1'),
    ).toBe('/v1/preview-dist/dep/tok/index.html?mode=play&ogGameId=g1');
  });

  it('keeps an absolute URL intact besides the id', () => {
    expect(
      withCommunityPlayContext('https://cdn.example/game/index.html', 'abc'),
    ).toBe('https://cdn.example/game/index.html?ogGameId=abc');
  });
});

describe('withPlayDeploymentContext', () => {
  it('stamps ogDeploymentId on a relative URL', () => {
    expect(
      withPlayDeploymentContext('/v1/preview-dist/dep/tok/index.html', 'd1'),
    ).toBe('/v1/preview-dist/dep/tok/index.html?ogDeploymentId=d1');
  });
});

describe('parsePlayScoreMessage', () => {
  it('accepts a score the framed game posted', () => {
    expect(
      parsePlayScoreMessage({
        type: SCORE_MESSAGE_TYPE,
        score: 1200,
        playerName: 'Ada',
        gameId: 'g1',
      }),
    ).toEqual({
      type: SCORE_MESSAGE_TYPE,
      score: 1200,
      playerName: 'Ada',
      gameId: 'g1',
    });
  });

  it('rejects junk', () => {
    expect(parsePlayScoreMessage({ type: 'other', score: 1 })).toBeNull();
    expect(parsePlayScoreMessage({ type: SCORE_MESSAGE_TYPE, score: -1 })).toBeNull();
    expect(parsePlayScoreMessage(null)).toBeNull();
  });
});
