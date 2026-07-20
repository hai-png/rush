import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/*.integration.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    pool: 'forks',
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
