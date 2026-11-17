/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  Empty,
  Form,
  Input,
  InputNumber,
  List,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  ApiOutlined,
  AppstoreAddOutlined,
  CopyOutlined,
  DeleteOutlined,
  HomeOutlined,
  PlusOutlined,
} from '@ant-design/icons';

import { useDeviceShell } from '../mobile/useDeviceShell';
import { api } from '../services/api';
import { useT } from '../services/i18n';

const { Title, Paragraph, Text } = Typography;

interface ApiKeyRow {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[] | null;
  rateLimitPerMinute: number | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

interface PluginRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  latestVersion: string | null;
  tags: unknown;
  isPublic: boolean;
  installCount: number;
  updatedAt: string;
}

const SCOPE_OPTIONS = [
  { value: 'embed:read', label: 'embed:read — render iframes on partner sites' },
  { value: 'leaderboard:write', label: 'leaderboard:write — submit scores from 3rd parties' },
  { value: 'plugins:read', label: 'plugins:read — browse plugin registry' },
  { value: 'bench:read', label: 'bench:read — read public bench results' },
  { value: '*', label: '* — full access (use with care)' },
];

export default function DeveloperHubPage(): React.ReactElement {
  const navigate = useNavigate();
  const { t } = useT();
  // Seven columns of key metadata is a horizontal scrollbar on a phone. The
  // data is the same either way; only the row layout changes.
  const compact = useDeviceShell() === 'mobile';
  const [apiKeys, setApiKeys] = useState<ApiKeyRow[]>([]);
  const [plugins, setPlugins] = useState<PluginRow[]>([]);
  const [loading, setLoading] = useState(false);

  const [keyModalOpen, setKeyModalOpen] = useState(false);
  const [pluginModalOpen, setPluginModalOpen] = useState(false);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [keyForm] = Form.useForm();
  const [pluginForm] = Form.useForm();

  async function refresh() {
    setLoading(true);
    try {
      const [k, p] = await Promise.all([api.apiKeys.list(), api.plugins.listMine()]);
      setApiKeys(k.apiKeys);
      setPlugins(p.plugins);
    } catch (err) {
      const text = err instanceof Error ? err.message : 'failed to load developer data';
      message.error(text);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function createKey() {
    try {
      const values = await keyForm.validateFields();
      const res = await api.apiKeys.create({
        name: values.name,
        scopes: values.scopes ?? [],
        rateLimitPerMinute: values.rateLimitPerMinute,
      });
      setRevealedKey(res.rawKey);
      setKeyModalOpen(false);
      keyForm.resetFields();
      await refresh();
    } catch (err) {
      if (err instanceof Error) message.error(err.message);
    }
  }

  async function revokeKey(id: string) {
    try {
      await api.apiKeys.revoke(id);
      message.success('Key revoked');
      await refresh();
    } catch (err) {
      if (err instanceof Error) message.error(err.message);
    }
  }

  async function createPlugin() {
    try {
      const values = await pluginForm.validateFields();
      await api.plugins.create({
        slug: values.slug,
        name: values.name,
        description: values.description,
        tags: values.tags
          ? values.tags.split(',').map((s: string) => s.trim()).filter(Boolean)
          : [],
        isPublic: values.isPublic ?? true,
      });
      message.success('Plugin created');
      setPluginModalOpen(false);
      pluginForm.resetFields();
      await refresh();
    } catch (err) {
      if (err instanceof Error) message.error(err.message);
    }
  }

  return (
    <div style={{ padding: compact ? 12 : 24, maxWidth: 1280, margin: '0 auto' }}>
      <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <div>
          <Title level={3} style={{ margin: 0 }}>
            {t('developer.title')}
          </Title>
          <Text type="secondary">{t('developer.subtitle')}</Text>
        </div>
        <Button icon={<HomeOutlined />} onClick={() => navigate('/')}>
          Home
        </Button>
      </Space>

      <Tabs
        defaultActiveKey="keys"
        items={[
          {
            key: 'keys',
            label: (
              <span>
                <ApiOutlined /> API Keys
              </span>
            ),
            children: (
              <Card
                extra={
                  <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    onClick={() => setKeyModalOpen(true)}
                  >
                    Create Key
                  </Button>
                }
              >
                {apiKeys.length === 0 ? (
                  <Empty description="No API keys yet. Keys grant programmatic access to /api/public/*." />
                ) : compact ? (
                  <List
                    loading={loading}
                    dataSource={apiKeys}
                    rowKey="id"
                    renderItem={(row) => (
                      <List.Item
                        actions={
                          row.revokedAt
                            ? undefined
                            : [
                                <Popconfirm
                                  key="revoke"
                                  title="Revoke this key? Existing clients will fail immediately."
                                  onConfirm={() => revokeKey(row.id)}
                                >
                                  <Button danger size="small" icon={<DeleteOutlined />} />
                                </Popconfirm>,
                              ]
                        }
                      >
                        <List.Item.Meta
                          title={
                            <Space size={6} wrap>
                              <Text strong>{row.name}</Text>
                              {row.revokedAt ? (
                                <Tag color="red">revoked</Tag>
                              ) : (
                                <Tag color="green">active</Tag>
                              )}
                            </Space>
                          }
                          description={
                            <Space direction="vertical" size={2}>
                              <Text code>{row.keyPrefix}</Text>
                              <Space size={4} wrap>
                                {(row.scopes ?? []).map((s) => (
                                  <Tag key={s}>{s}</Tag>
                                ))}
                              </Space>
                              <Text type="secondary" style={{ fontSize: 12 }}>
                                {row.rateLimitPerMinute
                                  ? `${row.rateLimitPerMinute}/min · `
                                  : ''}
                                {row.lastUsedAt
                                  ? `last used ${new Date(row.lastUsedAt).toLocaleDateString()}`
                                  : 'never used'}
                              </Text>
                            </Space>
                          }
                        />
                      </List.Item>
                    )}
                  />
                ) : (
                  <Table
                    rowKey="id"
                    loading={loading}
                    dataSource={apiKeys}
                    pagination={false}
                    columns={[
                      { title: 'Name', dataIndex: 'name' },
                      {
                        title: 'Prefix',
                        dataIndex: 'keyPrefix',
                        render: (v: string) => <Text code>{v}</Text>,
                      },
                      {
                        title: 'Scopes',
                        dataIndex: 'scopes',
                        render: (v: string[] | null) =>
                          (v ?? []).map((s) => <Tag key={s}>{s}</Tag>),
                      },
                      {
                        title: 'Rate / min',
                        dataIndex: 'rateLimitPerMinute',
                        render: (v: number | null) => v ?? '—',
                      },
                      {
                        title: 'Last used',
                        dataIndex: 'lastUsedAt',
                        render: (v: string | null) =>
                          v ? new Date(v).toLocaleString() : 'never',
                      },
                      {
                        title: 'Status',
                        dataIndex: 'revokedAt',
                        render: (v: string | null) =>
                          v ? <Tag color="red">revoked</Tag> : <Tag color="green">active</Tag>,
                      },
                      {
                        title: '',
                        render: (_, row) =>
                          row.revokedAt ? null : (
                            <Popconfirm
                              title="Revoke this key? Existing clients will fail immediately."
                              onConfirm={() => revokeKey(row.id)}
                            >
                              <Button danger size="small" icon={<DeleteOutlined />} />
                            </Popconfirm>
                          ),
                      },
                    ]}
                  />
                )}
              </Card>
            ),
          },
          {
            key: 'plugins',
            label: (
              <span>
                <AppstoreAddOutlined /> Plugins
              </span>
            ),
            children: (
              <Card
                extra={
                  <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    onClick={() => setPluginModalOpen(true)}
                  >
                    Create Plugin
                  </Button>
                }
              >
                {plugins.length === 0 ? (
                  <Empty description="No plugins yet. Plugins extend @opengame/runtime with reusable behaviors." />
                ) : compact ? (
                  <List
                    loading={loading}
                    dataSource={plugins}
                    rowKey="id"
                    renderItem={(row) => (
                      <List.Item
                        actions={[
                          <Popconfirm
                            key="unpublish"
                            title="Unpublish this plugin? Existing versions remain in S3 but the registry hides them."
                            onConfirm={async () => {
                              try {
                                await api.plugins.unpublish(row.slug);
                                message.success('Unpublished');
                                await refresh();
                              } catch (err) {
                                if (err instanceof Error) message.error(err.message);
                              }
                            }}
                          >
                            <Button danger size="small" icon={<DeleteOutlined />} />
                          </Popconfirm>,
                        ]}
                      >
                        <List.Item.Meta
                          title={
                            <Space size={6} wrap>
                              <Text strong>{row.name}</Text>
                              {row.isPublic ? (
                                <Tag color="green">public</Tag>
                              ) : (
                                <Tag>private</Tag>
                              )}
                            </Space>
                          }
                          description={
                            <Space direction="vertical" size={2}>
                              <Text code>{row.slug}</Text>
                              <Text type="secondary" style={{ fontSize: 12 }}>
                                {row.latestVersion ?? 'unpublished'} ·{' '}
                                {row.installCount} installs
                              </Text>
                            </Space>
                          }
                        />
                      </List.Item>
                    )}
                  />
                ) : (
                  <Table
                    rowKey="id"
                    loading={loading}
                    dataSource={plugins}
                    pagination={false}
                    columns={[
                      {
                        title: 'Slug',
                        dataIndex: 'slug',
                        render: (v: string) => <Text code>{v}</Text>,
                      },
                      { title: 'Name', dataIndex: 'name' },
                      {
                        title: 'Latest',
                        dataIndex: 'latestVersion',
                        render: (v: string | null) => v ?? <Text type="secondary">unpublished</Text>,
                      },
                      { title: 'Installs', dataIndex: 'installCount' },
                      {
                        title: 'Visibility',
                        dataIndex: 'isPublic',
                        render: (v: boolean) =>
                          v ? <Tag color="green">public</Tag> : <Tag>private</Tag>,
                      },
                      {
                        title: '',
                        render: (_, row) => (
                          <Popconfirm
                            title="Unpublish this plugin? Existing versions remain in S3 but the registry hides them."
                            onConfirm={async () => {
                              try {
                                await api.plugins.unpublish(row.slug);
                                message.success('Unpublished');
                                await refresh();
                              } catch (err) {
                                if (err instanceof Error) message.error(err.message);
                              }
                            }}
                          >
                            <Button danger size="small" icon={<DeleteOutlined />} />
                          </Popconfirm>
                        ),
                      },
                    ]}
                  />
                )}
              </Card>
            ),
          },
        ]}
      />

      <Modal
        open={keyModalOpen}
        onCancel={() => setKeyModalOpen(false)}
        onOk={createKey}
        title="Create API Key"
        okText="Create"
      >
        <Alert
          style={{ marginBottom: 12 }}
          type="warning"
          showIcon
          message="The full secret is shown ONCE. Store it in a secure secrets manager."
        />
        <Form layout="vertical" form={keyForm}>
          <Form.Item name="name" label="Name" rules={[{ required: true }]}>
            <Input placeholder="e.g. partner-news-site" />
          </Form.Item>
          <Form.Item name="scopes" label="Scopes" tooltip="Empty = read-only public endpoints only">
            <Select mode="multiple" options={SCOPE_OPTIONS} placeholder="Pick scopes…" />
          </Form.Item>
          <Form.Item
            name="rateLimitPerMinute"
            label="Rate limit / minute"
            tooltip="Leave blank to use the org default (60)"
          >
            <InputNumber min={1} max={10000} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={revealedKey !== null}
        onCancel={() => setRevealedKey(null)}
        onOk={() => {
          if (revealedKey) navigator.clipboard.writeText(revealedKey).catch(() => undefined);
          setRevealedKey(null);
        }}
        title="Your new API key"
        okText="Copy & Close"
      >
        <Alert
          type="success"
          showIcon
          message="Copy this value now. We never show it again."
        />
        <pre
          style={{
            marginTop: 12,
            padding: 12,
            background: '#000',
            color: '#7fffd4',
            borderRadius: 4,
            fontSize: 14,
            wordBreak: 'break-all',
            whiteSpace: 'pre-wrap',
          }}
        >
          {revealedKey}
        </pre>
        <Paragraph copyable={{ text: revealedKey ?? '' }}>
          <CopyOutlined /> Click to copy
        </Paragraph>
      </Modal>

      <Modal
        open={pluginModalOpen}
        onCancel={() => setPluginModalOpen(false)}
        onOk={createPlugin}
        title="Create Plugin"
        okText="Create"
      >
        <Paragraph type="secondary">
          A plugin is a versioned bundle that exports new behaviors / UI kits / skill effects
          for <Text code>@opengame/runtime</Text>. After creating it here, push tarballs via the
          CLI or `/plugins/&lt;slug&gt;/versions`.
        </Paragraph>
        <Form layout="vertical" form={pluginForm} initialValues={{ isPublic: true }}>
          <Form.Item
            name="slug"
            label="Slug"
            rules={[
              { required: true },
              {
                pattern: /^[a-z][a-z0-9-]{1,40}$/,
                message: 'lowercase letters, digits, hyphens; 2-41 chars',
              },
            ]}
          >
            <Input placeholder="rpg-dialogue" />
          </Form.Item>
          <Form.Item name="name" label="Display name" rules={[{ required: true }]}>
            <Input placeholder="RPG Dialogue System" />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="tags" label="Tags" extra="Comma-separated">
            <Input placeholder="rpg, dialogue, ui" />
          </Form.Item>
          <Form.Item name="isPublic" label="Public" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
