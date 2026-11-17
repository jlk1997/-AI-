/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { Spin } from 'antd';

interface PageTransitionProps {
  children: React.ReactNode;
  loading?: boolean;
}

export function PageTransition({ children, loading }: PageTransitionProps): React.ReactElement {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // 延迟显示以触发动画
    const timer = setTimeout(() => {
      setIsVisible(true);
    }, 50);
    return () => clearTimeout(timer);
  }, []);

  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '40vh',
        }}
      >
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div
      style={{
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? 'translateY(0)' : 'translateY(10px)',
        transition: 'opacity 0.3s ease, transform 0.3s ease',
      }}
    >
      {children}
    </div>
  );
}
