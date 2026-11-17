/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Things that happen because the world is not a schedule: weather, prices,
 * illness, rumors, a drill offshore, a road washout.
 */

import type { ConflictCell } from './conflict.js';

export type FateKind =
  | 'weather'
  | 'price'
  | 'job'
  | 'illness'
  | 'news'
  | 'accident'
  | 'festival'
  | 'disaster'
  | 'shortage'
  | 'military'
  | 'rumor';

export type FateEvent = {
  readonly kind: FateKind;
  readonly text: string;
  readonly regionId?: string;
  readonly grievanceDelta?: number;
  readonly priceKey?: string;
  readonly price?: number;
  readonly rumor?: number;
};

export function rollFate(input: {
  readonly simHour: number;
  readonly economy: number;
  readonly tension: number;
  readonly cell?: ConflictCell;
  readonly rng: () => number;
}): FateEvent | null {
  const { rng } = input;
  const tense = input.tension > 0.5;
  const poor = input.economy < 0.4;
  const roll = rng();
  const p = 0.04 + (poor ? 0.03 : 0) + (tense ? 0.04 : 0);
  if (roll > p) return null;
  const kindRoll = rng();
  if (kindRoll < 0.12) {
    return { kind: 'weather', text: rng() < 0.5 ? '下雨，街上人少了' : '天热，人容易燥' };
  }
  if (kindRoll < 0.28) {
    return {
      kind: 'price',
      text: poor ? '菜价又涨了一截' : '市场价略动',
      grievanceDelta: poor ? 0.04 : 0.01,
      priceKey: 'food',
      price: poor ? 1.3 : 1.05,
    };
  }
  if (kindRoll < 0.38) {
    return { kind: 'job', text: poor ? '有人这周没班了' : '铺子在招短工', grievanceDelta: poor ? 0.03 : -0.01 };
  }
  if (kindRoll < 0.48) return { kind: 'illness', text: '卫生院说肠胃的人多了' };
  if (kindRoll < 0.6) {
    return {
      kind: 'rumor',
      text: tense ? '网上一段视频对不上官方的说法' : '茶馆里多了一条说不清的消息',
      rumor: tense ? 0.35 : 0.1,
    };
  }
  if (kindRoll < 0.7) return { kind: 'news', text: '镇外传来一件跟这里有关的事' };
  if (kindRoll < 0.8) return { kind: 'accident', text: '路口擦了一下车，人围了过来' };
  if (kindRoll < 0.86) return { kind: 'festival', text: '今天有人办席，街上比平时热闹' };
  if (kindRoll < 0.92) {
    return { kind: 'disaster', text: '河水上来了，低处的路不好走', grievanceDelta: 0.02 };
  }
  if (kindRoll < 0.96) return { kind: 'shortage', text: '药店说常用药断了一阵', grievanceDelta: 0.03 };
  return {
    kind: 'military',
    text: '远处有演训的动静',
    rumor: 0.15,
  };
}
