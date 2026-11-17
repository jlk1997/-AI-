import { defineConfig } from 'vite';

// Relative base + phaser dedupe: required for /v1/preview-dist nested URLs and
// to keep Phaser.Scene keys from collapsing to "default".
export default defineConfig({
  base: './',
  resolve: {
    dedupe: ['phaser'],
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 2000,
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
});
