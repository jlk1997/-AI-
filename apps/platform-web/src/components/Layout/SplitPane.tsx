/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';

interface SplitPaneProps {
  left: React.ReactNode;
  right: React.ReactNode;
  defaultLeftWidth?: number;
  minLeftWidth?: number;
  maxLeftWidth?: number;
}

export const SplitPane: React.FC<SplitPaneProps> = ({
  left,
  right,
  defaultLeftWidth = 40,
  minLeftWidth = 25,
  maxLeftWidth = 60,
}) => {
  const [leftWidth, setLeftWidth] = useState(defaultLeftWidth);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging || !containerRef.current) return;

      const containerRect = containerRef.current.getBoundingClientRect();
      const newLeftWidth = ((e.clientX - containerRect.left) / containerRect.width) * 100;

      if (newLeftWidth >= minLeftWidth && newLeftWidth <= maxLeftWidth) {
        setLeftWidth(newLeftWidth);
      }
    },
    [isDragging, minLeftWidth, maxLeftWidth]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    } else {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isDragging, handleMouseMove, handleMouseUp]);

  return (
    <div
      ref={containerRef}
      style={{
        display: 'flex',
        height: '100%',
        width: '100%',
        overflow: 'hidden',
      }}
    >
      {/* 左侧面板 */}
      <div
        style={{
          width: `${leftWidth}%`,
          height: '100%',
          overflow: 'hidden',
          flexShrink: 0,
        }}
      >
        {left}
      </div>

      {/* 分割线 */}
      <div
        onMouseDown={handleMouseDown}
        style={{
          width: 6,
          height: '100%',
          cursor: 'col-resize',
          background: isDragging ? 'var(--color-ember)' : 'var(--border-color)',
          transition: isDragging ? 'none' : 'background 0.2s',
          flexShrink: 0,
          position: 'relative',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: 4,
            height: 40,
            borderRadius: 2,
            background: '#a1a1aa',
            opacity: 0.5,
          }}
        />
      </div>

      {/* 右侧面板 */}
      <div
        style={{
          flex: 1,
          height: '100%',
          overflow: 'hidden',
        }}
      >
        {right}
      </div>
    </div>
  );
};
