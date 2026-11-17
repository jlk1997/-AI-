/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Form,
  Input,
  Space,
  Spin,
  Tag,
  Typography,
  message,
} from 'antd';
import { CheckCircleFilled, GlobalOutlined } from '@ant-design/icons';

import { api } from '../../services/api';

const { Text, Paragraph } = Typography;

interface CustomDomainPanelProps {
  readonly deploymentId: string | null;
}

interface DomainState {
  readonly customDomain: string | null;
  readonly verified: boolean;
  readonly acmeChallenge: { recordName: string; recordValue: string; recordType: 'TXT' } | null;
  readonly cdnUrl: string | null;
}

/**
 * Two-step custom domain UI:
 *   1. User submits a hostname → backend records a DNS-01 challenge token.
 *   2. User adds the TXT record then clicks "verify" → backend resolves DNS
 *      and flips the verified flag, populating `cdnUrl`.
 *
 * The panel is intentionally backend-agnostic (the real CDN binding happens
 * via `PLATFORM_CDN_BASE_URL`); from the user's perspective the experience
 * matches Vercel's domain wizard.
 */
export const CustomDomainPanel: React.FC<CustomDomainPanelProps> = ({ deploymentId }) => {
  const [state, setState] = useState<DomainState | null>(null);
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [form] = Form.useForm<{ customDomain: string }>();

  useEffect(() => {
    if (!deploymentId) return;
    setLoading(true);
    api.deployments
      .getDomain(deploymentId)
      .then((res) => setState(res))
      .catch(() => setState(null))
      .finally(() => setLoading(false));
  }, [deploymentId]);

  if (!deploymentId) {
    return (
      <Alert
        type="info"
        message="请先发布或预览一次后再配置自定义域名"
        showIcon
      />
    );
  }

  if (loading) {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <Spin />
      </div>
    );
  }

  const init = async (values: { customDomain: string }): Promise<void> => {
    if (!deploymentId) return;
    try {
      const res = await api.deployments.initDomain(deploymentId, values.customDomain);
      setState({
        customDomain: res.customDomain,
        verified: false,
        acmeChallenge: res.challenge,
        cdnUrl: null,
      });
      message.success('已生成 ACME 挑战，请添加 DNS TXT 记录');
    } catch (err) {
      message.error(`域名初始化失败: ${(err as Error).message}`);
    }
  };

  const verify = async (): Promise<void> => {
    if (!deploymentId) return;
    setVerifying(true);
    try {
      const res = await api.deployments.verifyDomain(deploymentId);
      if (res.ok && res.verified) {
        setState((prev) =>
          prev ? { ...prev, verified: true, cdnUrl: res.cdnUrl ?? prev.cdnUrl } : prev,
        );
        message.success('域名校验通过');
      } else {
        message.error(res.reason ?? 'TXT 记录尚未匹配，请稍后再试');
      }
    } finally {
      setVerifying(false);
    }
  };

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      <Form
        form={form}
        layout="vertical"
        onFinish={init}
        initialValues={{ customDomain: state?.customDomain ?? '' }}
      >
        <Form.Item
          name="customDomain"
          label={
            <Space>
              <GlobalOutlined />
              <Text>自定义域名</Text>
            </Space>
          }
          rules={[
            { required: true, message: '请输入合法的域名' },
            { pattern: /^[a-z0-9][a-z0-9.-]{0,253}[a-z0-9]\.[a-z]{2,}$/i, message: '域名格式不正确' },
          ]}
          extra="例如 my-game.example.com"
        >
          <Input placeholder="my-game.example.com" allowClear />
        </Form.Item>
        <Form.Item>
          <Button type="primary" htmlType="submit">
            {state?.acmeChallenge ? '重新申请挑战' : '生成 DNS-01 挑战'}
          </Button>
        </Form.Item>
      </Form>

      {state?.acmeChallenge && (
        <Alert
          type="info"
          showIcon
          message={
            <Space direction="vertical" size={2} style={{ width: '100%' }}>
              <Text strong>请添加以下 TXT 记录到你的 DNS：</Text>
              <Text code>名称 (Name): {state.acmeChallenge.recordName}</Text>
              <Text code>类型 (Type): {state.acmeChallenge.recordType}</Text>
              <Text code>值 (Value): {state.acmeChallenge.recordValue}</Text>
              <Paragraph type="secondary" style={{ marginBottom: 0, fontSize: 12 }}>
                DNS 全球生效后通常需要 1–5 分钟。点击下面的「验证」让平台执行解析。
              </Paragraph>
            </Space>
          }
        />
      )}

      {state?.customDomain && (
        <Space>
          <Button onClick={verify} loading={verifying} type="default">
            验证 DNS 并完成 CDN 绑定
          </Button>
          {state.verified ? (
            <Tag icon={<CheckCircleFilled />} color="success">
              已验证
            </Tag>
          ) : (
            <Tag color="warning">未验证</Tag>
          )}
        </Space>
      )}

      {state?.cdnUrl && (
        <Alert
          type="success"
          showIcon
          message={
            <Space direction="vertical" size={2} style={{ width: '100%' }}>
              <Text strong>CDN URL</Text>
              <Text copyable>{state.cdnUrl}</Text>
            </Space>
          }
        />
      )}
    </Space>
  );
};
