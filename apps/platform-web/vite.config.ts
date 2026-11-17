import react from '@vitejs/plugin-react';
import { defineConfig, type PluginOption } from 'vite';

import { shareOgPlugin } from './src/vite-plugins/shareOg.js';

export default defineConfig({
  envDir: '../..',
  plugins: [react() as PluginOption, shareOgPlugin() as PluginOption],
  server: {
    port: 5174,
    watch: {
      // Vite full-reloads the SPA when tsconfig.json mtime changes (Cursor /
      // tsserver / tsc -b often touch it). That drops the generate view even
      // though the worker is still running.
      ignored: [
        '**/tsconfig.json',
        '**/tsconfig.*.json',
        '**/*.tsbuildinfo',
      ],
      awaitWriteFinish: {
        stabilityThreshold: 300,
        pollInterval: 80,
      },
    },
    proxy: {
      '/v1': {
        target: 'http://127.0.0.1:3847',
        changeOrigin: true,
        /** Long-lived SSE must not time out / buffer — otherwise EventSource reconnects in a tight loop. */
        timeout: 0,
        proxyTimeout: 0,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            if ((req.url ?? '').includes('/events')) {
              proxyReq.setTimeout(0);
            }
          });
          proxy.on('proxyRes', (proxyRes, req, res) => {
            const url = req.url ?? '';
            if (url.includes('/events')) {
              proxyRes.headers['x-accel-buffering'] = 'no';
              res.setHeader('X-Accel-Buffering', 'no');
              // Prevent Node from timing out idle SSE sockets in dev.
              res.setTimeout(0);
            }
          });
        },
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // 将 React 相关库分离到 vendor chunk
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          // 将 Ant Design 分离到单独 chunk
          'vendor-antd': ['antd', '@ant-design/icons'],
          // 将状态管理分离
          'vendor-state': ['zustand'],
          // 将工具库分离
          'vendor-utils': ['axios'],
        },
      },
    },
    // 警告阈值
    chunkSizeWarningLimit: 600,
  },
});
