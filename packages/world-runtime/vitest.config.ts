import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // `tests/` covers the Phaser scaffold's pure helpers. They cannot live next
    // to the scaffold source: it is copied verbatim into generated worlds, which
    // have no test runner.
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
  },
});
