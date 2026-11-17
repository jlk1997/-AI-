/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Button,
  Card,
  Col,
  Empty,
  Input,
  Modal,
  Row,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  AppstoreOutlined,
  DownloadOutlined,
  HomeOutlined,
  ShoppingCartOutlined,
} from '@ant-design/icons';

import { api } from '../services/api';
import { useT } from '../services/i18n';
import { useAppStore } from '../store';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { rememberLoginReturnTo } from '../utils/loginIntent';
import { openWalletForPaywall, paywallNeedCopy } from '../utils/kaiPaywall';

const { Title, Paragraph, Text } = Typography;

interface Plugin {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  latestVersion: string | null;
  installCount: number;
  tags: unknown;
  pricePoints?: number;
}

export default function PluginsPage(): React.ReactElement {
  const navigate = useNavigate();
  const { t } = useT();
  const { isAuthenticated, projects, fetchProjects } = useAppStore();
  const [applyTarget, setApplyTarget] = useState<{
    kind: 'plugin' | 'template';
    slug: string;
  } | null>(null);
  const [applyProjectId, setApplyProjectId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [owned, setOwned] = useState<Set<string>>(new Set());
  const [buying, setBuying] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q, 300);
  const [templates, setTemplates] = useState<
    Array<{
      id: string;
      slug: string;
      name: string | null;
      description: string | null;
      pricePoints: number;
      version: string;
    }>
  >([]);
  const [ownedTemplates, setOwnedTemplates] = useState<Set<string>>(new Set());

  const load = (search: string): void => {
    setLoading(true);
    api.ecosystem
      .publicPlugins({ q: search || undefined, limit: 60 })
      .then((res) => setPlugins(res.plugins as Plugin[]))
      .catch((err: unknown) => {
        const text = err instanceof Error ? err.message : 'failed to load plugins';
        message.error(text);
      })
      .finally(() => setLoading(false));
  };

  // Re-query whenever the debounced search term changes — this replaces the
  // explicit "Search" button click while still feeling instant.
  useEffect(() => {
    load(debouncedQ);
  }, [debouncedQ]);

  useEffect(() => {
    api.templates
      .list()
      .then((res) => setTemplates(res.templates))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    api.templates
      .entitlements()
      .then((res) => setOwnedTemplates(new Set(res.entitlements.map((e) => e.templateId))))
      .catch(() => undefined);
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    void fetchProjects();
    api.plugins
      .entitlements()
      .then((res) => setOwned(new Set(res.entitlements.map((e) => e.slug))))
      .catch(() => undefined);
  }, [isAuthenticated]);

  const handleInstall = async (slug: string): Promise<void> => {
    if (!isAuthenticated) {
      rememberLoginReturnTo('/plugins');
      navigate('/login');
      return;
    }
    if (projects.length === 0) {
      void fetchProjects();
    }
    setApplyTarget({ kind: 'plugin', slug });
  };

  const confirmApply = async (): Promise<void> => {
    if (!applyTarget || !applyProjectId) {
      message.warning(t('plugins.apply.needProject'));
      return;
    }
    try {
      if (applyTarget.kind === 'plugin') {
        await api.plugins.apply(applyTarget.slug, applyProjectId);
        await api.plugins.install(applyTarget.slug, applyProjectId);
      } else {
        await api.templates.apply(applyTarget.slug, applyProjectId);
      }
      message.success(t('plugins.apply.ok'));
      setApplyTarget(null);
      load(q);
    } catch (err) {
      message.error(err instanceof Error ? err.message : t('plugins.apply.fail'));
    }
  };

  /**
   * Paid plugins are bought with points the org already holds, so the failure
   * worth handling separately is an empty wallet — that one has somewhere to go.
   */
  const handleBuy = async (slug: string): Promise<void> => {
    if (!isAuthenticated) {
      rememberLoginReturnTo('/plugins');
      navigate('/login');
      return;
    }
    setBuying(slug);
    try {
      await api.plugins.purchase(slug);
      setOwned((prev) => new Set(prev).add(slug));
      message.success(t('plugins.buySuccess'));
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'QUOTA_EXCEEDED') {
        const wall = openWalletForPaywall(err, navigate);
        message.warning(
          wall ? paywallNeedCopy(t, wall) : t('plugins.needPoints'),
        );
        return;
      }
      message.error(t('plugins.buyFail'));
    } finally {
      setBuying(null);
    }
  };

  return (
    <div style={{ padding: 24, maxWidth: 1280, margin: '0 auto' }}>
      <Row align="middle" justify="space-between" style={{ marginBottom: 16 }}>
        <Col>
          <Title level={3} style={{ margin: 0 }}>
            <AppstoreOutlined /> {t('plugins.title')}
          </Title>
        </Col>
        <Col>
          <Button icon={<HomeOutlined />} onClick={() => navigate('/')}>
            {t('common.home')}
          </Button>
        </Col>
      </Row>
      <Space.Compact style={{ width: '100%', marginBottom: 24 }}>
        <Input
          allowClear
          placeholder={t('plugins.search.placeholder')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onPressEnter={() => load(q)}
        />
        <Button type="primary" onClick={() => load(q)}>
          Search
        </Button>
      </Space.Compact>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Spin tip={t('common.loading')} />
        </div>
      ) : plugins.length === 0 ? (
        <Empty description={t('plugins.empty')} />
      ) : (
        <Row gutter={[16, 16]}>
          {plugins.map((p) => (
            <Col key={p.id} xs={24} sm={12} lg={8}>
              <Card
                hoverable
                title={
                  <Space>
                    <Text strong>{p.name}</Text>
                    {p.latestVersion ? <Tag>{p.latestVersion}</Tag> : null}
                    {owned.has(p.slug) ? (
                      <Tag color="green">{t('plugins.price.owned')}</Tag>
                    ) : (p.pricePoints ?? 0) > 0 ? (
                      <Tag color="gold">
                        {t('plugins.price.points', { points: p.pricePoints ?? 0 })}
                      </Tag>
                    ) : (
                      <Tag>{t('plugins.price.free')}</Tag>
                    )}
                  </Space>
                }
                extra={
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {p.installCount} installs
                  </Text>
                }
                actions={
                  (p.pricePoints ?? 0) > 0 && !owned.has(p.slug)
                    ? [
                        <Button
                          key="buy"
                          type="link"
                          icon={<ShoppingCartOutlined />}
                          loading={buying === p.slug}
                          onClick={() => void handleBuy(p.slug)}
                        >
                          {t('plugins.buy')} ·{' '}
                          {t('plugins.price.points', { points: p.pricePoints ?? 0 })}
                        </Button>,
                      ]
                    : [
                        <Button
                          key="install"
                          type="link"
                          icon={<DownloadOutlined />}
                          onClick={() => void handleInstall(p.slug)}
                        >
                          Install
                        </Button>,
                      ]
                }
              >
                <Paragraph ellipsis={{ rows: 3 }} style={{ minHeight: 60 }}>
                  {p.description || <Text type="secondary">No description.</Text>}
                </Paragraph>
                {Array.isArray(p.tags)
                  ? (p.tags as string[]).map((tag) => <Tag key={tag}>{tag}</Tag>)
                  : null}
              </Card>
            </Col>
          ))}
        </Row>
      )}

      <Title level={4} style={{ marginTop: 40 }} id="templates">
        {t('templates.title')}
      </Title>
      {templates.length === 0 ? (
        <Empty description={t('templates.empty')} />
      ) : (
        <Row gutter={[16, 16]}>
          {templates.map((tpl) => (
            <Col key={tpl.id} xs={24} sm={12} lg={8}>
              <Card
                title={tpl.name ?? tpl.slug}
                extra={
                  tpl.pricePoints > 0 ? (
                    <Tag color="gold">
                      {t('plugins.price.points', { points: tpl.pricePoints })}
                    </Tag>
                  ) : (
                    <Tag>{t('plugins.price.free')}</Tag>
                  )
                }
                actions={[
                  <Button
                    key="buy"
                    type="link"
                    icon={<ShoppingCartOutlined />}
                    disabled={ownedTemplates.has(tpl.id)}
                    onClick={() => {
                      if (!isAuthenticated) {
                        rememberLoginReturnTo('/plugins');
                        navigate('/login');
                        return;
                      }
                      void api.templates
                        .purchase(tpl.slug)
                        .then(() => {
                          setOwnedTemplates((prev) => new Set(prev).add(tpl.id));
                          message.success(t('plugins.buySuccess'));
                        })
                        .catch(() => message.error(t('plugins.buyFail')));
                    }}
                  >
                    {ownedTemplates.has(tpl.id)
                      ? t('plugins.price.owned')
                      : t('templates.buy')}
                  </Button>,
                  ownedTemplates.has(tpl.id) || tpl.pricePoints <= 0 ? (
                    <Button
                      key="apply"
                      type="link"
                      onClick={() => {
                        if (!isAuthenticated) {
                          rememberLoginReturnTo('/plugins');
                          navigate('/login');
                          return;
                        }
                        void fetchProjects();
                        setApplyTarget({ kind: 'template', slug: tpl.slug });
                      }}
                    >
                      {t('plugins.apply')}
                    </Button>
                  ) : null,
                ]}
              >
                <Paragraph ellipsis={{ rows: 3 }}>
                  {tpl.description || <Text type="secondary">{tpl.version}</Text>}
                </Paragraph>
              </Card>
            </Col>
          ))}
        </Row>
      )}

      <Modal
        open={applyTarget !== null}
        title={t('plugins.apply.title')}
        onCancel={() => setApplyTarget(null)}
        onOk={() => void confirmApply()}
        okText={t('plugins.apply')}
      >
        <Select
          style={{ width: '100%' }}
          placeholder={t('plugins.apply.needProject')}
          value={applyProjectId ?? undefined}
          onChange={(value) => setApplyProjectId(value)}
          options={projects.map((p) => ({ value: p.id, label: p.name }))}
        />
      </Modal>
    </div>
  );
}
