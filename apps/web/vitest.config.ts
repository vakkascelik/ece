import { defineConfig } from 'vitest/config';

/**
 * Scope vitest to src/. Without this it also collects e2e/*.spec.ts, which are
 * Playwright tests — they throw at import time under vitest and `npm test` in
 * this workspace fails on every run. Playwright has its own config and its own
 * command (`npm run test:e2e`).
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
