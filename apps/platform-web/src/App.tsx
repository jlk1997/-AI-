/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom';
import { ConfigProvider, App as AntApp, Spin, message } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import enUS from 'antd/locale/en_US';
import { Login } from './pages/Login';
import { GeneratePage } from './pages/GeneratePage';
import { TOKEN_KEY } from './services/api';
import { useTheme } from './hooks/useTheme';
import { ErrorBoundary, NetworkStatusIndicator } from './components/common/ErrorBoundary';
import { useT } from './services/i18n';
import { useDeviceShell } from './mobile/useDeviceShell';
import { MobileShell } from './mobile/MobileShell';
import { featureFlags } from './utils/featureFlags';
import { useAppStore } from './store';
import { captureInviteFromSearch, claimPendingInvite } from './utils/kaiPaywall';

// Lazy-load secondary pages so the main IDE (GeneratePage) keeps a tight TTI.
// Each chunk is split into its own ~50 kb bundle that only loads on navigation.
const Landing = React.lazy(() =>
  import('./pages/Landing').then((m) => ({ default: m.Landing })),
);
const Community = React.lazy(() =>
  import('./pages/Community').then((m) => ({ default: m.Community })),
);
const GameDetail = React.lazy(() =>
  import('./pages/GameDetail').then((m) => ({ default: m.GameDetail })),
);
const ProfilePage = React.lazy(() => import('./pages/Profile'));
const PublicProfilePage = React.lazy(() => import('./pages/PublicProfile'));
const DeveloperHubPage = React.lazy(() => import('./pages/DeveloperHub'));
const PluginsPage = React.lazy(() => import('./pages/Plugins'));
const BenchBoardPage = React.lazy(() => import('./pages/BenchBoard'));
const WalletPage = React.lazy(() => import('./pages/Wallet'));
const ObservatoryPage = React.lazy(() =>
  import('./pages/ObservatoryPage').then((m) => ({ default: m.ObservatoryPage })),
);
const AdminReportsPage = React.lazy(() => import('./pages/AdminReports'));
const TermsPage = React.lazy(() => import('./pages/Terms'));
const PrivacyPage = React.lazy(() => import('./pages/Privacy'));

// Phone shell. Split out so a desktop session never downloads it.
const MobileCommunity = React.lazy(() => import('./mobile/pages/MobileCommunity'));
const MobilePlay = React.lazy(() => import('./mobile/pages/MobilePlay'));
const MobileLibrary = React.lazy(() => import('./mobile/pages/MobileLibrary'));
const MobileMe = React.lazy(() => import('./mobile/pages/MobileMe'));
const MobileStudio = React.lazy(() => import('./mobile/pages/MobileStudio'));

/**
 * A visitor with no account should land in a room with people in it, not in an
 * empty studio: the first thing to do here is play or watch, not generate.
 * A deep link (?project=, ?remix=, ?mode=, ?lab=) still wins — that traffic is
 * someone being sent to the studio on purpose.
 */
function HomeRoute({ mobile }: { mobile: boolean }): React.ReactElement {
  const signedIn = Boolean(localStorage.getItem(TOKEN_KEY));
  const hasDeepLink = window.location.search.length > 1;
  if (!signedIn && !hasDeepLink) {
    return <Landing />;
  }
  return mobile ? <MobileStudio /> : <GeneratePage />;
}

function PageFallback(): React.ReactElement {
  return (
    <div style={{ padding: 48, textAlign: 'center' }}>
      <Spin description="Loading…" />
    </div>
  );
}

/**
 * Both shells serve the same routes against the same API — only the frame and
 * the layout of a few screens differ. Anything not overridden below falls
 * through to the shared page, which keeps the phone build at feature parity
 * instead of a cut-down subset.
 */
