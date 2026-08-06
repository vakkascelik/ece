import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * The public site had no test runner at all until 2026-08-07, which is how it came to have a
 * validation bug in a function that goes straight into an `href`.
 *
 * Scoped to `src/`, matching `apps/web` — and with the `@/` alias, because vitest does not read
 * `tsconfig.json` paths and every module here imports that way.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@ece/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
