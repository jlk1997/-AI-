/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * 402 / 缺点：把访客送去最近一档点数包，而不是再卖一次生成。
 */

const INVITE_KEY = 'kai_invite';
const MY_HANDLE_KEY = 'kai_my_invite';

const HANDLE_RE = /^[a-z0-9_]{3,20}$/;

export function normalizeInviteHandle(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim().toLowerCase() ?? '';
  return HANDLE_RE.test(trimmed) ? trimmed : null;
}

export function rememberInvite(handle: string): void {
  const trimmed = normalizeInviteHandle(handle);
  if (!trimmed) return;
  try {
    localStorage.setItem(INVITE_KEY, trimmed);
  } catch {
    /* ignore */
  }
}

export function peekInvite(): string | null {
  try {
    return normalizeInviteHandle(localStorage.getItem(INVITE_KEY));
  } catch {
    return null;
  }
}

export function takeInvite(): string | null {
  try {
    const handle = peekInvite();
    if (handle) localStorage.removeItem(INVITE_KEY);
    return handle;
  } catch {
    return null;
  }
}

export function captureInviteFromSearch(search = window.location.search): void {
  const handle = new URLSearchParams(search).get('invite');
  if (handle) rememberInvite(handle);
}

/** The signed-in user's own short name, used when stamping share links. */
export function rememberMyInviteHandle(handle: string): void {
  const trimmed = normalizeInviteHandle(handle);
  if (!trimmed) return;
  try {
    localStorage.setItem(MY_HANDLE_KEY, trimmed);
  } catch {
    /* ignore */
  }
}

export function myInviteHandle(): string | null {
  try {
    return normalizeInviteHandle(localStorage.getItem(MY_HANDLE_KEY));
  } catch {
    return null;
  }
}

/**
 * Claim a pending `?invite=` after login. Restores the handle on a network
 * failure so the next authenticated screen can try again.
 */
export async function claimPendingInvite(): Promise<number | null> {
  const handle = takeInvite();
  if (!handle) return null;
  try {
    const { api } = await import('../services/api');
    const res = await api.billing.claimInvite(handle);
    if (res.ok && res.invited) return res.invited;
    return null;
  } catch {
    rememberInvite(handle);
    return null;
  }
}

export type PaywallHint = {
  readonly sku?: string;
  readonly needPoints?: number;
};

/** In-app pages the wallet may send the spender back to after a pack. */
export function safeWalletReturn(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const path = raw.trim();
  if (!path.startsWith('/') || path.startsWith('//')) return null;
  if (path.startsWith('/wallet') || path.startsWith('/login')) return null;
  if (path.includes('://')) return null;
  return path.slice(0, 240);
}

export function currentWalletReturn(): string | null {
  if (typeof window === 'undefined') return null;
  return safeWalletReturn(`${window.location.pathname}${window.location.search}`);
}

export function walletPathForPaywall(input: {
  readonly sku?: string;
  readonly needPoints?: number;
  readonly from?: string | null;
}): string {
  const params = new URLSearchParams();
  if (input.sku) params.set('sku', input.sku);
  if (input.needPoints != null && input.needPoints > 0) {
    params.set('need', String(Math.round(input.needPoints)));
  }
  const from = safeWalletReturn(input.from);
  if (from) params.set('from', from);
  const q = params.toString();
  return q ? `/wallet?${q}` : '/wallet';
}

export function walletPathForLane(_lane?: string, sku?: string): string {
  return walletPathForPaywall({ sku });
}

/** Banner "点数已到账" only after a real credit, never because balance ≥ need. */
export function walletShowsReady(input: {
  readonly credited: boolean;
  readonly shortfall: number;
  readonly balance?: number | null;
  readonly arrivalBalance?: number | null;
}): boolean {
  if (input.shortfall <= 0) return false;
  const grew =
    input.arrivalBalance != null &&
    input.balance != null &&
    input.balance > input.arrivalBalance;
  if (!input.credited && !grew) return false;
  if (input.balance == null) return input.credited;
  return input.balance >= input.shortfall;
}

