import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

/**
 * Integration test config. Uses a longer test timeout (60s) for testcontainer
 * startup, and resolves @addis/* workspace imports via the repo's tsconfig
 * paths.
 *
 * The default vitest.config.ts runs unit tests (mocked DB); this config runs
 * integration tests against a real Postgres testcontainer.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/*.integration.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    pool: 'forks', // testcontainers needs fork pool (not threads)
  },
  resolve: {
    alias: {
      '@addis/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
      '@addis/db': resolve(__dirname, '../../packages/db/src/index.ts'),
      '@addis/api': resolve(__dirname, '../src/index.ts'),
      '@addis/payments': resolve(__dirname, '../../services/payments/index.ts'),
      '@addis/sms': resolve(__dirname, '../../services/sms/index.ts'),
    },
  },
});
