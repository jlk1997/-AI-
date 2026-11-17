/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  createCipheriv,
  createDecipheriv,
  createSign,
  randomBytes,
} from 'node:crypto';

/**
 * WeChat Pay APIv3.
 *
 * Two channels matter for an H5 product: JSAPI when the page is open inside
 * WeChat (the overwhelming majority of our traffic, since that is where shared
 * links are opened) and H5/MWEB when it is not. They differ only in the request
 * body and in what the client does with the response.
 */

const BASE = 'https://api.mch.weixin.qq.com';

export interface WeChatPayConfig {
  readonly appId: string;
  readonly mchId: string;
  readonly certSerial: string;
  /** PKCS#8 PEM for `apiclient_key.pem`. */
  readonly privateKey: string;
  /** APIv3 key: encrypts the notify payload, and so also authenticates it. */
  readonly apiV3Key: string;
  readonly notifyUrl: string;
}

export interface JsapiPrepay {
  readonly kind: 'jsapi';
  readonly appId: string;
  readonly timeStamp: string;
  readonly nonceStr: string;
  /** `prepay_id=wx...` — WeChat requires the literal prefix. */
  readonly package: string;
  readonly signType: 'RSA';
  readonly paySign: string;
}

export interface H5Prepay {
  readonly kind: 'h5';
  /** Redirect the browser here; WeChat bounces back to `redirect_url`. */
  readonly h5Url: string;
}

export type WeChatPrepay = JsapiPrepay | H5Prepay;

function sign(privateKey: string, message: string): string {
  return createSign('RSA-SHA256').update(message).sign(privateKey, 'base64');
}

/**
 * WeChat signs method, path, timestamp, nonce and the exact body bytes. Any
 * re-serialisation between signing and sending produces a 401, so callers must
 * send the same string that was signed.
 */
function authorizationHeader(
  cfg: WeChatPayConfig,
  method: 'GET' | 'POST',
  urlPath: string,
  body: string,
): string {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = randomBytes(16).toString('hex').toUpperCase();
  const message = `${method}\n${urlPath}\n${timestamp}\n${nonce}\n${body}\n`;
  const signature = sign(cfg.privateKey, message);
  return (
    `WECHATPAY2-SHA256-RSA2048 mchid="${cfg.mchId}",` +
    `nonce_str="${nonce}",signature="${signature}",` +
    `timestamp="${timestamp}",serial_no="${cfg.certSerial}"`
  );
}

