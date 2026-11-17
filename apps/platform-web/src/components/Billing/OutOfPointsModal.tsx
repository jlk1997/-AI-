/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal, Typography } from 'antd';
import { ThunderboltOutlined } from '@ant-design/icons';

import { useT } from '../../services/i18n';

const { Text } = Typography;

export interface OutOfPointsModalProps {
  /** Null while the wallet still covers the next run. */
  readonly shortfall: {
    readonly need: number;
    readonly balance: number;
    readonly sku?: string;
  } | null;
  readonly onClose: () => void;
}

/**
 * The one dead end in generation a user can fix themselves. Retry is useless
 * here, so the only primary action is the top-up screen.
 */
export const OutOfPointsModal: React.FC<OutOfPointsModalProps> = ({
  shortfall,
  onClose,
}) => {
  const navigate = useNavigate();
  const { t } = useT();

  return (
    <Modal
      open={shortfall !== null}
      centered
      onCancel={onClose}
      onOk={() => {
        onClose();
        const sku = shortfall?.sku ?? 'pack_kai';
        navigate(`/wallet?sku=${sku}`);
      }}
      okText={t('points.topUp')}
      cancelText={t('points.later')}
      title={
        <>
          <ThunderboltOutlined /> {t('points.title')}
        </>
      }
    >
      <Text>
        {t('points.body', {
          need: shortfall?.need ?? 0,
          balance: shortfall?.balance ?? 0,
        })}
      </Text>
    </Modal>
  );
};

export default OutOfPointsModal;
