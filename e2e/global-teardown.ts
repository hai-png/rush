/**
 * FIX (TEST-011): Global teardown for Playwright e2e tests.
 *
 * Truncates the e2e test users (and their dependent rows via cascade) so the
 * next run starts clean. Without this, the second run fails because the e2e
 * rider already has an active subscription from the first run.
 */
import postgres from 'postgres';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/addisride_test';
const E2E_RUN_ID = process.env.E2E_RUN_ID ?? '';

export default async function globalTeardown() {
  if (!E2E_RUN_ID) return; // nothing to clean up
  const client = postgres(DATABASE_URL);
  const suffix = E2E_RUN_ID.replace(/[^a-z0-9]/gi, '').slice(-6).padEnd(6, '0');
  const riderPhone = `+251911000${suffix}`;
  const rider2Phone = `+251911001${suffix}`;
  // Delete the e2e users. ON DELETE CASCADE on rider_profiles / sessions /
  // subscriptions / etc. cleans up the dependent rows automatically.
  await client`DELETE FROM users WHERE phone IN (${riderPhone}, ${rider2Phone})`;
  await client.end();
}
