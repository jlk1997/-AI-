/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash, randomBytes } from 'node:crypto';

import type { Redis } from 'ioredis';

/**
 * WeChat Official Account integration.
 *
 * Only what the product actually needs: a signed JS-SDK config so a shared
 * game carries its own card into a chat, and (in `wechatAuth`) the web OAuth
 * exchange. Everything is cached in Redis because WeChat rate-limits
 * `access_token` hard — two API replicas fetching it independently will
 * invalidate each other's token.
 */

const ACCESS_TOKEN_KEY = 'wechat:access_token';
const JSAPI_TICKET_KEY = 'wechat:jsapi_ticket';
/** WeChat issues 7200s credentials; refresh early so a request never races expiry. */
const CREDENTIAL_TTL_SECONDS = 6600;

export interface WeChatConfig {
  readonly appId: string;
  readonly appSecret: string;
}

export interface JsSdkSignature {
  readonly appId: string;
  readonly timestamp: number;
  readonly nonceStr: string;
  readonly signature: string;
}

interface TokenResponse {
  access_token?: string;
  ticket?: string;
  expires_in?: number;
  errcode?: number;
  errmsg?: string;
}

async function fetchJson(url: string): Promise<TokenResponse> {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`wechat http ${res.status}`);
  return (await res.json()) as TokenResponse;
}

/**
 * Serialized behind a short Redis lock: without it, a cold start with N
 * replicas burns N tokens and the last writer wins while the others 40001.
 */
async function cachedCredential(
  redis: Redis,
  cacheKey: string,
  producer: () => Promise<string>,
): Promise<string> {
  const hit = await redis.get(cacheKey);
  if (hit) return hit;

  const lockKey = `${cacheKey}:lock`;
  const acquired = await redis.set(lockKey, '1', 'EX', 15, 'NX');
  if (!acquired) {
    // Someone else is fetching; give them a moment rather than piling on.
    for (let i = 0; i < 20; i += 1) {
      await new Promise((r) => setTimeout(r, 150));
      const retry = await redis.get(cacheKey);
      if (retry) return retry;
    }
  }
  try {
    const value = await producer();
    await redis.set(cacheKey, value, 'EX', CREDENTIAL_TTL_SECONDS);
    return value;
  } finally {
    await redis.del(lockKey).catch(() => undefined);
  }
}

export async function getAccessToken(redis: Redis, cfg: WeChatConfig): Promise<string> {
  return cachedCredential(redis, ACCESS_TOKEN_KEY, async () => {
    const url =
      `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential` +
      `&appid=${encodeURIComponent(cfg.appId)}&secret=${encodeURIComponent(cfg.appSecret)}`;
    const data = await fetchJson(url);
    if (!data.access_token) {
      throw new Error(`wechat access_token failed: ${data.errcode} ${data.errmsg}`);
    }
    return data.access_token;
  });
}

export async function getJsApiTicket(redis: Redis, cfg: WeChatConfig): Promise<string> {
  return cachedCredential(redis, JSAPI_TICKET_KEY, async () => {
    const token = await getAccessToken(redis, cfg);
    const url =
      `https://api.weixin.qq.com/cgi-bin/ticket/getticket?type=jsapi` +
      `&access_token=${encodeURIComponent(token)}`;
    const data = await fetchJson(url);
    if (!data.ticket) {
      throw new Error(`wechat jsapi_ticket failed: ${data.errcode} ${data.errmsg}`);
    }
    return data.ticket;
  });
}

/**
 * WeChat signs the exact URL the page was loaded with, hash excluded. Signing
 * a normalized or canonical URL instead is the single most common cause of
 * `invalid signature`.
 */
export function stripUrlFragment(url: string): string {
  const hash = url.indexOf('#');
  return hash === -1 ? url : url.slice(0, hash);
}

export function signJsSdk(params: {
  readonly ticket: string;
  readonly url: string;
  readonly appId: string;
  readonly nonceStr?: string;
  readonly timestamp?: number;
}): JsSdkSignature {
  const nonceStr = params.nonceStr ?? randomBytes(8).toString('hex');
  const timestamp = params.timestamp ?? Math.floor(Date.now() / 1000);
  const url = stripUrlFragment(params.url);
  const raw =
    `jsapi_ticket=${params.ticket}` +
    `&noncestr=${nonceStr}` +
    `&timestamp=${timestamp}` +
    `&url=${url}`;
  const signature = createHash('sha1').update(raw).digest('hex');
  return { appId: params.appId, timestamp, nonceStr, signature };
}

