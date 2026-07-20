import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    // FIX (TEST-013): setupFiles path was './vitest.setup.ts' which resolves
    // relative to each package's directory when turbo runs `vitest run` from
    // there. Point at the root-level file explicitly so every package picks
    // up the same jsdom setup (matchMedia stub, RTL cleanup).
    setupFiles: [path.resolve(__dirname, 'vitest.setup.ts')],
    // Mirror the per-package exclude (packages/api/vitest.config.ts) so the
    // integration tests — which need a live Postgres via testcontainers —
    // aren't picked up when vitest is launched from the repo root with the
    // root config. They have their own config (vitest.integration.config.ts).
    exclude: ['**/*.integration.test.ts', '**/node_modules/**'],
    coverage: { provider: 'v8', reporter: ['text', 'lcov'], thresholds: { lines: 80, branches: 80 } },
  },
  resolve: { alias: { '@': path.resolve(__dirname, 'apps/web') } },
});
