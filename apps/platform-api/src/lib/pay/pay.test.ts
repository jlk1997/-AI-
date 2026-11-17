/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { createSign, generateKeyPairSync } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { buildWapPayUrl, canonicalize, parseNotify, verifyNotify } from './alipay.js';
import { decryptNotify, encryptNotifyForTest } from './wechatPay.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

describe('alipay canonicalize', () => {
  it('sorts keys and drops the signature fields', () => {
    expect(
      canonicalize({ b: '2', a: '1', sign: 'x', sign_type: 'RSA2' }),
    ).toBe('a=1&b=2');
  });

  it('drops empty values because Alipay excludes them from the signed string', () => {
    expect(canonicalize({ a: '1', b: '', c: undefined })).toBe('a=1');
  });
});

describe('buildWapPayUrl', () => {
  const cfg = {
    appId: '2021000000000000',
    privateKey,
    publicKey,
    gateway: 'https://openapi.alipay.com/gateway.do',
    notifyUrl: 'https://opengame.test/v1/public/pay/alipay/notify',
  };

  it('quotes the amount in yuan with two decimals', () => {
    const url = buildWapPayUrl(cfg, {
      outTradeNo: 'og1',
      subject: 'points',
      amountCents: 990,
    });
    const biz = new URL(url).searchParams.get('biz_content');
    expect(JSON.parse(biz ?? '{}').total_amount).toBe('9.90');
  });

  it('signs the canonical string, so the gateway can verify us', () => {
    const url = buildWapPayUrl(cfg, {
      outTradeNo: 'og2',
      subject: 'points',
      amountCents: 100,
    });
    const params: Record<string, string> = {};
    new URL(url).searchParams.forEach((v, k) => {
      params[k] = v;
    });
    expect(verifyNotify(publicKey, params)).toBe(true);
  });
});

describe('alipay notify', () => {
  function signed(params: Record<string, string>): Record<string, string> {
    const sign = createSign('RSA-SHA256')
      .update(canonicalize(params), 'utf8')
      .sign(privateKey, 'base64');
    return { ...params, sign, sign_type: 'RSA2' };
  }

  it('accepts a notification signed with the matching key', () => {
    const params = signed({
      out_trade_no: 'og3',
      trade_no: '20240101',
      trade_status: 'TRADE_SUCCESS',
      total_amount: '19.90',
    });
    expect(verifyNotify(publicKey, params)).toBe(true);
    expect(parseNotify(params)).toEqual({
      outTradeNo: 'og3',
      tradeNo: '20240101',
      tradeStatus: 'TRADE_SUCCESS',
      amountCents: 1990,
    });
  });

  it('rejects a tampered amount', () => {
    // The whole point of verifying: an attacker who edits the paid amount must
    // not be able to have us credit the wallet for it.
    const params = signed({
      out_trade_no: 'og4',
      trade_status: 'TRADE_SUCCESS',
      total_amount: '19.90',
    });
    expect(verifyNotify(publicKey, { ...params, total_amount: '0.01' })).toBe(false);
  });

  it('rejects an unsigned notification', () => {
    expect(verifyNotify(publicKey, { out_trade_no: 'og5' })).toBe(false);
  });
});

describe('wechat pay notify', () => {
  const apiV3Key = 'k'.repeat(32);

  it('decrypts a success notification', () => {
    const resource = encryptNotifyForTest(
      apiV3Key,
      JSON.stringify({
        out_trade_no: 'og6',
        transaction_id: '4200001',
        trade_state: 'SUCCESS',
        amount: { total: 990, payer_total: 990 },
      }),
    );
    const notify = decryptNotify(apiV3Key, resource);
    expect(notify.outTradeNo).toBe('og6');
    expect(notify.transactionId).toBe('4200001');
    expect(notify.tradeState).toBe('SUCCESS');
    expect(notify.amountCents).toBe(990);
  });

  it('refuses a payload encrypted under a different key', () => {
    const resource = encryptNotifyForTest(
      'j'.repeat(32),
      JSON.stringify({ out_trade_no: 'og7', trade_state: 'SUCCESS' }),
    );
    expect(() => decryptNotify(apiV3Key, resource)).toThrow();
  });
});
