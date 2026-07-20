import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    exclude: ['**/*.integration.test.ts', '**/node_modules/**'],
    setupFiles: [resolve(__dirname, 'vitest.setup.ts')],

    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      thresholds: { lines: 80, branches: 80 },
      exclude: ['**/*.test.ts', '**/*.integration.test.ts', 'src/index.ts', 'vitest.setup.ts', 'vitest.config.ts'],
    },
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