export interface WeChatOAuthUser {
  readonly openid: string;
  readonly unionid: string | null;
  readonly nickname: string | null;
  readonly avatarUrl: string | null;
}

/**
 * Web OAuth, step 1.
 *
 * `snsapi_base` gets us an openid silently — enough to sign someone in and to
 * take a JSAPI payment — while `snsapi_userinfo` shows a consent screen and
 * returns a nickname and avatar. We ask for the loud one only when the user is
 * deliberately signing in, so that opening a shared game stays a single tap.
 */
export function buildAuthorizeUrl(params: {
  readonly appId: string;
  readonly redirectUri: string;
  readonly state: string;
  readonly scope?: 'snsapi_base' | 'snsapi_userinfo';
}): string {
  const scope = params.scope ?? 'snsapi_userinfo';
  return (
    'https://open.weixin.qq.com/connect/oauth2/authorize' +
    `?appid=${encodeURIComponent(params.appId)}` +
    `&redirect_uri=${encodeURIComponent(params.redirectUri)}` +
    '&response_type=code' +
    `&scope=${scope}` +
    `&state=${encodeURIComponent(params.state)}` +
    '#wechat_redirect'
  );
}

interface OAuthTokenResponse extends TokenResponse {
  openid?: string;
  unionid?: string;
  scope?: string;
}

interface OAuthUserResponse {
  openid?: string;
  unionid?: string;
  nickname?: string;
  headimgurl?: string;
  errcode?: number;
  errmsg?: string;
}

/**
 * Web OAuth, step 2. The token here is per-user and short-lived — deliberately
 * not the cached app token, and never cached, because a code may only be
 * redeemed once.
 */
export async function exchangeOAuthCode(
  cfg: WeChatConfig,
  code: string,
): Promise<WeChatOAuthUser & { accessToken: string; scope: string }> {
  const url =
    'https://api.weixin.qq.com/sns/oauth2/access_token' +
    `?appid=${encodeURIComponent(cfg.appId)}` +
    `&secret=${encodeURIComponent(cfg.appSecret)}` +
    `&code=${encodeURIComponent(code)}&grant_type=authorization_code`;
  const data = (await fetchJson(url)) as OAuthTokenResponse;
  if (!data.openid || !data.access_token) {
    throw new Error(`wechat oauth failed: ${data.errcode} ${data.errmsg}`);
  }
  return {
    openid: data.openid,
    unionid: data.unionid ?? null,
    nickname: null,
    avatarUrl: null,
    accessToken: data.access_token,
    scope: data.scope ?? '',
  };
}

/** Only available when the user consented via `snsapi_userinfo`. */
export async function fetchOAuthUserInfo(
  accessToken: string,
  openid: string,
): Promise<Pick<WeChatOAuthUser, 'nickname' | 'avatarUrl' | 'unionid'>> {
  const url =
    'https://api.weixin.qq.com/sns/userinfo' +
    `?access_token=${encodeURIComponent(accessToken)}` +
    `&openid=${encodeURIComponent(openid)}&lang=zh_CN`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`wechat userinfo http ${res.status}`);
  const data = (await res.json()) as OAuthUserResponse;
  if (data.errcode) {
    throw new Error(`wechat userinfo failed: ${data.errcode} ${data.errmsg}`);
  }
  return {
    nickname: data.nickname ?? null,
    avatarUrl: data.headimgurl ?? null,
    unionid: data.unionid ?? null,
  };
}

/**
 * Only sign URLs we actually serve. Without this the endpoint is an oracle
 * that signs any attacker page onto our Official Account.
 */
export function isAllowedShareUrl(url: string, allowedOrigins: readonly string[]): boolean {
  if (allowedOrigins.length === 0) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') return false;
  return allowedOrigins.some((origin) => {
    try {
      return new URL(origin).origin === parsed.origin;
    } catch {
      return false;
    }
  });
}
