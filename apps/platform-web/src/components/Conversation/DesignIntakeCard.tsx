/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { Button, Radio, Space, Typography } from 'antd';
import type { ArtStyleId } from '@opengame/world-spec';
import { useTheme } from '../../hooks/useTheme';
import { useT } from '../../services/i18n';
import {
  INTAKE_ARCHETYPE_OPTIONS,
  INTAKE_ART_TONES,
  INTAKE_WIN_FEELS,
  inferIntakeDefaults,
  type DesignIntakeAnswers,
  type IntakeArchetype,
} from '../../utils/designIntake';

const { Text, Title } = Typography;

interface DesignIntakeCardProps {
  readonly promptPreview: string;
  readonly open: boolean;
  readonly onConfirm: (answers: DesignIntakeAnswers) => void;
  readonly onSkip: (answers: DesignIntakeAnswers) => void;
  readonly loading?: boolean;
}

export const DesignIntakeCard: React.FC<DesignIntakeCardProps> = ({
  promptPreview,
  open,
  onConfirm,
  onSkip,
  loading,
}) => {
  const { isDark } = useTheme();
  const { t } = useT();
  const [answers, setAnswers] = useState<DesignIntakeAnswers>(() =>
    inferIntakeDefaults(promptPreview),
  );

  useEffect(() => {
    if (open) setAnswers(inferIntakeDefaults(promptPreview));
  }, [open, promptPreview]);

  if (!open) return null;

  const border = isDark ? '#27272a' : '#e2e8f0';
  const bg = isDark ? '#111113' : '#f8fafc';

  return (
    <div
      style={{
        margin: '0 20px 12px',
        padding: '14px 16px',
        borderRadius: 12,
        border: `1px solid ${border}`,
        background: bg,
      }}
    >
      <Title level={5} style={{ margin: '0 0 4px', color: isDark ? '#f4f4f5' : '#0f172a' }}>
        {t('intake.title')}
      </Title>
      <Text type="secondary" style={{ fontSize: 12 }}>
        {t('intake.subtitle')}
      </Text>

      <div style={{ marginTop: 12 }}>
        <Text strong style={{ fontSize: 12 }}>
          {t('intake.q.playShape')}
        </Text>
        <Radio.Group
          style={{ display: 'block', marginTop: 8 }}
          value={answers.preferredArchetype}
          onChange={(e) =>
            setAnswers((a) => ({
              ...a,
              preferredArchetype: e.target.value as IntakeArchetype,
            }))
          }
        >
          <Space orientation="vertical" size={6} style={{ width: '100%' }}>
            {INTAKE_ARCHETYPE_OPTIONS.map((opt) => (
              <Radio key={opt.id} value={opt.id} style={{ alignItems: 'flex-start' }}>
                <span style={{ fontWeight: 600 }}>{t(opt.titleKey)}</span>
                <span style={{ display: 'block', fontSize: 11, opacity: 0.75 }}>
                  {t(opt.descKey)}
                </span>
              </Radio>
            ))}
          </Space>
        </Radio.Group>
      </div>

      <div style={{ marginTop: 14 }}>
        <Text strong style={{ fontSize: 12 }}>
          {t('intake.q.artTone')}
        </Text>
        <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
          {t('intake.art.hint')}
        </Text>
        <Radio.Group
          optionType="button"
          buttonStyle="solid"
          style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}
          value={answers.artTone}
          onChange={(e) =>
            setAnswers((a) => ({ ...a, artTone: e.target.value as ArtStyleId }))
          }
          options={INTAKE_ART_TONES.map((x) => ({
            label: t(x.labelKey),
            value: x.id,
          }))}
        />
        <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 6 }}>
          {t(`intake.art.${answers.artTone}.desc`)}
        </Text>
      </div>

      <div style={{ marginTop: 14 }}>
        <Text strong style={{ fontSize: 12 }}>
          {t('intake.q.winFeel')}
        </Text>
        <Radio.Group
          optionType="button"
          buttonStyle="solid"
          style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}
          value={answers.winFeel}
          onChange={(e) => setAnswers((a) => ({ ...a, winFeel: e.target.value }))}
          options={INTAKE_WIN_FEELS.map((x) => ({
            label: t(x.labelKey),
            value: x.id,
          }))}
        />
      </div>

      <div
        style={{
          marginTop: 16,
          display: 'flex',
          gap: 8,
          justifyContent: 'flex-end',
          flexWrap: 'wrap',
        }}
      >
        <Button disabled={loading} onClick={() => onSkip(answers)}>
          {t('intake.skip')}
        </Button>
        <Button
          type="primary"
          loading={loading}
          onClick={() => onConfirm(answers)}
        >
          {t('intake.confirm')}
        </Button>
      </div>
    </div>
  );
};
