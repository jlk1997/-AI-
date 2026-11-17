/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Tooltip } from 'antd';
import { CheckCircleFilled } from '@ant-design/icons';
import { themes } from './themes';

interface ThemeSelectorProps {
  value?: string;
  onChange: (themeId: string) => void;
}

export const ThemeSelector: React.FC<ThemeSelectorProps> = ({ value, onChange }) => {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 8,
        justifyContent: 'flex-start',
      }}
    >
      {themes.map((theme) => {
        const isSelected = value === theme.id;

        return (
          <Tooltip
            key={theme.id}
            title={
              <div>
                <div style={{ fontWeight: 600 }}>{theme.name}</div>
                <div style={{ fontSize: 12, opacity: 0.8 }}>
                  {theme.description}
                </div>
              </div>
            }
            placement="top"
          >
            <div
              onClick={() => onChange(theme.id)}
              style={{
                width: 70,
                height: 70,
                borderRadius: 12,
                cursor: 'pointer',
                position: 'relative',
                overflow: 'hidden',
                border: isSelected
                  ? '2px solid var(--color-ember)'
                  : '2px solid transparent',
                transition: 'all 0.2s ease',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                background: theme.colors.background,
                boxShadow: isSelected
                  ? '0 0 20px rgba(99, 102, 241, 0.3)'
                  : 'none',
                transform: isSelected ? 'scale(1.05)' : 'scale(1)',
              }}
            >
              {/* 背景渐变 */}
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: `linear-gradient(135deg, ${theme.colors.primary}40, ${theme.colors.secondary}40)`,
                }}
              />

              {/* 主题图标 */}
              <span style={{ fontSize: 28, position: 'relative', zIndex: 1 }}>
                {theme.preview}
              </span>

              {/* 主题名称 — 中性底保证对比度（避免紫字压紫底） */}
              <span
                style={{
                  fontSize: 10,
                  color: '#fafafa',
                  position: 'relative',
                  zIndex: 1,
                  marginTop: 4,
                  padding: '1px 6px',
                  borderRadius: 4,
                  background: 'rgba(0,0,0,0.55)',
                  lineHeight: 1.3,
                  maxWidth: '90%',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {theme.name}
              </span>

              {/* 选中标记 */}
              {isSelected && (
                <div
                  style={{
                    position: 'absolute',
                    top: 4,
                    right: 4,
                    zIndex: 2,
                  }}
                >
                  <CheckCircleFilled style={{ color: 'var(--color-ember)', fontSize: 16 }} />
                </div>
              )}

              {/* 颜色指示条 */}
              <div
                style={{
                  position: 'absolute',
                  bottom: 0,
                  left: 0,
                  right: 0,
                  height: 3,
                  background: `linear-gradient(90deg, ${theme.colors.primary}, ${theme.colors.secondary})`,
                }}
              />
            </div>
          </Tooltip>
        );
      })}
    </div>
  );
};
