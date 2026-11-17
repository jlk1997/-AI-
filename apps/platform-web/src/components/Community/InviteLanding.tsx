/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * A pending `?invite=` must be visible before login. Silent capture alone
 * looks like the link did nothing.
 */

import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from 'antd';

import { useT } from '../../services/i18n';
import { useAppStore } from '../../store';
import { rememberLoginReturnTo } from '../../utils/loginIntent';
import { normalizeInviteHandle, peekInvite } from '../../utils/kaiPaywall';

export const InviteLanding: React.FC<{ compact?: boolean }> = ({ compact }) => {
  const { t } = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const handle =
    normalizeInviteHandle(new URLSearchParams(location.search).get('invite')) ?? peekInvite();

  if (!handle || isAuthenticated) return null;

  return (
    <aside
      className={compact ? 'og-invite-landing og-invite-landing--play' : 'og-invite-landing'}
      aria-live="polite"
    >
      <div className="og-invite-landing__copy">{t('kai.invite.landing', { handle })}</div>
      <Button
        type="primary"
        size="small"
        onClick={() => {
          rememberLoginReturnTo(`${location.pathname}${location.search}`);
          navigate('/login');
        }}
      >
        {t('kai.invite.landingCta')}
      </Button>
    </aside>
  );
};
