/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  Alert,
  Modal,
  Form,
  Input,
  Select,
  Switch,
  Space,
  Tag,
  Button,
  Checkbox,
  InputNumber,
  message,
  Typography,
} from 'antd';
import { GlobalOutlined, LinkOutlined, LockOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { leaseActive, SOCIETY_WORLD_LIGHT } from '@opengame/platform-shared';
import { previewIframeAllow, previewIframeSandbox } from '../../utils/previewIframeSandbox';
import { ApiError, api, type CommunityLicense } from '../../services/api';
import {
  isPublishUnfundedError,
  translateApiError,
  useT,
} from '../../services/i18n';
import {
  openWalletForPaywall,
  paywallNeedCopy,
} from '../../utils/kaiPaywall';
import {
  getPublishedSlug,
  rememberPublishedSlug,
} from '../../utils/communityPublishMemory';
import { publishListedWorldAction } from './publishWorldFund';
import { playLink } from '../../utils/shareCard';
import { sharePublishedWork } from '../../utils/shareWork';

const { Text } = Typography;
const { TextArea } = Input;

export type PublishKind = 'game' | 'world';

interface PublishGameModalProps {
  open: boolean;
  onClose: () => void;
  deploymentId?: string;
  projectId?: string;
  projectName?: string;
  kind?: PublishKind;
  onSuccess?: (slug: string, alreadyPublished?: boolean) => void;
}

const CATEGORY_VALUES = [
  'arcade',
  'puzzle',
  'action',
  'strategy',
  'rpg',
  'story',
  'world',
  'other',
] as const;

const CATEGORY_COLORS: Record<string, string> = {
  arcade: '#ef4444',
  puzzle: '#E0B25A',
  action: '#f59e0b',
  strategy: '#10b981',
  rpg: '#C45C26',
  story: '#E0B25A',
  world: '#2A9D8F',
  other: '#6b7280',
};

const SUGGESTED_TAG_KEYS = [
  'casual',
  'puzzle',
  'shooter',
  'parkour',
  'platformer',
  'tower',
  'story',
  'world',
] as const;

export const PublishGameModal: React.FC<PublishGameModalProps> = ({
  open,
  onClose,
  deploymentId,
  projectId,
  projectName,
  kind = 'game',
  onSuccess,
}) => {
  const { t } = useT();
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isPublic, setIsPublic] = useState(true);
  const [acceptedLegal, setAcceptedLegal] = useState(false);
  const [minAge, setMinAge] = useState(16);
  const [savedBirthYear, setSavedBirthYear] = useState<number | null>(null);
  /**
   * Publishing used to dump the work into an undifferentiated list and open a
   * new tab. The author's next useful act is sending one person a link, so we
   * stay on a small "here is your page" step instead.
   */
  const [published, setPublished] = useState<{ slug: string; title: string } | null>(null);
  const [resolvedProjectId, setResolvedProjectId] = useState<string | undefined>(
    undefined,
  );
  const [lightUntil, setLightUntil] = useState<string | null>(null);
  const [needFund, setNeedFund] = useState(false);
  const [funding, setFunding] = useState<'day' | 'week' | null>(null);

  const defaultCategory = kind === 'world' ? 'world' : 'other';
  const defaultTitle =
    projectName?.trim() ||
    (kind === 'world'
      ? t('community.publish.defaultWorldTitle')
      : t('community.publish.defaultGameTitle'));

  useEffect(() => {
    if (!open) return;
    form.setFieldsValue({
      title: defaultTitle,
      category: defaultCategory,
      isPublic: true,
      description: '',
      license: 'remix-ok',
    });
    setIsPublic(true);
    setSelectedTags([]);
    setPublished(null);
    setAcceptedLegal(false);
    setSavedBirthYear(null);
    setNeedFund(false);
    setLightUntil(null);
    setFunding(null);
    setResolvedProjectId(undefined);
    void api.auth
      .legal()
      .then((legal) => {
        setMinAge(legal.minAge || 16);
        setSavedBirthYear(legal.birthYear);
        setAcceptedLegal(Boolean(legal.acceptedLegalAt));
        if (legal.birthYear) {
          form.setFieldValue('birthYear', legal.birthYear);
        }
      })
      .catch(() => undefined);
  }, [open, defaultTitle, defaultCategory, form]);

  const fundProjectId = projectId ?? resolvedProjectId;

  useEffect(() => {
    if (!open || kind !== 'world' || !fundProjectId) {
      return;
    }
    let cancelled = false;
    void api.world
      .get(fundProjectId)
      .then((res) => {
        if (cancelled) return;
        setLightUntil(res.world?.lightUntil ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, kind, fundProjectId]);

  useEffect(() => {
    if (!open || !deploymentId) {
      setPreviewUrl(null);
      return;
    }
    let cancelled = false;
    api.deployments
      .getPreviewUrl(deploymentId)
      .then((data) => {
        if (cancelled) return;
        setPreviewUrl(data.url);
        if (data.projectId) setResolvedProjectId(data.projectId);
      })
      .catch(() => {
        if (!cancelled) setPreviewUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, deploymentId]);

  const handleSubmit = async () => {
    if (!deploymentId) {
      message.error(t('community.publish.noDeployment'));
      return;
    }
    const existing = getPublishedSlug(deploymentId);
    const listed = publishListedWorldAction({
      existingSlug: existing,
      kind,
      isPublic,
      townFunded: leaseActive(lightUntil),
      lampKnown: lightUntil != null,
    });
    if (listed === 'already' && existing) {
      message.info(t('community.publish.alreadyPublished'));
      onSuccess?.(existing, true);
      onClose();
      return;
    }
    if (listed === 'need_fund') {
      setNeedFund(true);
      message.warning(t('community.publish.unfunded'));
      return;
    }
    if (isPublic && !acceptedLegal) {
      message.warning(t('login.legal.need'));
      return;
    }
    try {
      const values = await form.validateFields();
      setLoading(true);
      const birthYear = Number(values.birthYear ?? savedBirthYear);
      const yearNow = new Date().getFullYear();
      if (isPublic) {
        if (!Number.isFinite(birthYear) || birthYear < 1900) {
          message.warning(t('community.publish.needBirthYear', { age: minAge }));
          return;
        }
        if (yearNow - birthYear < minAge) {
          message.warning(t('community.publish.tooYoung', { age: minAge }));
          return;
        }
        await api.auth.acceptLegal({
          acceptedLegal: true,
          birthYear: Math.floor(birthYear),
        });
      } else if (acceptedLegal) {
        await api.auth
          .acceptLegal({
            acceptedLegal: true,
            ...(Number.isFinite(birthYear) ? { birthYear: Math.floor(birthYear) } : {}),
          })
          .catch(() => undefined);
      }
      const result = await api.community.publishGame({
        deploymentId,
        title: values.title,
        description: values.description || '',
        category: values.category,
        tags: selectedTags,
        isPublic: values.isPublic !== false,
        license: (values.license as CommunityLicense) ?? 'remix-ok',
      });
      const slug = result.slug;
      const already = Boolean(
        (result as { alreadyPublished?: boolean }).alreadyPublished,
      );
      rememberPublishedSlug(deploymentId, slug);
      message.success(
        already
          ? t('community.publish.alreadyPublished')
          : t('community.publish.success'),
      );
      onSuccess?.(slug, already);
      setPublished({ slug, title: values.title });
    } catch (error: unknown) {
      if (isPublishUnfundedError(error)) {
        setNeedFund(true);
      }
      message.error(
        error instanceof ApiError
          ? translateApiError(error)
          : error instanceof Error
            ? error.message
            : t('community.publish.failed'),
      );
    } finally {
      setLoading(false);
    }
  };

  const townFunded = leaseActive(lightUntil);
  const showWorldFund = kind === 'world' && isPublic && Boolean(fundProjectId);

  const fundTown = async (sku: 'day' | 'week'): Promise<void> => {
    if (!fundProjectId) return;
    const retryPublish = needFund;
    setFunding(sku);
    try {
      const res = await api.world.worldLight(fundProjectId, sku);
      setLightUntil(res.lightUntil ?? res.talkBudget?.litUntil ?? null);
      setNeedFund(false);
      message.success(t('community.publish.fundOk'));
      if (retryPublish) {
        void handleSubmit();
      }
    } catch (error: unknown) {
      const wall = openWalletForPaywall(error, navigate);
      message.warning(
        wall ? paywallNeedCopy(t, wall) : translateApiError(error),
      );
    } finally {
      setFunding(null);
    }
  };

  const handleTagToggle = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag)
        ? prev.filter((t) => t !== tag)
        : prev.length < 5
          ? [...prev, tag]
          : prev,
    );
  };

  const workUrl = published ? playLink(published.slug) : '';
  const remixProof = '';

  const copy = (text: string) => {
    void navigator.clipboard.writeText(text);
    message.success(t('community.publish.done.copied'));
  };

  if (published) {
    return (
      <Modal
        title={t('community.publish.done.title')}
        open={open}
        onCancel={onClose}
        onOk={onClose}
        okText={t('community.publish.done.close')}
        width={500}
        destroyOnHidden
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Text strong>{published.title}</Text>
          <Input readOnly value={workUrl} />
          <Space wrap>
            <Button icon={<LinkOutlined />} onClick={() => copy(workUrl)}>
              {t('community.publish.done.copyLink')}
            </Button>
            <Button
              onClick={() => {
                void sharePublishedWork({
                  slug: published.slug,
                  title: published.title,
                }).then(({ result, posterSaved }) => {
                  if (result === 'wechat') message.info(t('mobile.share.wechatHint'));
                  else if (result === 'copied') message.success(t('community.publish.done.copied'));
                  else if (result === 'failed') message.error(t('mobile.share.failed'));
                  if (posterSaved) message.success(t('mobile.share.posterSaved'));
                });
              }}
            >
              {t('community.gameDetail.share')}
            </Button>
            <Button
              onClick={() =>
                copy(
                  t('community.publish.done.inviteText', {
                    title: published.title,
                    url: workUrl,
                    remix: remixProof,
                  }),
                )
              }
            >
              {t('community.publish.done.inviteRemix')}
            </Button>
            <Button
              type="primary"
              onClick={() => {
                onClose();
                navigate(`/community/game/${published.slug}`);
              }}
            >
              {t('community.publish.done.openPage')}
            </Button>
          </Space>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('community.publish.done.hint')}
          </Text>
        </Space>
      </Modal>
    );
  }

  return (
    <Modal
      title={
        kind === 'world'
          ? t('community.publish.titleWorld')
          : t('community.publish.titleGame')
      }
      open={open}
      onCancel={onClose}
      onOk={() => void handleSubmit()}
      okText={t('community.publish.submit')}
      confirmLoading={loading}
      width={500}
      destroyOnHidden
    >
      <Form form={form} layout="vertical">
        {previewUrl ? (
          <div
            style={{
              marginBottom: 16,
              borderRadius: 8,
              overflow: 'hidden',
              border: '1px solid #303030',
            }}
          >
            <iframe
              src={previewUrl}
              title={t('community.publish.previewTitle')}
              style={{ width: '100%', height: 200, border: 'none' }}
              sandbox={previewIframeSandbox(previewUrl)}
              allow={previewIframeAllow()}
            />
          </div>
        ) : null}

        <Form.Item
          name="title"
          label={t('community.publish.fieldTitle')}
          rules={[
            { required: true, message: t('community.publish.titleRequired') },
          ]}
        >
          <Input
            placeholder={t('community.publish.titlePlaceholder')}
            maxLength={50}
            showCount
          />
        </Form.Item>

        <Form.Item
          name="description"
          label={t('community.publish.fieldDescription')}
        >
          <TextArea
            placeholder={t('community.publish.descriptionPlaceholder')}
            rows={3}
            maxLength={500}
            showCount
          />
        </Form.Item>

        <Form.Item
          name="category"
          label={t('community.publish.fieldCategory')}
          rules={[
            {
              required: true,
              message: t('community.publish.categoryRequired'),
            },
          ]}
        >
          <Select>
            {CATEGORY_VALUES.map((value) => (
              <Select.Option key={value} value={value}>
                <Tag color={CATEGORY_COLORS[value]}>
                  {t(`community.category.${value}`)}
                </Tag>
              </Select.Option>
            ))}
          </Select>
        </Form.Item>

        <Form.Item label={t('community.publish.fieldTags')}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {SUGGESTED_TAG_KEYS.map((key) => {
              const label = t(`community.publish.tag.${key}`);
              return (
                <Tag
                  key={key}
                  style={{
                    cursor: 'pointer',
                    background: selectedTags.includes(label)
                      ? 'var(--color-ember)'
                      : 'transparent',
                    borderColor: selectedTags.includes(label)
                      ? 'var(--color-ember)'
                      : 'var(--border-color)',
                    color: selectedTags.includes(label) ? '#fff' : '#a1a1aa',
                  }}
                  onClick={() => handleTagToggle(label)}
                >
                  {label}
                </Tag>
              );
            })}
          </div>
        </Form.Item>

        {/*
          Nobody who plays this ever receives its source, so the only route
          into it is a fork — and this is where the author decides whether that
          door is open. Defaulting to open keeps the loop alive; making it a
          visible choice is what lets an author publish something they care
          about without feeling they gave it away.
        */}
        <Form.Item name="license" label={t('community.publish.fieldLicense')}>
          <Select
            options={[
              {
                value: 'remix-ok',
                label: t('community.publish.license.remixOk'),
              },
              {
                value: 'remix-credit',
                label: t('community.publish.license.remixCredit'),
              },
              {
                value: 'no-remix',
                label: t('community.publish.license.noRemix'),
              },
            ]}
          />
        </Form.Item>
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 16 }}>
          {t('community.publish.licenseHint')}
        </Text>

        <Form.Item name="isPublic" valuePropName="checked" style={{ marginBottom: 0 }}>
          <Space>
            <Switch
              checkedChildren={<GlobalOutlined />}
              unCheckedChildren={<LockOutlined />}
              checked={isPublic}
              onChange={(v) => {
                setIsPublic(v);
                form.setFieldValue('isPublic', v);
              }}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              {isPublic
                ? t('community.publish.publicHint')
                : t('community.publish.privateHint')}
            </Text>
          </Space>
        </Form.Item>

        {showWorldFund ? (
          <Alert
            type={needFund || !townFunded ? 'warning' : 'success'}
            showIcon
            style={{ marginTop: 12 }}
            message={
              needFund || !townFunded
                ? t('community.publish.unfunded')
                : t('community.publish.fundOk')
            }
            description={
              <Space orientation="vertical" size={8} style={{ width: '100%' }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {t('community.publish.fundHint')}
                </Text>
                {needFund || !townFunded ? (
                  <Space wrap>
                    <Button
                      size="small"
                      type="primary"
                      loading={funding === 'day'}
                      disabled={funding === 'week'}
                      onClick={() => void fundTown('day')}
                    >
                      {t('community.publish.fundDay', {
                        points: SOCIETY_WORLD_LIGHT.day.points,
                      })}
                    </Button>
                    <Button
                      size="small"
                      loading={funding === 'week'}
                      disabled={funding === 'day'}
                      onClick={() => void fundTown('week')}
                    >
                      {t('community.publish.fundWeek', {
                        points: SOCIETY_WORLD_LIGHT.week.points,
                      })}
                    </Button>
                  </Space>
                ) : null}
              </Space>
            }
          />
        ) : null}

        {isPublic ? (
          <Form.Item
            name="birthYear"
            label={t('login.legal.birthYear')}
            extra={t('community.publish.birthYearHint', { age: minAge })}
            rules={[
              { required: true, message: t('community.publish.needBirthYear', { age: minAge }) },
            ]}
            style={{ marginTop: 12 }}
          >
            <InputNumber
              min={1900}
              max={new Date().getFullYear() - minAge}
              placeholder={String(new Date().getFullYear() - 20)}
              style={{ width: '100%' }}
            />
          </Form.Item>
        ) : null}

        <Checkbox
          checked={acceptedLegal}
          onChange={(e) => setAcceptedLegal(e.target.checked)}
          style={{ marginTop: 12 }}
        >
          {t('login.legal.accept')}{' '}
          <a href="/terms" target="_blank" rel="noreferrer">
            {t('community.publish.termsLink')}
          </a>
          {' · '}
          <a href="/privacy" target="_blank" rel="noreferrer">
            {t('privacy.title')}
          </a>
        </Checkbox>
      </Form>
    </Modal>
  );
};
