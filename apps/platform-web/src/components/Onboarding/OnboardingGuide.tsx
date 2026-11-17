/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Modal, Steps, Button, Space, Typography, Card, message, Segmented } from 'antd';
import {
  ThunderboltOutlined,
  PlayCircleOutlined,
  GlobalOutlined,
  RocketOutlined,
  ArrowRightOutlined,
  CloseOutlined,
  ExperimentOutlined,
} from '@ant-design/icons';
import { useT } from '../../services/i18n';

const { Title, Paragraph } = Typography;

interface OnboardingGuideProps {
  open: boolean;
  onClose: () => void;
  onStartCreate: () => void;
  onStartWorld?: () => void;
}

/** Dual-mode 3-step tour: Game = describe→generate→play; World = describe→generate→observe. */
export const OnboardingGuide: React.FC<OnboardingGuideProps> = ({
  open,
  onClose,
  onStartCreate,
  onStartWorld,
}) => {
  const { t } = useT();
  const [track, setTrack] = useState<'game' | 'world'>('game');
  const [currentStep, setCurrentStep] = useState(0);

  const gameSteps = [
    {
      title: t('onboarding.game.step1.title'),
      description: t('onboarding.game.step1.desc'),
      icon: <ThunderboltOutlined />,
      tip: t('onboarding.game.step1.tip'),
    },
    {
      title: t('onboarding.game.step2.title'),
      description: t('onboarding.game.step2.desc'),
      icon: <RocketOutlined />,
      tip: t('onboarding.game.step2.tip'),
    },
    {
      title: t('onboarding.game.step3.title'),
      description: t('onboarding.game.step3.desc'),
      icon: <PlayCircleOutlined />,
      tip: t('onboarding.game.step3.tip'),
    },
  ];

  const worldSteps = [
    {
      title: t('onboarding.world.step1.title'),
      description: t('onboarding.world.step1.desc'),
      icon: <GlobalOutlined />,
      tip: t('onboarding.world.step1.tip'),
    },
    {
      title: t('onboarding.world.step2.title'),
      description: t('onboarding.world.step2.desc'),
      icon: <ThunderboltOutlined />,
      tip: t('onboarding.world.step2.tip'),
    },
    {
      title: t('onboarding.world.step3.title'),
      description: t('onboarding.world.step3.desc'),
      icon: <ExperimentOutlined />,
      tip: t('onboarding.world.step3.tip'),
    },
  ];

  const steps = track === 'world' ? worldSteps : gameSteps;

  const handleStart = () => {
    onClose();
    if (track === 'world' && onStartWorld) {
      onStartWorld();
      message.success(t('onboarding.world.startToast'));
      return;
    }
    onStartCreate();
    message.info(t('onboarding.game.startToast'));
  };

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      handleStart();
    }
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={560}
      closeIcon={<CloseOutlined />}
      styles={{ body: { paddingTop: 8 } }}
    >
      <Title level={4} style={{ marginBottom: 8 }}>
        {t('onboarding.title')}
      </Title>
      <Paragraph type="secondary" style={{ marginBottom: 16 }}>
        {t('onboarding.subtitle')}
      </Paragraph>
      <Segmented
        value={track}
        onChange={(v) => {
          setTrack(v as 'game' | 'world');
          setCurrentStep(0);
        }}
        options={[
          { value: 'game', label: t('product.mode.game') },
          { value: 'world', label: t('product.mode.world') },
        ]}
        style={{ marginBottom: 20 }}
      />
      <Steps
        current={currentStep}
        size="small"
        items={steps.map((s) => ({
          title: s.title,
          description: s.description,
          icon: s.icon,
        }))}
        style={{ marginBottom: 20 }}
      />
      <Card size="small" style={{ marginBottom: 20 }}>
        <Paragraph style={{ marginBottom: 0, fontSize: 13 }}>
          {steps[currentStep]?.tip}
        </Paragraph>
      </Card>
      <Space style={{ width: '100%', justifyContent: 'space-between' }}>
        <Button
          disabled={currentStep === 0}
          onClick={() => setCurrentStep((s) => Math.max(0, s - 1))}
        >
          {t('onboarding.back')}
        </Button>
        <Button type="primary" icon={<ArrowRightOutlined />} onClick={handleNext}>
          {currentStep >= steps.length - 1
            ? track === 'world'
              ? t('world.quickStart.oneClick')
              : t('onboarding.startCreate')
            : t('onboarding.next')}
        </Button>
      </Space>
    </Modal>
  );
};
