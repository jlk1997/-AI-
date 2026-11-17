/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment jsdom
 */

import { describe, expect, it } from 'vitest';

import {
  captureInviteFromSearch,
  myInviteHandle,
  normalizeInviteHandle,
  packTitleKey,
  paywallFromError,
  paywallNeedCopy,
  peekInvite,
  rememberMyInviteHandle,
  safeWalletReturn,
  takeInvite,
  peekWalletArrivalBalance,
  rememberWalletArrivalBalance,
  walletArrivalStorageKey,
  walletPathForLane,
  walletPathForPaywall,
  walletShowsReady,
} from './kaiPaywall.js';

describe('invite handles', () => {
  it('accepts short names and rejects junk', () => {
    expect(normalizeInviteHandle('Ada_01')).toBe('ada_01');
    expect(normalizeInviteHandle('ab')).toBeNull();
    expect(normalizeInviteHandle('not a handle!')).toBeNull();
  });

  it('captures ?invite= and hands it over once', () => {
    localStorage.clear();
    captureInviteFromSearch('?invite=Ada_01');
    expect(peekInvite()).toBe('ada_01');
    expect(takeInvite()).toBe('ada_01');
    expect(takeInvite()).toBeNull();
  });

  it('remembers the signed-in handle separately from a pending invite', () => {
    localStorage.clear();
    rememberMyInviteHandle('lin_sao');
    captureInviteFromSearch('?invite=guest_one');
    expect(myInviteHandle()).toBe('lin_sao');
    expect(peekInvite()).toBe('guest_one');
  });
});

describe('one-balance paywall', () => {
  it('sends the shop a sku, never a spend lane', () => {
    expect(walletPathForLane('jiaxi', 'pack_plus')).toBe('/wallet?sku=pack_plus');
    expect(walletPathForLane(undefined)).toBe('/wallet');
    expect(
      paywallFromError({
        details: { needPoints: 8, recommendSku: 'pack_kai', lane: 'jiaxi' },
      }),
    ).toEqual({ sku: 'pack_kai', needPoints: 8 });
  });

  it('keeps the return path and the shortfall on the wallet link', () => {
    expect(
      walletPathForPaywall({
        sku: 'pack_kai',
        needPoints: 8,
        from: '/community/game/night-market',
      }),
    ).toBe('/wallet?sku=pack_kai&need=8&from=%2Fcommunity%2Fgame%2Fnight-market');
    expect(safeWalletReturn('https://evil.test/wallet')).toBeNull();
    expect(safeWalletReturn('//evil.test')).toBeNull();
    expect(safeWalletReturn('/wallet?sku=pack_kai')).toBeNull();
    expect(safeWalletReturn('/community/game/ada')).toBe('/community/game/ada');
    expect(packTitleKey('pack_plus')).toBe('wallet.pack.plus');
    expect(
      paywallNeedCopy((k) => k, {
        sku: 'pack_kai',
        needPoints: 8,
      }),
    ).toBe('kai.needPointsShort');
  });

  it('does not call a leftover balance a successful top-up', () => {
    expect(
      walletShowsReady({ credited: false, shortfall: 8, balance: 12 }),
    ).toBe(false);
    expect(
      walletShowsReady({
        credited: false,
        shortfall: 8,
        balance: 12,
        arrivalBalance: 12,
      }),
    ).toBe(false);
    expect(
      walletShowsReady({ credited: true, shortfall: 8, balance: 92 }),
    ).toBe(true);
    expect(
      walletShowsReady({
        credited: false,
        shortfall: 8,
        balance: 92,
        arrivalBalance: 12,
      }),
    ).toBe(true);
    expect(
      walletShowsReady({ credited: true, shortfall: 150, balance: 20 }),
    ).toBe(false);
    sessionStorage.clear();
    const key = walletArrivalStorageKey(8, '/play/ada');
    expect(peekWalletArrivalBalance(key)).toBeNull();
    expect(rememberWalletArrivalBalance(key, 12)).toBe(12);
    expect(rememberWalletArrivalBalance(key, 92)).toBe(12);
  });
});
