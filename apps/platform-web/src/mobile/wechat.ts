/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import axios from 'axios';

import { isWeChatBrowser } from './deviceShell.js';

/**
 * WeChat share cards.
 *
 * Inside WeChat, the default share card is the page `<title>` plus whatever
 * image the crawler guessed — for an SPA that is just the product name.
 * A shared game has to arrive with its own title, author line and cover, or
 * the loop (open → play → change a line) never starts.
 *
 * The JS-SDK is loaded lazily and only inside WeChat; everywhere else this
 * module degrades to the Web Share API / clipboard.
 */

const JSSDK_SRC = 'https://res.wx.qq.com/open/js/jweixin-1.6.0.js';

const SHARE_APIS = [
  'updateAppMessageShareData',
  'updateTimelineShareData',
  'onMenuShareAppMessage',
  'onMenuShareTimeline',
] as const;

export interface ShareCard {
  readonly title: string;
  readonly desc: string;
  readonly link: string;
  readonly imgUrl: string;
}

interface WxJsSdk {
  config: (cfg: Record<string, unknown>) => void;
  ready: (cb: () => void) => void;
  error: (cb: (err: unknown) => void) => void;
  updateAppMessageShareData?: (opts: Record<string, unknown>) => void;
  updateTimelineShareData?: (opts: Record<string, unknown>) => void;
  onMenuShareAppMessage?: (opts: Record<string, unknown>) => void;
  onMenuShareTimeline?: (opts: Record<string, unknown>) => void;
}

function wx(): WxJsSdk | null {
  return (window as unknown as { wx?: WxJsSdk }).wx ?? null;
}

let sdkPromise: Promise<WxJsSdk | null> | null = null;

function loadSdk(): Promise<WxJsSdk | null> {
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise<WxJsSdk | null>((resolve) => {
    const existing = wx();
    if (existing) {
      resolve(existing);
      return;
    }
    const script = document.createElement('script');
    script.src = JSSDK_SRC;
    script.async = true;
    script.onload = () => resolve(wx());
    script.onerror = () => resolve(null);
    document.head.appendChild(script);
  });
  return sdkPromise;
}

interface JsSdkConfig {
  readonly enabled: boolean;
  readonly appId: string;
  readonly timestamp: number;
  readonly nonceStr: string;
  readonly signature: string;
}

/**
 * The signature is bound to the exact URL WeChat loaded, hash excluded. On a
 * SPA the router mutates that URL, so it is re-fetched per share target rather
 * than cached for the session.
 */
async function fetchConfig(url: string): Promise<JsSdkConfig | null> {
  try {
    const res = await axios.get<JsSdkConfig>('/v1/public/wechat/jssdk-config', {
      params: { url },
      timeout: 8000,
    });
    return res.data?.enabled ? res.data : null;
  } catch {
    return null;
  }
}

let readyForUrl: string | null = null;

async function ensureConfigured(): Promise<WxJsSdk | null> {
  const shareUrl = window.location.href.split('#')[0] ?? window.location.href;
  const sdk = await loadSdk();
  if (!sdk) return null;
  if (readyForUrl === shareUrl) return sdk;

  const cfg = await fetchConfig(shareUrl);
  if (!cfg) return null;

  const configured = new Promise<boolean>((resolve) => {
    sdk.ready(() => resolve(true));
    sdk.error(() => resolve(false));
    setTimeout(() => resolve(false), 5000);
  });

  sdk.config({
    debug: false,
    appId: cfg.appId,
    timestamp: cfg.timestamp,
    nonceStr: cfg.nonceStr,
    signature: cfg.signature,
    jsApiList: [...SHARE_APIS],
  });

  const ok = await configured;
  if (!ok) return null;
  readyForUrl = shareUrl;
  return sdk;
}

/**
 * Applies a share card to the current WeChat page. Returns false when the
 * caller should fall back to a copy-link affordance.
 */
