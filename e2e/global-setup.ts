/**
 * FIX (TEST-011): Global setup for Playwright e2e tests.
 *
 * The previous e2e suite had no setup — it depended on pre-existing demo
 * users (922555999, 911222333 with password demo12345) that don't exist on
 * a fresh DB. Running the suite twice failed the second run because the
 * demo users already had active subscriptions from the first run.
 *
 * This globalSetup:
 *   1. Runs the DB migration (idempotent).
 *   2. Seeds deterministic e2e test users with unique phone numbers
 *      (keyed by E2E_RUN_ID env var, defaulting to a timestamp) so
 *      parallel CI runs don't collide.
 *   3. Stores the test user credentials in process.env so the e2e tests
 *      can read them via `process.env.E2E_RIDER_PHONE` etc.
 */
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../packages/db/src/schema';
import { hashPassword } from '../packages/shared/src/password';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/addisride_test';
const E2E_RUN_ID = process.env.E2E_RUN_ID ?? `e2e-${Date.now()}`;

export default async function globalSetup() {
  const client = postgres(DATABASE_URL);
  const db = drizzle(client, { schema });

  // Run migrations (idempotent — safe to run on an existing DB).
  await migrate(db, { migrationsFolder: './packages/db/migrations' });

  // Seed deterministic e2e users. Phone numbers are keyed by E2E_RUN_ID so
  // parallel CI runs (each with a unique E2E_RUN_ID) don't collide. The
  // suffix is padded to keep the phone format valid (+2519XXXXXXXX, 9 digits
  // after +251).
  const suffix = E2E_RUN_ID.replace(/[^a-z0-9]/gi, '').slice(-6).padEnd(6, '0');
  const riderPhone = `+251911000${suffix}`;
  const rider2Phone = `+251911001${suffix}`;
  const password = 'e2e-test-password-strong!!';

  // Clean up any prior e2e users with the same phones (from a previous run
  // that didn't teardown). This makes the setup idempotent.
  await db.delete(schema.users).where(
    // drizzle-orm doesn't have an `in` operator on the column directly here;
    // use raw SQL for the cleanup.
    client`phone IN (${riderPhone}, ${rider2Phone})`
  ).catch(() => {}); // best-effort — if the users don't exist, the delete is a no-op

  // Seed the e2e rider.
  const [rider] = await db.insert(schema.users).values({
    phone: riderPhone,
    name: 'E2E Rider',
    passwordHash: await hashPassword(password),
    role: 'rider',
    phoneVerified: true,
    isActive: true,
  }).returning();
  await db.insert(schema.riderProfiles).values({
    userId: rider.id,
    homeArea: 'Bole',
    workArea: 'Merkato',
  });

  // Seed a second rider (for seat-claim tests).
  const [rider2] = await db.insert(schema.users).values({
    phone: rider2Phone,
    name: 'E2E Rider 2',
    passwordHash: await hashPassword(password),
    role: 'rider',
    phoneVerified: true,
    isActive: true,
  }).returning();
  await db.insert(schema.riderProfiles).values({
    userId: rider2.id,
    homeArea: 'CMC',
    workArea: 'Piazza',
  });

  // Expose the e2e credentials to the test files via process.env.
  process.env.E2E_RIDER_PHONE = riderPhone;
  process.env.E2E_RIDER2_PHONE = rider2Phone;
  process.env.E2E_PASSWORD = password;
  process.env.E2E_RUN_ID = E2E_RUN_ID;

  await client.end();
}
