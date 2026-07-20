import postgres from 'postgres';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/addisride_test';
const E2E_RUN_ID = process.env.E2E_RUN_ID ?? '';

export default async function globalTeardown() {
  if (!E2E_RUN_ID) return;
  const client = postgres(DATABASE_URL);
  const suffix = E2E_RUN_ID.replace(/[^a-z0-9]/gi, '').slice(-6).padEnd(6, '0');
  const riderPhone = `+251911000${suffix}`;
  const rider2Phone = `+251911001${suffix}`;

  await client`DELETE FROM users WHERE phone IN (${riderPhone}, ${rider2Phone})`;
  await client.end();
}
