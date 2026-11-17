/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ThemeConfig } from 'antd';

const fontFamily =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif';

export const lightTheme: ThemeConfig = {
  token: {
    colorPrimary: '#c45c26',
    colorSuccess: '#3d8b5a',
    colorWarning: '#e0b25a',
    colorError: '#c23b2e',
    colorInfo: '#2a9d8f',
    colorTextBase: '#1c1917',
    colorBgBase: '#f4eee4',
    borderRadius: 12,
    fontFamily,
    fontSize: 14,
    lineHeight: 1.5,
    wireframe: false,
  },
  components: {
    Card: {
      borderRadiusLG: 16,
      paddingLG: 20,
      colorBgContainer: '#fffaf3',
    },
    Button: {
      borderRadius: 12,
      controlHeight: 40,
    },
    Input: {
      borderRadius: 12,
      controlHeight: 40,
    },
    Modal: {
      borderRadiusLG: 16,
    },
    Segmented: {
      borderRadius: 12,
    },
  },
};

export const darkTheme: ThemeConfig = {
  token: {
    colorPrimary: '#e07a3d',
    colorSuccess: '#5aa872',
    colorWarning: '#e8c27a',
    colorError: '#e05a4f',
    colorInfo: '#3dbeb0',
    colorTextBase: '#f4eee4',
    colorBgBase: '#14121a',
    colorBgContainer: '#1c1917',
    colorBgElevated: '#221c18',
    colorBorder: '#3a3228',
    colorTextSecondary: '#b8aea0',
    borderRadius: 12,
    fontFamily,
    fontSize: 14,
    lineHeight: 1.5,
    wireframe: false,
  },
  components: {
    Layout: {
      headerBg: '#14121a',
      bodyBg: '#14121a',
      siderBg: '#121014',
    },
    Card: {
      borderRadiusLG: 16,
      paddingLG: 20,
      colorBgContainer: '#1c1917',
    },
    Button: {
      borderRadius: 12,
      controlHeight: 40,
    },
    Input: {
      borderRadius: 12,
      controlHeight: 40,
      colorBgContainer: '#221c18',
    },
    Modal: {
      borderRadiusLG: 16,
      colorBgElevated: '#1c1917',
    },
    Drawer: {
      colorBgElevated: '#1c1917',
    },
    Message: {
      contentBg: '#1c1917',
    },
    Statistic: {
      colorTextDescription: '#b8aea0',
    },
    Empty: {
      colorTextDescription: '#b8aea0',
    },
    Alert: {
      colorInfoBg: '#221c18',
      colorInfoBorder: '#3a3228',
    },
  },
};

export const cssVariables = {
  light: {
    '--color-primary': '#c45c26',
    '--color-success': '#3d8b5a',
    '--color-warning': '#e0b25a',
    '--color-error': '#c23b2e',
    '--bg-layout': '#f4eee4',
    '--bg-body': '#f4eee4',
    '--bg-card': '#fffaf3',
    '--bg-sidebar': '#efe7d8',
    '--bg-header': 'rgba(255, 250, 243, 0.92)',
    '--text-primary': '#1c1917',
    '--text-secondary': '#5c5348',
    '--text-inverse': '#fffaf3',
    '--border-color': '#d9cbb6',
    '--color-ember': '#c45c26',
    '--color-teal': '#2a9d8f',
    '--color-gold': '#e0b25a',
    '--color-night': '#14121a',
    '--bg-elevated': '#fffaf3',
    '--color-ember-deep': '#9a4318',
    '--bg-lane': '#eadfcb',
  },
  dark: {
    '--color-primary': '#e07a3d',
    '--color-success': '#5aa872',
    '--color-warning': '#e8c27a',
    '--color-error': '#e05a4f',
    '--bg-layout': '#14121a',
    '--bg-body': '#14121a',
    '--bg-card': '#1c1917',
    '--bg-sidebar': '#121014',
    '--bg-header': 'rgba(20, 18, 26, 0.92)',
    '--bg-elevated': '#221c18',
    '--text-primary': '#f4eee4',
    '--text-secondary': '#b8aea0',
    '--text-inverse': '#14121a',
    '--border-color': '#3a3228',
    '--color-ember': '#e07a3d',
    '--color-ember-deep': '#c45c26',
    '--color-teal': '#3dbeb0',
    '--color-gold': '#e8c27a',
    '--color-night': '#14121a',
    '--bg-lane': '#221c18',
  },
};