export async function applyWeChatShareCard(card: ShareCard): Promise<boolean> {
  if (!isWeChatBrowser()) return false;
  const sdk = await ensureConfigured();
  if (!sdk) return false;

  const payload = {
    title: card.title,
    desc: card.desc,
    link: card.link,
    imgUrl: card.imgUrl,
  };
  // Timeline cards show only a title, so fold the hook into it.
  const timeline = { title: `${card.title} — ${card.desc}`, link: card.link, imgUrl: card.imgUrl };

  sdk.updateAppMessageShareData?.(payload);
  sdk.updateTimelineShareData?.(timeline);
  // 1.4-era APIs for older WeChat clients still in the wild.
  sdk.onMenuShareAppMessage?.(payload);
  sdk.onMenuShareTimeline?.(timeline);
  return true;
}

/** Native share sheet outside WeChat; clipboard when that is unavailable too. */
export async function shareOutsideWeChat(card: ShareCard): Promise<'shared' | 'copied' | 'failed'> {
  const nav = navigator as Navigator & {
    share?: (data: { title?: string; text?: string; url?: string }) => Promise<void>;
  };
  if (nav.share) {
    try {
      await nav.share({ title: card.title, text: card.desc, url: card.link });
      return 'shared';
    } catch {
      // User dismissed the sheet, or the gesture expired — fall through to copy.
    }
  }
  try {
    await navigator.clipboard.writeText(card.link);
    return 'copied';
  } catch {
    return 'failed';
  }
}

export async function share(card: ShareCard): Promise<'wechat' | 'shared' | 'copied' | 'failed'> {
  if (await applyWeChatShareCard(card)) return 'wechat';
  return shareOutsideWeChat(card);
}

// ---------- Payment ----------

export interface JsapiPayParams {
  readonly appId: string;
  readonly timeStamp: string;
  readonly nonceStr: string;
  readonly package: string;
  readonly signType: 'RSA';
  readonly paySign: string;
}

interface WeixinJSBridge {
  invoke: (
    api: string,
    params: Record<string, string>,
    cb: (res: { err_msg?: string }) => void,
  ) => void;
}

function bridge(): WeixinJSBridge | null {
  return (window as unknown as { WeixinJSBridge?: WeixinJSBridge }).WeixinJSBridge ?? null;
}

/**
 * `WeixinJSBridge` is injected by the WeChat webview, but not necessarily
 * before our bundle runs — the documented contract is to wait for the ready
 * event when it is still missing.
 */
function awaitBridge(timeoutMs = 5000): Promise<WeixinJSBridge | null> {
  const existing = bridge();
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve) => {
    const onReady = (): void => {
      document.removeEventListener('WeixinJSBridgeReady', onReady);
      resolve(bridge());
    };
    document.addEventListener('WeixinJSBridgeReady', onReady);
    setTimeout(() => {
      document.removeEventListener('WeixinJSBridgeReady', onReady);
      resolve(bridge());
    }, timeoutMs);
  });
}

export type PayOutcome = 'ok' | 'cancelled' | 'unavailable' | 'failed';

/**
 * Opens the in-WeChat payment sheet. A resolved `ok` means the sheet reported
 * success, not that money moved — the wallet is only credited once the
 * merchant notify reaches the API, so callers must still poll the order.
 */
export async function payWithWeChatBridge(params: JsapiPayParams): Promise<PayOutcome> {
  const wxBridge = await awaitBridge();
  if (!wxBridge) return 'unavailable';
  return new Promise<PayOutcome>((resolve) => {
    wxBridge.invoke(
      'getBrandWCPayRequest',
      {
        appId: params.appId,
        timeStamp: params.timeStamp,
        nonceStr: params.nonceStr,
        package: params.package,
        signType: params.signType,
        paySign: params.paySign,
      },
      (res) => {
        if (res.err_msg === 'get_brand_wcpay_request:ok') resolve('ok');
        else if (res.err_msg === 'get_brand_wcpay_request:cancel') resolve('cancelled');
        else resolve('failed');
      },
    );
  });
}
