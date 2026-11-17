/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Spin } from 'antd';
import type { CSSProperties } from 'react';

interface LoadingProps {
  tip?: string;
  size?: 'small' | 'default' | 'large';
  style?: CSSProperties;
  fullScreen?: boolean;
}

export function Loading({ tip, size = 'default', style, fullScreen }: LoadingProps): React.ReactElement {
  if (fullScreen) {
    return (
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(255, 255, 255, 0.8)',
          zIndex: 9999,
          ...style,
        }}
      >
        <Spin size={size} description={tip} />
      </div>
    );
  }

  return (
    <div style={{ textAlign: 'center', padding: '60px 0', ...style }}>
      <Spin size={size} description={tip} />
    </div>
  );
}
