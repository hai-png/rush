import { defineConfig } from '@playwright/test';

/**
 * FIX (TEST-011): The previous config had no globalSetup — the e2e tests
 * depended on pre-existing demo users (`922555999` / `demo12345`) that
 * don't exist on a fresh DB. Running the suite twice in a row failed the
 * second run because the demo users already had active subscriptions from
 * the first run.
 *
 * The new config wires globalSetup (seeds the e2e DB with deterministic
 * test users) and globalTeardown (truncates the e2e schema). It also
 * enables screenshots-on-failure and retain-on-failure video for easier
 * flakiness debugging.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  globalSetup: require.resolve('./e2e/global-setup.ts'),
  globalTeardown: require.resolve('./e2e/global-teardown.ts'),
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: { command: 'bun run --cwd apps/web start', url: 'http://localhost:3000', reuseExistingServer: !process.env.CI },
});
