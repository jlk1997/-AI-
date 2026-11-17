/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Button } from 'antd';
import { BrandMark } from '../../brand/BrandMark';

export const AlleyEmpty: React.FC<{
  readonly title: string;
  readonly hint: string;
  readonly action?: string;
  readonly onAction?: () => void;
}> = ({ title, hint, action, onAction }) => (
  <div className="og-empty-alley">
    <div className="og-empty-alley__art">
      <BrandMark size={44} />
    </div>
    <div className="og-empty-alley__title">{title}</div>
    <div className="og-empty-alley__hint">{hint}</div>
    {action && onAction ? (
      <Button type="primary" style={{ marginTop: 14 }} onClick={onAction}>
        {action}
      </Button>
    ) : null}
  </div>
);