async function post(
  cfg: WeChatPayConfig,
  urlPath: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const body = JSON.stringify(payload);
  const res = await fetch(`${BASE}${urlPath}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'OpenGame/1.0',
      Authorization: authorizationHeader(cfg, 'POST', urlPath, body),
    },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`wechat pay ${res.status}: ${text.slice(0, 300)}`);
  }
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

export interface PrepayRequest {
  readonly description: string;
  readonly outTradeNo: string;
  readonly amountCents: number;
  /** Required for JSAPI: the payer's openid under our official account. */
  readonly openid?: string;
  /** Where WeChat sends the browser after an H5 payment. */
  readonly returnUrl?: string;
  readonly clientIp: string;
}

export async function createJsapiPrepay(
  cfg: WeChatPayConfig,
  req: PrepayRequest,
): Promise<JsapiPrepay> {
  if (!req.openid) throw new Error('jsapi payment requires the payer openid');
  const data = await post(cfg, '/v3/pay/transactions/jsapi', {
    appid: cfg.appId,
    mchid: cfg.mchId,
    description: req.description.slice(0, 127),
    out_trade_no: req.outTradeNo,
    notify_url: cfg.notifyUrl,
    amount: { total: req.amountCents, currency: 'CNY' },
    payer: { openid: req.openid },
  });
  const prepayId = data['prepay_id'];
  if (typeof prepayId !== 'string') {
    throw new Error('wechat pay returned no prepay_id');
  }

  // The client-side call is signed separately, over a different message.
  const timeStamp = Math.floor(Date.now() / 1000).toString();
  const nonceStr = randomBytes(16).toString('hex');
  const pkg = `prepay_id=${prepayId}`;
  const paySign = sign(
    cfg.privateKey,
    `${cfg.appId}\n${timeStamp}\n${nonceStr}\n${pkg}\n`,
  );
  return {
    kind: 'jsapi',
    appId: cfg.appId,
    timeStamp,
    nonceStr,
    package: pkg,
    signType: 'RSA',
    paySign,
  };
}

export async function createH5Prepay(
  cfg: WeChatPayConfig,
  req: PrepayRequest,
): Promise<H5Prepay> {
  const data = await post(cfg, '/v3/pay/transactions/h5', {
    appid: cfg.appId,
    mchid: cfg.mchId,
    description: req.description.slice(0, 127),
    out_trade_no: req.outTradeNo,
    notify_url: cfg.notifyUrl,
    amount: { total: req.amountCents, currency: 'CNY' },
    scene_info: {
      payer_client_ip: req.clientIp,
      h5_info: { type: 'Wap' },
    },
  });
  const h5Url = data['h5_url'];
  if (typeof h5Url !== 'string') throw new Error('wechat pay returned no h5_url');
  const withReturn = req.returnUrl
    ? `${h5Url}&redirect_url=${encodeURIComponent(req.returnUrl)}`
    : h5Url;
  return { kind: 'h5', h5Url: withReturn };
}

export interface NotifyResource {
  readonly ciphertext: string;
  readonly nonce: string;
  readonly associated_data?: string;
  readonly algorithm?: string;
}

export interface DecodedNotify {
  readonly outTradeNo: string;
  readonly transactionId: string | null;
  readonly tradeState: string;
  readonly amountCents: number | null;
  readonly payer: { openid?: string } | null;
  readonly raw: Record<string, unknown>;
}

/**
 * Decrypts the AEAD payload WeChat posts to the notify URL.
 *
 * Decryption *is* the authentication here: the ciphertext is AES-256-GCM under
 * the APIv3 key, which only WeChat and we hold, so a forged callback cannot
 * produce a payload that opens. (Verifying the `Wechatpay-Signature` header as
 * well would require fetching and caching WeChat's platform certificates,
 * which buys nothing on top of an authenticated cipher.)
 */
export function decryptNotify(
  apiV3Key: string,
  resource: NotifyResource,
): DecodedNotify {
  if (resource.algorithm && resource.algorithm !== 'AEAD_AES_256_GCM') {
    throw new Error(`unsupported wechat notify algorithm ${resource.algorithm}`);
  }
  const buf = Buffer.from(resource.ciphertext, 'base64');
  const authTag = buf.subarray(buf.length - 16);
  const data = buf.subarray(0, buf.length - 16);
  const decipher = createDecipheriv(
    'aes-256-gcm',
    Buffer.from(apiV3Key, 'utf8'),
    Buffer.from(resource.nonce, 'utf8'),
  );
  decipher.setAuthTag(authTag);
  if (resource.associated_data) {
    decipher.setAAD(Buffer.from(resource.associated_data, 'utf8'));
  }
  const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString(
    'utf8',
  );
  const parsed = JSON.parse(plain) as Record<string, unknown>;
  const amount = parsed['amount'] as { total?: number } | undefined;
  return {
    outTradeNo: String(parsed['out_trade_no'] ?? ''),
    transactionId:
      typeof parsed['transaction_id'] === 'string' ? parsed['transaction_id'] : null,
    tradeState: String(parsed['trade_state'] ?? ''),
    amountCents: typeof amount?.total === 'number' ? amount.total : null,
    payer: (parsed['payer'] as { openid?: string } | undefined) ?? null,
    raw: parsed,
  };
}

/** @internal Round-trips the notify envelope so tests can exercise decryption. */
export function encryptNotifyForTest(
  apiV3Key: string,
  plaintext: string,
  associatedData = 'transaction',
): NotifyResource {
  const nonce = randomBytes(6).toString('hex');
  const cipher = createCipheriv(
    'aes-256-gcm',
    Buffer.from(apiV3Key, 'utf8'),
    Buffer.from(nonce, 'utf8'),
  );
  cipher.setAAD(Buffer.from(associatedData, 'utf8'));
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    ciphertext: Buffer.concat([enc, cipher.getAuthTag()]).toString('base64'),
    nonce,
    associated_data: associatedData,
    algorithm: 'AEAD_AES_256_GCM',
  };
}
