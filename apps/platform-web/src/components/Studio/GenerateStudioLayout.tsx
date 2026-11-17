/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Mode-first shell for Generate: left creation rail + right primary stage.
 * Tools live in a drawer (not permanent stage chrome).
 */

import React from 'react';
import type { GenerationMode } from '../World/worldTemplates';

export interface GenerateStudioLayoutProps {
  readonly mode: GenerationMode;
  readonly left: React.ReactNode;
  readonly stage: React.ReactNode;
  readonly className?: string;
  readonly style?: React.CSSProperties;
}

/**
 * Visual skin wrapper — Game = creative canvas; World = observatory dashboard.
 * SplitPane still lives in GeneratePage; this marks mode on the body column.
 */
export const GenerateStudioLayout: React.FC<GenerateStudioLayoutProps> = ({
  mode,
  left,
  stage,
  className,
  style,
}) => {
  return (
    <div
      className={className}
      data-studio-mode={mode}
      style={{
        display: 'contents',
        ...style,
      }}
    >
      {left}
      {stage}
    </div>
  );
};