export function walletArrivalStorageKey(
  shortfall: number,
  from: string | null,
): string {
  return `og_wallet_arrival:${shortfall}:${from ?? ''}`;
}

export function peekWalletArrivalBalance(key: string): number | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (raw == null || raw === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
  } catch {
    return null;
  }
}

/** First wallet read on this paywall trip. Later remounts reuse it. */
export function rememberWalletArrivalBalance(key: string, balance: number): number {
  const existing = peekWalletArrivalBalance(key);
  if (existing != null) return existing;
  const n = Math.max(0, Math.round(balance));
  try {
    sessionStorage.setItem(key, String(n));
  } catch {
    /* ignore */
  }
  return n;
}

export function packTitleKey(sku?: string | null): string {
  if (sku === 'pack_small') return 'wallet.pack.small';
  if (sku === 'pack_plus') return 'wallet.pack.plus';
  return 'wallet.pack.kai';
}

export function featuredJiaxiCard<T extends { id: string }>(
  cards: readonly T[] | undefined,
  featuredCardId?: string | null,
): T | undefined {
  if (!cards?.length) return undefined;
  return cards.find((c) => c.id === featuredCardId) ?? cards[0];
}

export type JiaxiAnnounce = {
  readonly id: string;
  readonly effect: string;
  readonly label: string;
  readonly loopId?: string;
};

/** Tell the hosted Scene (and the parent banner) that paid cards landed. */
export function announceJiaxi(
  iframe: HTMLIFrameElement | null | undefined,
  cards: readonly JiaxiAnnounce[],
): void {
  for (const card of cards) {
    iframe?.contentWindow?.postMessage(
      {
        type: 'opengame:jiaxi',
        cardId: card.id,
        effect: card.effect,
        label: card.label,
        loopId: card.loopId,
      },
      '*',
    );
    window.dispatchEvent(new CustomEvent('opengame:jiaxi', { detail: card }));
  }
}

/**
 * Deliver the paid effect, then stamp the receipt consumed. Consume is
 * best-effort — a missed stamp must not roll back drama that already landed.
 */
export async function landPaidJiaxi(
  iframe: HTMLIFrameElement | null | undefined,
  cards: readonly JiaxiAnnounce[],
  consume: () => Promise<unknown>,
): Promise<void> {
  announceJiaxi(iframe, cards);
  await consume().catch(() => undefined);
}

export function paywallFromError(err: unknown): PaywallHint {
  const details = (err as { details?: Record<string, unknown> }).details;
  const sku = typeof details?.recommendSku === 'string' ? details.recommendSku : undefined;
  const rawNeed = details?.needPoints;
  const needPoints =
    typeof rawNeed === 'number' && Number.isFinite(rawNeed)
      ? Math.max(0, Math.round(rawNeed))
      : undefined;
  return { sku, needPoints };
}

export function paywallNeedCopy(
  t: (k: string, vars?: Record<string, string | number>) => string,
  hint: PaywallHint,
): string {
  if (hint.needPoints != null && hint.needPoints > 0) {
    return t('kai.needPointsShort', {
      need: hint.needPoints,
      pack: t(packTitleKey(hint.sku)),
    });
  }
  return t('kai.needPoints');
}

export function openWalletForPaywall(
  err: unknown,
  navigate: (path: string) => void,
  from?: string | null,
): PaywallHint | null {
  const status = (err as { status?: number }).status ?? 0;
  const code = (err as { code?: string }).code;
  if (status !== 402 && code !== 'QUOTA_EXCEEDED') return null;
  const hint = paywallFromError(err);
  navigate(
    walletPathForPaywall({
      sku: hint.sku ?? 'pack_kai',
      needPoints: hint.needPoints,
      from: from ?? currentWalletReturn(),
    }),
  );
  return hint;
}
