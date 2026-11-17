/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * "This shouldn't be here." Reporting is deliberately two taps and a reason:
 * a queue that is expensive to file into is a queue that stays empty while the
 * problem stays up.
 */

import type React from 'react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Input, Modal, Radio, Space, message } from 'antd';
import { FlagOutlined } from '@ant-design/icons';

import { api, type ReportReason } from '../../services/api';
import { useT } from '../../services/i18n';
import { useAppStore } from '../../store';
import { rememberLoginReturnTo } from '../../utils/loginIntent';

const REASONS: ReportReason[] = ['stolen', 'nsfw', 'illegal', 'broken', 'spam', 'other'];

interface ReportButtonProps {
  /** Exactly one of these decides what is being reported. */
  gameId?: string;
  commentId?: string;
  /** `text` reads better inline in a comment row than an icon-only button. */
  variant?: 'icon' | 'text';
  size?: 'small' | 'middle';
}

export const ReportButton: React.FC<ReportButtonProps> = ({
  gameId,
  commentId,
  variant = 'icon',
  size = 'small',
}) => {
  const { t } = useT();
  const navigate = useNavigate();
  const { isAuthenticated } = useAppStore();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason>('stolen');
  const [detail, setDetail] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const start = (): void => {
    if (!isAuthenticated) {
      message.info(t('report.needLogin'));
      rememberLoginReturnTo(window.location.pathname);
      navigate('/login');
      return;
    }
    setOpen(true);
  };

  const submit = async (): Promise<void> => {
    setSubmitting(true);
    try {
      await api.community.report({
        targetKind: commentId ? 'comment' : 'game',
        ...(commentId ? { commentId } : { gameId }),
        reason,
        ...(detail.trim() ? { detail: detail.trim() } : {}),
      });
      // Filing the same report twice is one report server-side, so the reader
      // gets the same thank-you either way rather than a confusing error.
      message.success(t('report.sent'));
      setOpen(false);
      setDetail('');
    } catch {
      message.error(t('report.failed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Button
        type="text"
        size={size}
        icon={<FlagOutlined />}
        onClick={start}
        aria-label={t('report.action')}
      >
        {variant === 'text' ? t('report.action') : null}
      </Button>
      <Modal
        open={open}
        title={t('report.title')}
        okText={t('report.submit')}
        cancelText={t('common.cancel')}
        confirmLoading={submitting}
        onOk={() => void submit()}
        onCancel={() => setOpen(false)}
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Radio.Group
            value={reason}
            onChange={(e) => setReason(e.target.value as ReportReason)}
          >
            <Space direction="vertical">
              {REASONS.map((value) => (
                <Radio key={value} value={value}>
                  {t(`report.reason.${value}`)}
                </Radio>
              ))}
            </Space>
          </Radio.Group>
          <Input.TextArea
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            placeholder={t('report.detailPlaceholder')}
            maxLength={500}
            showCount
            autoSize={{ minRows: 2, maxRows: 4 }}
          />
        </Space>
      </Modal>
    </>
  );
};
