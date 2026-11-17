/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Avatar, Button, Card, Empty, List, Space, Tag, Typography, message } from 'antd';
import {
  ApiOutlined,
  AppstoreOutlined,
  BarChartOutlined,
  DesktopOutlined,
  DownloadOutlined,
  FileTextOutlined,
  FlagOutlined,
  GlobalOutlined,
  LogoutOutlined,
  UserOutlined,
} from '@ant-design/icons';

import { api, type MyWorks, type UserProfile } from '../../services/api.js';
import { featureFlags } from '../../utils/featureFlags.js';
import { useT } from '../../services/i18n.js';
import { useAppStore } from '../../store/index.js';
import { MobileHeader } from '../MobileShell.js';
import { CourseTonightHubCard } from '../../components/World/CourseTonightHubCard.js';
import { useMyCourseTonight } from '../../components/World/myCourseTonightStore.js';
import { CourseReturnCapsule } from '../../components/World/CourseReturnCapsule.js';
import { setShellOverride } from '../deviceShell.js';
import {
  accountPrivacyError,
  closeOwnAccount,
  downloadAccountExport,
} from '../../utils/accountPrivacy.js';
import {
  isStandaloneDisplay,
  onInstallAvailabilityChange,
  promptInstall,
} from '../pwa.js';

const { Text } = Typography;