function DesktopRoutes(): React.ReactElement {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<HomeRoute mobile={false} />} />
      <Route path="/home" element={<Landing />} />

      <Route path="/community" element={<Community />} />
      <Route path="/community/game/:slugOrId" element={<GameDetail />} />
      <Route path="/observatory/:projectId" element={<ObservatoryPage />} />
      <Route path="/play/:slugOrId" element={<MobilePlay />} />

      <Route path="/profile" element={<ProfilePage />} />
      <Route path="/u/:handle" element={<PublicProfilePage />} />

      <Route path="/wallet" element={<WalletPage />} />
      {featureFlags.ecosystem ? (
        <>
          <Route path="/plugins" element={<PluginsPage />} />
          <Route path="/bench" element={<BenchBoardPage />} />
          <Route path="/developer" element={<DeveloperHubPage />} />
        </>
      ) : null}
      <Route path="/admin/reports" element={<AdminReportsPage />} />
      <Route path="/terms" element={<TermsPage />} />
      <Route path="/privacy" element={<PrivacyPage />} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function MobileRoutes(): React.ReactElement {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<HomeRoute mobile />} />
      <Route path="/home" element={<Landing />} />

      <Route path="/community" element={<MobileCommunity />} />
      {/* On a phone the detail page IS the play page. */}
      <Route path="/community/game/:slugOrId" element={<PlayRedirectToMobile />} />
      <Route path="/play/:slugOrId" element={<MobilePlay />} />
      <Route path="/observatory/:projectId" element={<ObservatoryPage />} />

      <Route path="/library" element={<MobileLibrary />} />
      <Route path="/me" element={<MobileMe />} />
      <Route path="/profile" element={<ProfilePage />} />
      <Route path="/u/:handle" element={<PublicProfilePage />} />

      <Route path="/wallet" element={<WalletPage />} />
      {featureFlags.ecosystem ? (
        <>
          <Route path="/plugins" element={<PluginsPage />} />
          <Route path="/bench" element={<BenchBoardPage />} />
          <Route path="/developer" element={<DeveloperHubPage />} />
        </>
      ) : null}
      <Route path="/admin/reports" element={<AdminReportsPage />} />
      <Route path="/terms" element={<TermsPage />} />
      <Route path="/privacy" element={<PrivacyPage />} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function PlayRedirectToMobile(): React.ReactElement {
  const { slugOrId } = useParams<{ slugOrId: string }>();
  return <Navigate to={`/play/${slugOrId ?? ''}`} replace />;
}

/** Remember `?invite=` on every route, then claim it the moment a session exists. */
function InviteLifecycle(): null {
  const { search } = useLocation();
  const { t } = useT();
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);

  useEffect(() => {
    captureInviteFromSearch(search);
  }, [search]);

  useEffect(() => {
    if (!isAuthenticated) return;
    void claimPendingInvite().then((points) => {
      if (points) message.success(t('kai.invite.ok', { points }));
    });
  }, [isAuthenticated, t]);

  return null;
}

function AppContent(): React.ReactElement {
  const { themeConfig } = useTheme();
  const { t, locale } = useT();
  const antdLocale = locale === 'zh-CN' ? zhCN : enUS;
  const shell = useDeviceShell();
  const mobile = shell === 'mobile';

  useEffect(() => {
    document.documentElement.lang = locale === 'en' ? 'en' : 'zh-CN';
    document.title = t('app.brand');
  }, [locale, t]);

  return (
    <ConfigProvider theme={themeConfig} locale={antdLocale}>
      <AntApp>
        {/* 保证 #root → 路由页 height:100% 不断链，避免创作页左栏 flex 子项高度塌成 0 */}
        <div
          style={{
            height: '100%',
            minHeight: '100%',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <NetworkStatusIndicator />
          <BrowserRouter>
            <InviteLifecycle />
            <div
              style={{
                flex: 1,
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
              }}
            >
              {mobile ? (
                <MobileShell>
                  <Suspense fallback={<PageFallback />}>
                    <MobileRoutes />
                  </Suspense>
                </MobileShell>
              ) : (
                <div
                  style={{
                    flex: 1,
                    minHeight: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                  }}
                >
                  <Suspense fallback={<PageFallback />}>
                    <DesktopRoutes />
                  </Suspense>
                </div>
              )}
            </div>
          </BrowserRouter>
        </div>
      </AntApp>
    </ConfigProvider>
  );
}

export function App(): React.ReactElement {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}
