/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import {
  authedRateLimitKind,
  authedRateLimitSpec,
  isGenerateSpendRequest,
  isTightAuthedPath,
  isTightAuthedRequest,
  shouldRateLimitAnonymousV1,
} from './authedPathPolicy.js';

describe('isTightAuthedPath', () => {
  it('fails closed on privacy and spend', () => {
    expect(isTightAuthedPath('/v1/me/export')).toBe(true);
    expect(isTightAuthedPath('/v1/me/delete')).toBe(true);
    expect(isTightAuthedPath('/v1/me/appeals')).toBe(true);
    expect(isTightAuthedPath('/v1/billing/checkout/stripe')).toBe(true);
    expect(isTightAuthedPath('/v1/billing/orders')).toBe(true);
    expect(isTightAuthedPath('/v1/billing/invite')).toBe(true);
    expect(isTightAuthedPath('/v1/projects/x/world/light')).toBe(true);
    expect(isTightAuthedPath('/v1/community/games/g/world-light')).toBe(true);
    expect(isTightAuthedPath('/v1/community/games/g/town-time')).toBe(true);
    expect(isTightAuthedPath('/v1/community/games/g/tip')).toBe(true);
    expect(isTightAuthedPath('/v1/community/games/g/jiaxi')).toBe(true);
    expect(isTightAuthedPath('/v1/play-session')).toBe(true);
    expect(isTightAuthedPath('/v1/community/games/g/adopt')).toBe(true);
    expect(isTightAuthedPath('/v1/community/games/g/course/stake')).toBe(true);
    expect(isTightAuthedPath('/v1/community/games/g/course/withdraw')).toBe(true);
  });

  it('leaves alley browse fail-open', () => {
    expect(isTightAuthedPath('/v1/me')).toBe(false);
    expect(isTightAuthedPath('/v1/community/games')).toBe(false);
    expect(isTightAuthedPath('/v1/projects/x/world/society/tick')).toBe(false);
    expect(isTightAuthedPath('/v1/billing/market')).toBe(false);
    expect(isTightAuthedPath('/v1/billing/wallet')).toBe(false);
    expect(isTightAuthedPath('/v1/billing/adoptions')).toBe(false);
    expect(isTightAuthedRequest('GET', '/v1/billing/market')).toBe(false);
    expect(isTightAuthedRequest('POST', '/v1/billing/checkout/stripe')).toBe(
      true,
    );
  });

  it('fails closed on generate spend POSTs, not job reads', () => {
    expect(isTightAuthedRequest('POST', '/v1/projects/p/messages')).toBe(true);
    expect(isTightAuthedRequest('POST', '/v1/projects/p/jobs/j/retry')).toBe(true);
    expect(isTightAuthedRequest('POST', '/v1/projects/p/publish')).toBe(true);
    expect(isTightAuthedRequest('GET', '/v1/projects/p/messages')).toBe(false);
    expect(isTightAuthedRequest('GET', '/v1/projects/p/jobs/j')).toBe(false);
    expect(isGenerateSpendRequest('POST', '/v1/projects/p/messages')).toBe(true);
    expect(isGenerateSpendRequest('POST', '/v1/projects/p/publish')).toBe(false);
    expect(authedRateLimitKind('POST', '/v1/projects/p/messages')).toBe(
      'generate',
    );
    expect(authedRateLimitKind('GET', '/v1/projects/p/jobs/j')).toBe('alley');
    expect(authedRateLimitKind('POST', '/v1/projects/p/publish')).toBe('tight');
    const gen = authedRateLimitSpec(
      'POST',
      '/v1/projects/p/messages',
      'u1',
      '127.0.0.1',
    );
    const poll = authedRateLimitSpec(
      'GET',
      '/v1/projects/p/jobs/j',
      'u1',
      '127.0.0.1',
    );
    expect(gen.userKey).not.toBe(poll.userKey);
    expect(gen.ipKey).not.toBe(poll.ipKey);
  });

  it('rate-limits anonymous share cards, not play-session assets', () => {
    expect(shouldRateLimitAnonymousV1('/v1/public/games/x/share.html')).toBe(
      true,
    );
    expect(shouldRateLimitAnonymousV1('/v1/auth/magic/request')).toBe(true);
    expect(shouldRateLimitAnonymousV1('/v1/play/tok/assets/app.js')).toBe(
      false,
    );
    expect(
      shouldRateLimitAnonymousV1(
        '/v1/preview-dist/dep/tok/assets/npc_syn_20__walk.png',
      ),
    ).toBe(false);
  });
});