export const MobileMe: React.FC = () => {
  const navigate = useNavigate();
  const { t, locale, setLocale } = useT();
  const { isAuthenticated, logout } = useAppStore();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [works, setWorks] = useState<MyWorks | null>(null);
  const { stakes: courseStakes, watches: courseWatches, refresh: refreshCourseTonight } =
    useMyCourseTonight();
  const [installable, setInstallable] = useState(false);
  const [curator, setCurator] = useState(false);

  useEffect(() => onInstallAvailabilityChange(setInstallable), []);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    void (async () => {
      try {
        const [me, w, caps] = await Promise.all([
          api.me.profile(),
          api.me.works().catch(() => null),
          api.me.capabilities().catch(() => ({ curator: false })),
        ]);
        if (cancelled) return;
        setProfile(me.profile);
        setWorks(w);
        setCurator(caps.curator);
      } catch {
        /* profile is best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  const goDesktop = (): void => {
    setShellOverride('desktop');
    window.location.href = '/';
  };

  const onInstall = async (): Promise<void> => {
    const outcome = await promptInstall();
    if (outcome === 'accepted') message.success(t('mobile.me.installDone'));
  };

  if (!isAuthenticated) {
    return (
      <>
        <MobileHeader title={t('mobile.tab.me')} />
        <Empty style={{ padding: 48 }} description={t('mobile.me.signInHint')}>
          <Button type="primary" onClick={() => navigate('/login')}>
            {t('mobile.me.signIn')}
          </Button>
        </Empty>
      </>
    );
  }

  const myWorks = [...(works?.games ?? []), ...(works?.worlds ?? [])];

  return (
    <>
      <MobileHeader title={t('mobile.tab.me')} />
      {featureFlags.courseMarket ? (
        <div style={{ margin: '0 12px 8px', display: 'flex', justifyContent: 'flex-end' }}>
          <CourseReturnCapsule />
        </div>
      ) : null}

      <Card
        bordered={false}
        style={{ margin: 12, borderRadius: 12 }}
        onClick={() => navigate('/profile')}
      >
        <Space>
          <Avatar size={48} src={profile?.avatarUrl ?? undefined} icon={<UserOutlined />} />
          <Space direction="vertical" size={0}>
            <Text strong>{profile?.displayName ?? profile?.email ?? '—'}</Text>
            {profile?.handle && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                @{profile.handle}
              </Text>
            )}
          </Space>
        </Space>
      </Card>

      {featureFlags.courseMarket
      && (courseStakes.length > 0 || courseWatches.length > 0) ? (
        <div style={{ marginInline: 12 }}>
          <CourseTonightHubCard
            stakes={courseStakes}
            watches={courseWatches}
            onWatchesChange={() => void refreshCourseTonight()}
          />
        </div>
      ) : null}

      <Card
        size="small"
        title={t('mobile.me.works')}
        bordered={false}
        style={{ margin: 12, borderRadius: 12 }}
        extra={
          <Button type="link" size="small" onClick={() => navigate('/profile')}>
            {t('mobile.me.all')}
          </Button>
        }
      >
        {myWorks.length === 0 ? (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('mobile.me.noWorks')}
          </Text>
        ) : (
          <List
            size="small"
            dataSource={myWorks.slice(0, 5)}
            renderItem={(w) => (
              <List.Item
                style={{ cursor: 'pointer', paddingInline: 0 }}
                onClick={() => navigate(`/play/${w.slug}`)}
              >
                <Space size={8}>
                  <span>{w.title}</span>
                  {w.takenDownAt ? (
                    <Tag color="red">{t('community.takedown.tag')}</Tag>
                  ) : null}
                </Space>
              </List.Item>
            )}
          />
        )}
      </Card>

      <List
        style={{ margin: 12, background: 'var(--bg-card)', borderRadius: 12 }}
        dataSource={[
          {
            key: 'wallet',
            icon: <BarChartOutlined />,
            label: t('mobile.me.wallet'),
            onClick: () => navigate('/wallet'),
          },
          ...(featureFlags.ecosystem
            ? [
                {
                  key: 'plugins',
                  icon: <AppstoreOutlined />,
                  label: t('mobile.me.plugins'),
                  onClick: () => navigate('/plugins'),
                },
                {
                  key: 'templates',
                  icon: <AppstoreOutlined />,
                  label: t('mobile.me.templates'),
                  onClick: () => navigate('/plugins?tab=templates'),
                },
                {
                  key: 'developer',
                  icon: <ApiOutlined />,
                  label: t('mobile.me.developer'),
                  onClick: () => navigate('/developer'),
                },
              ]
            : []),
          ...(curator
            ? [
                {
                  key: 'reports',
                  icon: <FlagOutlined />,
                  label: t('admin.reports.title'),
                  onClick: () => navigate('/admin/reports'),
                },
              ]
            : []),
          {
            key: 'terms',
            icon: <FileTextOutlined />,
            label: t('community.publish.termsLink'),
            onClick: () => navigate('/terms'),
          },
          {
            key: 'privacy',
            icon: <FileTextOutlined />,
            label: t('privacy.title'),
            onClick: () => navigate('/privacy'),
          },
          {
            key: 'export',
            icon: <FileTextOutlined />,
            label: t('account.export'),
            onClick: () => {
              void downloadAccountExport()
                .then(() => message.success(t('account.exportOk')))
                .catch((err: unknown) =>
                  message.error(accountPrivacyError(err) || t('account.exportFail')),
                );
            },
          },
          {
            key: 'delete',
            icon: <FileTextOutlined />,
            label: t('account.delete'),
            onClick: () => {
              if (!window.confirm(t('account.deleteConfirm'))) return;
              void closeOwnAccount()
                .then(() => {
                  logout();
                  message.success(t('account.deleteOk'));
                  navigate('/login');
                })
                .catch((err: unknown) =>
                  message.error(accountPrivacyError(err) || t('account.deleteFail')),
                );
            },
          },
          {
            key: 'locale',
            icon: <GlobalOutlined />,
            label: locale === 'zh-CN' ? 'English' : '简体中文',
            onClick: () => setLocale(locale === 'zh-CN' ? 'en' : 'zh-CN'),
          },
          ...(installable && !isStandaloneDisplay()
            ? [
                {
                  key: 'install',
                  icon: <DownloadOutlined />,
                  label: t('mobile.me.install'),
                  onClick: () => void onInstall(),
                },
              ]
            : []),
          {
            key: 'desktop',
            icon: <DesktopOutlined />,
            label: t('mobile.me.desktop'),
            onClick: goDesktop,
          },
          {
            key: 'logout',
            icon: <LogoutOutlined />,
            label: t('mobile.me.logout'),
            onClick: () => {
              logout();
              navigate('/community');
            },
          },
        ]}
        renderItem={(item) => (
          <List.Item style={{ cursor: 'pointer' }} onClick={item.onClick}>
            <Space>
              {item.icon}
              <span>{item.label}</span>
            </Space>
          </List.Item>
        )}
      />
      <div style={{ height: 24 }} />
    </>
  );
};

export default MobileMe;
