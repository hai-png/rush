import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',

    setupFiles: [path.resolve(__dirname, 'vitest.setup.ts')],

    exclude: ['**/*.integration.test.ts', '**/node_modules/**'],
    coverage: { provider: 'v8', reporter: ['text', 'lcov'], thresholds: { lines: 80, branches: 80 } },
  },
  resolve: { alias: { '@': path.resolve(__dirname, 'apps/web') } },
});
