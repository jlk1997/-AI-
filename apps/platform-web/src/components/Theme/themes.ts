/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Theme {
  id: string;
  name: string;
  description: string;
  preview: string;
  colors: {
    primary: string;
    secondary: string;
    background: string;
    accent: string;
  };
  cssVariables?: string;
}

export const themes: Theme[] = [
  {
    id: 'cyberpunk',
    name: '赛博朋克',
    description: '霓虹灯光、黑暗背景、故障效果',
    preview: '🌃',
    colors: {
      primary: '#00fff9',
      secondary: '#ff00ff',
      background: '#0a0a0f',
      accent: '#ffff00',
    },
    cssVariables: `
      --game-bg: #0a0a0f;
      --game-primary: #00fff9;
      --game-secondary: #ff00ff;
      --game-accent: #ffff00;
    `,
  },
  {
    id: 'pixel',
    name: '像素复古',
    description: '8-bit 像素艺术、CRT 扫描线',
    preview: '👾',
    colors: {
      primary: '#4ade80',
      secondary: '#22c55e',
      background: '#1a1a2e',
      accent: '#fbbf24',
    },
    cssVariables: `
      --game-bg: #1a1a2e;
      --game-primary: #4ade80;
      --game-secondary: #22c55e;
      --game-accent: #fbbf24;
    `,
  },
  {
    id: 'neon',
    name: '霓虹炫彩',
    description: '发光效果、鲜艳色彩、赛博风格',
    preview: '✨',
    colors: {
      primary: '#f472b6',
      secondary: '#a855f7',
      background: '#1f1035',
      accent: '#22d3ee',
    },
    cssVariables: `
      --game-bg: #1f1035;
      --game-primary: #f472b6;
      --game-secondary: #a855f7;
      --game-accent: #22d3ee;
    `,
  },
  {
    id: 'minimal',
    name: '极简主义',
    description: '扁平设计、纯色背景、简约线条',
    preview: '⬜',
    colors: {
      primary: '#374151',
      secondary: '#6b7280',
      background: '#f9fafb',
      accent: '#3b82f6',
    },
    cssVariables: `
      --game-bg: #f9fafb;
      --game-primary: #374151;
      --game-secondary: #6b7280;
      --game-accent: #3b82f6;
    `,
  },
  {
    id: 'nature',
    name: '自然森系',
    description: '绿色调、树叶纹理、自然氛围',
    preview: '🌿',
    colors: {
      primary: '#22c55e',
      secondary: '#16a34a',
      background: '#042f2e',
      accent: '#fbbf24',
    },
    cssVariables: `
      --game-bg: #042f2e;
      --game-primary: #22c55e;
      --game-secondary: #16a34a;
      --game-accent: #fbbf24;
    `,
  },
  {
    id: 'space',
    name: '太空科幻',
    description: '星空背景、粒子效果、宇宙感',
    preview: '🚀',
    colors: {
      primary: '#818cf8',
      secondary: '#6366f1',
      background: '#0f0d1a',
      accent: '#f472b6',
    },
    cssVariables: `
      --game-bg: #0f0d1a;
      --game-primary: #818cf8;
      --game-secondary: #6366f1;
      --game-accent: #f472b6;
    `,
  },
  {
    id: 'retro',
    name: '复古街机',
    description: '经典 arcade 风格、怀旧游戏机',
    preview: '🕹️',
    colors: {
      primary: '#ef4444',
      secondary: '#dc2626',
      background: '#1c1917',
      accent: '#fbbf24',
    },
    cssVariables: `
      --game-bg: #1c1917;
      --game-primary: #ef4444;
      --game-secondary: #dc2626;
      --game-accent: #fbbf24;
    `,
  },
  {
    id: 'fantasy',
    name: '奇幻魔法',
    description: '魔法效果、神秘色调、史诗感',
    preview: '🔮',
    colors: {
      primary: '#8b5cf6',
      secondary: '#7c3aed',
      background: '#1e1b4b',
      accent: '#fcd34d',
    },
    cssVariables: `
      --game-bg: #1e1b4b;
      --game-primary: #8b5cf6;
      --game-secondary: #7c3aed;
      --game-accent: #fcd34d;
    `,
  },
];

export const getThemeById = (id: string): Theme | undefined => {
  return themes.find((theme) => theme.id === id);
};

export const getDefaultTheme = (): Theme => {
  return themes[0];
};
