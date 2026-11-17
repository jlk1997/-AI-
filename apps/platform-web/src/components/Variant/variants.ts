/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

export interface GameVariant {
  id: string;
  name: string;
  description: string;
  icon: string;
  compatibleWith?: string[];
}

export const variants: GameVariant[] = [
  {
    id: 'classic',
    name: '经典模式',
    description: '传统游戏规则，经典玩法体验',
    icon: '🎮',
  },
  {
    id: 'endless',
    name: '无尽模式',
    description: '无限生存挑战，越来越难',
    icon: '♾️',
  },
  {
    id: 'pvp',
    name: '双人对战',
    description: '两个人一起玩，比拼分数',
    icon: '👥',
  },
  {
    id: 'time-attack',
    name: '计时挑战',
    description: '在限定时间内拿到最高分',
    icon: '⏱️',
  },
  {
    id: 'puzzle',
    name: '解谜模式',
    description: '加入障碍和谜题元素',
    icon: '🧩',
  },
  {
    id: 'boss-rush',
    name: 'Boss Rush',
    description: '每关一个 Boss，击败所有 Boss 通关',
    icon: '👹',
  },
];

export const getVariantById = (id: string): GameVariant | undefined => {
  return variants.find((v) => v.id === id);
};

export const getDefaultVariant = (): GameVariant => {
  return variants[0];
};
