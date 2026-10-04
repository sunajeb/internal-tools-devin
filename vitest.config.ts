import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'tools/**/*.test.ts'],
    testTimeout: 15_000,
  },
});
