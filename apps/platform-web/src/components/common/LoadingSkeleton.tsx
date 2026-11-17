/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

interface LoadingSkeletonProps {
  type?: 'message' | 'preview' | 'status';
}

export const LoadingSkeleton: React.FC<LoadingSkeletonProps> = ({ type = 'message' }) => {
  if (type === 'message') {
    return (
      <div
        style={{
          display: 'flex',
          gap: 12,
          marginBottom: 16,
          animation: 'pulse 1.5s infinite',
        }}
      >
        {/* 头像骨架 */}
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            background: '#303030',
          }}
        />
        {/* 内容骨架 */}
        <div style={{ flex: 1 }}>
          <div
            style={{
              width: 60,
              height: 12,
              background: '#303030',
              borderRadius: 4,
              marginBottom: 8,
            }}
          />
          <div
            style={{
              width: '100%',
              height: 40,
              background: '#303030',
              borderRadius: 12,
            }}
          />
        </div>
      </div>
    );
  }

  if (type === 'preview') {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
          borderRadius: 8,
        }}
      >
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, var(--color-ember) 0%, var(--color-ember-deep) 100%)',
            animation: 'pulse 1.5s infinite',
            marginBottom: 24,
          }}
        />
        <div
          style={{
            width: 200,
            height: 20,
            background: '#303030',
            borderRadius: 4,
            marginBottom: 16,
          }}
        />
        <div
          style={{
            width: 160,
            height: 16,
            background: '#262626',
            borderRadius: 4,
          }}
        />
      </div>
    );
  }

  if (type === 'status') {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 0,
          padding: '16px 24px',
          background: 'var(--bg-card)',
          borderRadius: 'var(--radius-lg)',
        }}
      >
        {[0, 1, 2].map((i) => (
          <React.Fragment key={i}>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <div
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  background: '#303030',
                  animation: 'pulse 1.5s infinite',
                }}
              />
              <div
                style={{
                  width: 60,
                  height: 12,
                  background: '#303030',
                  borderRadius: 4,
                }}
              />
              <div
                style={{
                  width: 40,
                  height: 10,
                  background: '#262626',
                  borderRadius: 4,
                }}
              />
            </div>
            {i < 2 && (
              <div
                style={{
                  width: 60,
                  height: 2,
                  background: '#303030',
                  margin: '0 8px',
                  marginBottom: 28,
                }}
              />
            )}
          </React.Fragment>
        ))}
      </div>
    );
  }

  return null;
};

// 生成中动画组件
export const GeneratingAnimation: React.FC<{ stage?: string }> = ({ stage = '生成中' }) => {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 0',
      }}
    >
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: 'var(--color-ember)',
            animation: `bounce 1.4s infinite ease-in-out`,
            animationDelay: `${i * 0.2}s`,
          }}
        />
      ))}
      <span
        style={{
          color: '#a1a1aa',
          fontSize: 13,
          marginLeft: 8,
        }}
      >
        {stage}
      </span>
      <style>{`
        @keyframes bounce {
          0%, 80%, 100% {
            transform: scale(0.6);
            opacity: 0.4;
          }
          40% {
            transform: scale(1);
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
};
