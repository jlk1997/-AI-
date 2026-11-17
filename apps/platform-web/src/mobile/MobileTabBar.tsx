/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  AppstoreOutlined,
  PlayCircleOutlined,
  EditOutlined,
  UserOutlined,
} from '@ant-design/icons';

import { useT } from '../services/i18n.js';

export interface MobileTab {
  readonly key: string;
  readonly path: string;
  readonly labelKey: string;
  readonly icon: React.ReactNode;
  /** Route prefixes that should keep this tab lit. */
  readonly match: readonly string[];
}

export const MOBILE_TABS: readonly MobileTab[] = [
  {
    key: 'community',
    path: '/community',
    labelKey: 'mobile.tab.community',
    icon: <AppstoreOutlined />,
    match: ['/community'],
  },
  {
    key: 'library',
    path: '/library',
    labelKey: 'mobile.tab.library',
    icon: <PlayCircleOutlined />,
    match: ['/library'],
  },
  {
    key: 'studio',
    path: '/',
    labelKey: 'mobile.tab.studio',
    icon: <EditOutlined />,
    match: ['/studio'],
  },
  {
    key: 'me',
    path: '/me',
    labelKey: 'mobile.tab.me',
    icon: <UserOutlined />,
    match: ['/me', '/profile', '/developer', '/plugins', '/bench', '/wallet'],
  },
];

function activeTabKey(pathname: string): string {
  if (pathname === '/') return 'studio';
  const hit = MOBILE_TABS.find((tab) =>
    tab.match.some((p) => pathname === p || pathname.startsWith(`${p}/`)),
  );
  return hit?.key ?? '';
}

export const MobileTabBar: React.FC = () => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { t } = useT();
  const active = activeTabKey(pathname);

  return (
    <nav className="og-mobile__tabbar" aria-label={t('mobile.tab.nav')}>
      {MOBILE_TABS.map((tab) => (
        <button
          key={tab.key}
          type="button"
          className="og-mobile__tab"
          aria-current={active === tab.key ? 'page' : undefined}
          onClick={() => navigate(tab.path)}
        >
          <span className="og-mobile__tab-icon">{tab.icon}</span>
          <span>{t(tab.labelKey)}</span>
        </button>
      ))}
    </nav>
  );
};
