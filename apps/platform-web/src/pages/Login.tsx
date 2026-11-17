/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Checkbox, Form, Input, InputNumber, Segmented, Typography, message } from 'antd';
import { MailOutlined, WechatOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../store';
import { useTheme } from '../hooks';
import { useT } from '../services/i18n';
import { api } from '../services/api';
import { readLoginReturnTo } from '../utils/loginIntent';
import { captureInviteFromSearch } from '../utils/kaiPaywall';
import { isWeChatBrowser } from '../mobile/deviceShell';
import { BrandMark } from '../brand/BrandMark';
import '../styles/global.css';

const { Title, Text } = Typography;

type LoginMode = 'email' | 'phone';

export function Login(): React.ReactElement {
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<LoginMode>('email');
  const [emailSent, setEmailSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [phoneSent, setPhoneSent] = useState(false);
  const [wechatEnabled, setWechatEnabled] = useState(false);
  const [showPhone, setShowPhone] = useState(false);
  const [showEmail, setShowEmail] = useState(true);
  const [minAge, setMinAge] = useState(16);
  const [acceptedLegal, setAcceptedLegal] = useState(false);
  const [form] = Form.useForm();
  const navigate = useNavigate();
  const { loginWithEmailCode, loginWithMagicToken, loginWithWeChat, loginWithPhone } = useAppStore();
  const { isDark } = useTheme();
  const { t, locale } = useT();

  useEffect(() => {
    captureInviteFromSearch();
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [res, methods] = await Promise.all([
          api.auth.wechatUrl(`${window.location.origin}/login`),
          api.auth.methods().catch(() => null),
        ]);
        if (cancelled) return;
        setWechatEnabled(res.enabled);
        if (methods) {
          setShowPhone(methods.phone);
          setShowEmail(methods.emailCode);
          setMinAge(methods.minAge);
          if (!methods.emailCode && methods.phone) setMode('phone');
        }
      } catch {
        /* email form still renders */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const linkTokenHandled = useRef(false);
  useEffect(() => {
    if (linkTokenHandled.current) return;
    const params = new URLSearchParams(window.location.search);
    const linkToken = params.get('token');
    if (!linkToken) return;
    linkTokenHandled.current = true;
    const returnTo = readLoginReturnTo() ?? '/';
    setLoading(true);
    void (async () => {
      try {
        await loginWithMagicToken(linkToken);
        const pending = sessionStorage.getItem('og_legal_birth');
        await api.auth
          .acceptLegal({
            acceptedLegal: true,
            ...(pending ? { birthYear: Number(pending) } : {}),
          })
          .catch(() => undefined);
        message.success(t('login.success'));
        navigate(returnTo);
      } catch {
        message.error(t('login.magic.verifyFailed'));
        window.history.replaceState({}, '', '/login');
      } finally {
        setLoading(false);
      }
    })();
  }, [loginWithMagicToken, navigate, t]);

  const wechatCodeHandled = useRef(false);
  useEffect(() => {
    if (wechatCodeHandled.current) return;
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    if (!code || !state) return;
    wechatCodeHandled.current = true;
    const returnTo = readLoginReturnTo() ?? '/';
    setLoading(true);
    void (async () => {
      try {
        await loginWithWeChat(code, state);
        const pending = sessionStorage.getItem('og_legal_birth');
        await api.auth
          .acceptLegal({
            acceptedLegal: true,
            ...(pending ? { birthYear: Number(pending) } : {}),
          })
          .catch(() => undefined);
        message.success(t('login.success'));
        navigate(returnTo);
      } catch {
        message.error(t('login.wechat.failed'));
        window.history.replaceState({}, '', '/login');
      } finally {
        setLoading(false);
      }
    })();
  }, [loginWithWeChat, navigate, t]);

  const startWeChat = async (): Promise<void> => {
    setLoading(true);
    try {
      const res = await api.auth.wechatUrl(`${window.location.origin}/login`);
      if (!res.enabled || !res.url) {
        message.warning(t('login.wechat.unavailable'));
        return;
      }
      window.location.href = res.url;
    } catch {
      message.error(t('login.wechat.failed'));
    } finally {
      setLoading(false);
    }
  };

  const requireLegal = (birthYear?: number): boolean => {
    if (!acceptedLegal) {
      message.warning(t('login.legal.need'));
      return false;
    }
    if (birthYear) sessionStorage.setItem('og_legal_birth', String(birthYear));
    return true;
  };

  const sendEmailCode = async (email: string, birthYear?: number): Promise<void> => {
    if (!requireLegal(birthYear)) return;
    setLoading(true);
    try {
      await api.auth.emailRequest(email);
      setEmailSent(true);
      setCooldown(60);
      message.success(t('login.email.sent'));
    } catch {
      message.error(t('login.email.failed'));
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (values: {
    email?: string;
    code?: string;
    phone?: string;
    birthYear?: number;
  }) => {
    if (!requireLegal(values.birthYear)) return;
    setLoading(true);
    try {
      if (mode === 'phone') {
        const phone = (values.phone ?? '').trim();
        if (!phoneSent || !values.code) {
          await api.auth.phoneRequest(phone);
          setPhoneSent(true);
          message.success(t('login.phone.sent'));
          return;
        }
        await loginWithPhone(phone, values.code);
      } else {
        const email = (values.email ?? '').trim();
        if (!emailSent || !values.code) {
          await api.auth.emailRequest(email);
          setEmailSent(true);
          setCooldown(60);
          message.success(t('login.email.sent'));
          return;
        }
        await loginWithEmailCode(email, values.code);
      }
      await api.auth
        .acceptLegal({ acceptedLegal: true, birthYear: values.birthYear })
        .catch(() => undefined);
      message.success(t('login.success'));
      navigate(readLoginReturnTo() ?? '/');
    } catch {
      message.error(mode === 'phone' ? t('login.phone.failed') : t('login.email.failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: isDark
          ? 'linear-gradient(160deg, #14121a 0%, #2a2118 100%)'
          : 'linear-gradient(160deg, #3a2418 0%, #c45c26 70%, #e0b25a 100%)',
        padding: 20,
      }}
    >
      <Card style={{ width: '100%', maxWidth: 420, borderRadius: 16 }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: 18,
              background: 'var(--color-night)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 16,
            }}
          >
            <BrandMark size={48} title={t('app.brand')} />
          </div>
          <Title level={3} style={{ marginBottom: 8 }}>
            {t('login.title')}
          </Title>
          <Text type="secondary">{t('app.tagline')}</Text>
        </div>

        {wechatEnabled && (locale === 'zh-CN' || isWeChatBrowser()) ? (
          <Button
            block
            icon={<WechatOutlined />}
            onClick={() => void startWeChat()}
            style={{ height: 48, marginBottom: 16, background: '#07c160', color: '#fff' }}
          >
            {t('login.wechat.button')}
          </Button>
        ) : null}

        {!showEmail && !showPhone ? (
          <Alert type="warning" showIcon message={t('login.email.unconfigured')} />
        ) : null}

        {showEmail && showPhone ? (
          <Segmented
            block
            value={mode}
            onChange={(value) => setMode(value as LoginMode)}
            options={[
              { label: t('login.tab.email'), value: 'email' },
              { label: t('login.tab.phone'), value: 'phone' },
            ]}
            style={{ marginBottom: 16 }}
          />
        ) : null}

        <Form form={form} layout="vertical" size="large" onFinish={handleSubmit}>
          {mode === 'phone' && showPhone ? (
            <>
              <Form.Item name="phone" label={t('login.phone.label')} rules={[{ required: true }]}>
                <Input placeholder={t('login.phone.placeholder')} />
              </Form.Item>
              {phoneSent ? (
                <Form.Item name="code" label={t('login.phone.code')} rules={[{ required: true }]}>
                  <Input placeholder={t('login.phone.codePlaceholder')} maxLength={6} />
                </Form.Item>
              ) : null}
            </>
          ) : showEmail ? (
            <>
              <Form.Item
                name="email"
                label={t('login.email')}
                rules={[{ required: true, type: 'email', message: t('login.email') }]}
              >
                <Input placeholder={t('login.emailPlaceholder')} />
              </Form.Item>
              {emailSent ? (
                <Form.Item name="code" label={t('login.email.code')} rules={[{ required: true }]}>
                  <Input placeholder={t('login.email.codePlaceholder')} maxLength={6} />
                </Form.Item>
              ) : null}
            </>
          ) : null}

          <Form.Item
            name="birthYear"
            label={t('login.legal.birthYear')}
            rules={[{ required: true, message: t('login.legal.birthYear') }]}
          >
            <InputNumber
              min={1900}
              max={new Date().getFullYear() - minAge}
              style={{ width: '100%' }}
              placeholder={String(new Date().getFullYear() - 20)}
            />
          </Form.Item>
          <Checkbox checked={acceptedLegal} onChange={(e) => setAcceptedLegal(e.target.checked)}>
            {t('login.legal.accept')}{' '}
            <a href="/terms" target="_blank" rel="noreferrer">
              {t('terms.title')}
            </a>
            {' · '}
            <a href="/privacy" target="_blank" rel="noreferrer">
              {t('privacy.title')}
            </a>
          </Checkbox>
          <Form.Item style={{ marginTop: 20 }}>
            <Button
              type="primary"
              htmlType="submit"
              block
              loading={loading}
              icon={<MailOutlined />}
              style={{ height: 48 }}
              disabled={!showEmail && !showPhone}
            >
              {mode === 'phone'
                ? phoneSent
                  ? t('login.phone.verify')
                  : t('login.phone.send')
                : emailSent
                  ? t('login.email.verify')
                  : t('login.email.send')}
            </Button>
          </Form.Item>
        </Form>

        {mode === 'email' && emailSent ? (
          <Button
            type="link"
            block
            disabled={cooldown > 0 || loading}
            onClick={() => {
              const email = String(form.getFieldValue('email') ?? '').trim();
              const birthYear = form.getFieldValue('birthYear') as number | undefined;
              if (email) void sendEmailCode(email, birthYear);
            }}
          >
            {cooldown > 0 ? t('login.email.cooldown', { seconds: cooldown }) : t('login.email.resend')}
          </Button>
        ) : null}

        <Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 8 }}>
          {t('login.email.hint')}
        </Text>
        <Button type="link" block onClick={() => navigate('/community')}>
          {t('login.browse')}
        </Button>
      </Card>
    </div>
  );
}
