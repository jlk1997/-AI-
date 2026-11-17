/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useCallback } from 'react';

interface Shortcut {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  action: () => void;
  description: string;
}

interface UseKeyboardShortcutsOptions {
  shortcuts: Shortcut[];
  enabled?: boolean;
}

export function useKeyboardShortcuts({
  shortcuts,
  enabled = true,
}: UseKeyboardShortcutsOptions): void {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // 忽略在输入框中的按键
      const target = event.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        // 允许 Escape 键在任何地方生效
        if (event.key !== 'Escape') {
          return;
        }
      }

      for (const shortcut of shortcuts) {
        const keyMatches = event.key.toLowerCase() === shortcut.key.toLowerCase();
        const ctrlMatches = shortcut.ctrl ? event.ctrlKey : !event.ctrlKey;
        const shiftMatches = shortcut.shift ? event.shiftKey : !event.shiftKey;
        const altMatches = shortcut.alt ? event.altKey : !event.altKey;

        if (keyMatches && ctrlMatches && shiftMatches && altMatches) {
          event.preventDefault();
          shortcut.action();
          break;
        }
      }
    },
    [shortcuts]
  );

  useEffect(() => {
    if (!enabled) return;

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled, handleKeyDown]);
}

// 快捷键提示组件
export const ShortcutHint: React.FC<{ shortcuts: Shortcut[] }> = ({ shortcuts }) => {
  const formatShortcut = (shortcut: Shortcut) => {
    const parts: string[] = [];
    if (shortcut.ctrl) parts.push('Ctrl');
    if (shortcut.shift) parts.push('Shift');
    if (shortcut.alt) parts.push('Alt');
    parts.push(shortcut.key.toUpperCase());
    return parts.join(' + ');
  };

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 16,
        right: 16,
        background: '#1a1a1a',
        border: '1px solid #303030',
        borderRadius: 8,
        padding: 12,
        fontSize: 12,
        zIndex: 1000,
        maxWidth: 200,
      }}
    >
      <div
        style={{
          color: '#a1a1aa',
          marginBottom: 8,
          fontWeight: 600,
        }}
      >
        快捷键
      </div>
      {shortcuts.map((shortcut, index) => (
        <div
          key={index}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginBottom: 4,
            color: '#e4e4e7',
          }}
        >
          <span>{shortcut.description}</span>
          <code
            style={{
              background: '#262626',
              padding: '2px 6px',
              borderRadius: 4,
              fontSize: 11,
            }}
          >
            {formatShortcut(shortcut)}
          </code>
        </div>
      ))}
    </div>
  );
};
