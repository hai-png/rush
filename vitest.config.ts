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
    coverage: { provider: 'v8', reporter: ['text', 'lcov'], thresholds: { lines: 80, branches: 80 } },
  },
  resolve: { alias: { '@': path.resolve(__dirname, 'apps/web') } },
});
