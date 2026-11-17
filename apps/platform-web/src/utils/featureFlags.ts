/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Half-finished surfaces stay off until the matching roadmap wave closes.
 * Turn on with Vite env: VITE_SHOW_ECOSYSTEM / VITE_SHOW_CUSTOM_DOMAIN /
 * VITE_SHOW_RESEARCH_LAB / VITE_SHOW_STRIPE.
 * World 走向盘 is on unless VITE_SHOW_COURSE_MARKET=false.
 */

function on(name: string): boolean {
  return import.meta.env[name] === 'true';
}

export const featureFlags = {
  /** Plugins, public bench board, developer hub. */
  ecosystem: on('VITE_SHOW_ECOSYSTEM'),
  /** Custom-domain panel (DNS TXT only until real TLS ships). */
  customDomain: on('VITE_SHOW_CUSTOM_DOMAIN'),
  /** LingBot Research Lab — mock /step is not a product path. */
  researchLab: on('VITE_SHOW_RESEARCH_LAB'),
  /** Stripe Checkout UI. English locale also shows Stripe when the API advertises it. */
  stripe: on('VITE_SHOW_STRIPE'),
  /**
   * 走向盘. On for worlds unless ops explicitly sets
   * VITE_SHOW_COURSE_MARKET=false (whole-rail shutdown).
   */
  courseMarket: import.meta.env.VITE_SHOW_COURSE_MARKET !== 'false',
  /**
   * Course UX v2：5 幕进度条 + 谁堵盘 toast + AI 判定说明 + 分彩公式 hover。
   * 旧 3 段进度条始终可用，本 flag 只切展示层；默认关。
   */
  courseUxV2: on('VITE_COURSE_UX_V2'),
  /**
   * 生成页"AI/模板"引擎声明。客户端仅当后端配置注入 VITE_HAS_LLM_KEY=true
   * 才告诉客户是 AI 生成；否则走模板生成。永远默认 false 以避免误报。
   */
  hasLlmKey: on('VITE_HAS_LLM_KEY'),
  /**
   * 演示开放世界：不点亮也能看推演和对话。服务端还要 PLATFORM_DEMO_OPEN_WORLD=1。
   * 默认关，付费点亮逻辑保持原样。
   */
  demoOpenWorld: on('VITE_DEMO_OPEN_WORLD'),
};

export type FeatureFlags = typeof featureFlags;
