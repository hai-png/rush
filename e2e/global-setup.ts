import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import * as schema from '../packages/db/src/schema';
import { hashPassword } from '../packages/shared/src/password';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/addisride_test';
const E2E_RUN_ID = process.env.E2E_RUN_ID ?? `e2e-${Date.now()}`;

export default async function globalSetup() {
  const client = postgres(DATABASE_URL);
  const db = drizzle(client, { schema });

  await migrate(db, { migrationsFolder: './packages/db/migrations' });

  const suffix = E2E_RUN_ID.replace(/[^a-z0-9]/gi, '').slice(-6).padEnd(6, '0');
  const riderPhone = `+251911000${suffix}`;
  const rider2Phone = `+251911001${suffix}`;
  const password = 'e2e-test-password-strong!!';

  await db.delete(schema.users).where(
    client`phone IN (${riderPhone}, ${rider2Phone})`
  ).catch(() => {});

  const [rider] = await db.insert(schema.users).values({
    phone: riderPhone,
    name: 'E2E Rider',
    passwordHash: await hashPassword(password),
    role: 'rider',
    phoneVerified: true,
    isActive: true,
  }).returning();
  const [riderProfile] = await db.insert(schema.riderProfiles).values({
    userId: rider.id,
    homeArea: 'Bole',
    workArea: 'Merkato',
  }).returning();

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
  }).returning();

  const [route] = await db.insert(schema.routes).values({
    name: `E2E Route ${suffix}`,
    origin: 'Bole',
    destination: 'Merkato',
    distanceKm: 12.5,
    durationMin: 35,
    originLatLng: [9.0, 38.7],
    destLatLng: [9.03, 38.75],
    morningWindow: { start: '06:30', end: '09:00' },
    eveningWindow: { start: '16:30', end: '19:30' },
    fare: '60.00',
  }).onConflictDoNothing().returning();
  const routeRow = route ?? (await db.select().from(schema.routes).where(eq(schema.routes.name, `E2E Route ${suffix}`)).limit(1))[0];

  const [plan] = await db.insert(schema.subscriptionPlans).values({
    name: `E2E Monthly ${suffix}`,
    durationDays: 30,
    ridesIncluded: -1,
    priceETB: '1200.00',
    description: 'E2E test plan.',
    isPopular: true,
  }).onConflictDoNothing().returning();
  const planRow = plan ?? (await db.select().from(schema.subscriptionPlans).where(eq(schema.subscriptionPlans.name, `E2E Monthly ${suffix}`)).limit(1))[0];

  const startDate = new Date();
  const endDate = new Date(Date.now() + 30 * 86400_000);
  await db.insert(schema.subscriptions).values({
    riderId: riderProfile.id,
    planId: planRow.id,
    routeId: routeRow.id,
    status: 'active',
    ridesUsed: 0,
    startDate,
    endDate,
  }).returning();

  process.env.E2E_RIDER_PHONE = riderPhone;
  process.env.E2E_RIDER2_PHONE = rider2Phone;
  process.env.E2E_PASSWORD = password;
  process.env.E2E_RUN_ID = E2E_RUN_ID;

  await client.end();
}
