/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Alley lantern — the mark that replaced the generic lightning bolt.
 */

import React from 'react';
import { Link } from 'react-router-dom';
import { useT } from '../services/i18n';

export const BrandMark: React.FC<{
  readonly size?: number;
  readonly title?: string;
}> = ({ size = 28, title }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 32 32"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    role={title ? 'img' : 'presentation'}
    aria-hidden={title ? undefined : true}
    className="og-brand__mark"
  >
    {title ? <title>{title}</title> : null}
    <rect width="32" height="32" rx="9" fill="var(--color-night, #14121A)" />
    <path d="M16 5.5v3" stroke="var(--color-gold, #E0B25A)" strokeWidth="1.6" strokeLinecap="round" />
    <path
      d="M10.5 11.2c0-1.2.7-2.3 2.1-3.1C13.8 7.5 14.9 7 16 7s2.2.5 3.4 1.1c1.4.8 2.1 1.9 2.1 3.1v8.2c0 2.4-2.4 4.1-5.5 4.1s-5.5-1.7-5.5-4.1v-8.2Z"
      fill="var(--color-ember, #C45C26)"
    />
    <path
      d="M13 12.4c.6 1.6 1.4 2.4 3 2.6 1.6-.2 2.4-1 3-2.6"
      stroke="var(--color-gold, #E0B25A)"
      strokeWidth="1.3"
      strokeLinecap="round"
    />
    <rect x="14.6" y="16.2" width="2.8" height="5.2" rx="1.2" fill="var(--color-gold, #E0B25A)" />
    <ellipse cx="16" cy="26.2" rx="6.2" ry="1.3" fill="var(--color-ember, #C45C26)" opacity="0.28" />
  </svg>
);

export const BrandLockup: React.FC<{
  readonly variant?: 'short' | 'full';
  readonly size?: number;
}> = ({ variant = 'short', size = 28 }) => {
  const { t } = useT();
  return (
    <Link to="/home" className="og-brand" style={{ textDecoration: 'none', color: 'inherit' }}>
      <BrandMark size={size} title={t('app.brand')} />
      <span className="og-brand__text">
        <span className="og-brand__short">{t('app.brand.short')}</span>
        {variant === 'full' ? <span className="og-brand__full">{t('app.brand')}</span> : null}
      </span>
    </Link>
  );
};
