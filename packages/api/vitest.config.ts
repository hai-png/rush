/**
 * FIX (TEST-013): The root vitest.config.ts has no exclude pattern, so when
 * `bun run test` runs from packages/api, vitest walks up to find the root
 * config and uses it. The root config has environment: 'jsdom' and no
 * exclude — so packages/api/modules/payment/service.integration.test.ts
 * gets picked up under the wrong config (jsdom, 5s timeout, threads pool)
 * and either times out or crashes the worker.
 *
 * This per-package config:
 *   1. Excludes integration tests (they have their own config).
 *   2. Uses environment: 'node' (the API has no DOM dependencies).
 *   3. Sets stub env vars via a setup file so loadEnv() doesn't throw
 *      when the API modules are imported.
 */
import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    exclude: ['**/*.integration.test.ts', '**/node_modules/**'],
    setupFiles: [resolve(__dirname, 'vitest.setup.ts')],
  },
  resolve: {
    alias: {
      '@addis/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
      '@addis/db': resolve(__dirname, '../../packages/db/src/index.ts'),
      '@addis/api': resolve(__dirname, 'src/index.ts'),
      '@addis/payments': resolve(__dirname, '../../services/payments/index.ts'),
      '@addis/sms': resolve(__dirname, '../../services/sms/index.ts'),
      '@addis/email': resolve(__dirname, '../../services/email/index.ts'),
    },
  },
});
