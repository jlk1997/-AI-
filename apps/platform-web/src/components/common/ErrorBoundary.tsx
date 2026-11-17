/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { ReactNode } from 'react';
import { Button, Result } from 'antd';

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  handleReload = (): void => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  override render(): React.ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <Result
          status="error"
          title="页面出错了"
          subTitle="抱歉，页面加载时遇到了问题，请尝试刷新页面"
          extra={[
            <Button key="reload" type="primary" onClick={this.handleReload}>
              刷新页面
            </Button>,
            <Button key="home" onClick={() => (window.location.href = '/')}>
              返回首页
            </Button>,
          ]}
        />
      );
    }

    return this.props.children;
  }
}

// 网络状态监听 Hook
export function useNetworkStatus(): boolean {
  const [isOnline, setIsOnline] = React.useState(navigator.onLine);

  React.useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}

// 网络断开提示组件
export const NetworkStatusIndicator: React.FC = () => {
  const isOnline = useNetworkStatus();

  if (isOnline) {
    return null;
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        padding: '8px 16px',
        background: '#ef4444',
        color: '#fff',
        textAlign: 'center',
        fontSize: 14,
        zIndex: 9999,
      }}
    >
      网络连接已断开，请检查网络后刷新页面
    </div>
  );
}

export { ErrorBoundary };
