/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useLocation } from 'react-router-dom';

import { MobileTabBar } from './MobileTabBar.js';

/** Routes that own the whole viewport: no tab bar, no scroll container. */
const IMMERSIVE_PREFIXES = ['/play/', '/observatory/', '/login'];

/**
 * The studio is flush like a play surface but keeps the tab bar: an author who
 * has just published needs one tap back to the community, not a hunt for a
 * back button.
 */
const FLUSH_ONLY = ['/'];

function matches(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some(
    (p) => pathname === p || pathname === p.replace(/\/$/, '') || (p.endsWith('/') && pathname.startsWith(p)),
  );
}

function isImmersive(pathname: string): boolean {
  return matches(pathname, IMMERSIVE_PREFIXES);
}

export interface MobileShellProps {
  readonly children: React.ReactNode;
}

/**
 * The phone frame: a scrolling body plus a thumb-reachable tab bar. It holds no
 * business state — every screen inside talks to the same store and API the
 * desktop studio uses.
 */
export const MobileShell: React.FC<MobileShellProps> = ({ children }) => {
  const { pathname } = useLocation();
  const immersive = isImmersive(pathname);
  const flush = immersive || matches(pathname, FLUSH_ONLY);

  return (
    <div className="og-mobile">
      <div className={`og-mobile__body${flush ? ' og-mobile__body--flush' : ''}`}>
        {children}
      </div>
      {!immersive && <MobileTabBar />}
    </div>
  );
};

export interface MobileHeaderProps {
  readonly title: React.ReactNode;
  readonly left?: React.ReactNode;
  readonly right?: React.ReactNode;
  readonly below?: React.ReactNode;
}

export const MobileHeader: React.FC<MobileHeaderProps> = ({ title, left, right, below }) => (
  <header className="og-mobile__header">
    <div className="og-mobile__header-row">
      {left}
      <div className="og-mobile__header-title">{title}</div>
      {right}
    </div>
    {below}
  </header>
);
