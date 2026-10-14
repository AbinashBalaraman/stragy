import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/test/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
    testTimeout: 15_000,
    maxWorkers: 2,
    coverage: { provider: 'v8', reporter: ['text', 'json-summary'], include: ['src/server/backtest/**', 'src/shared/strategy/**'], thresholds: { statements: 60, branches: 50 } },
  },
});
