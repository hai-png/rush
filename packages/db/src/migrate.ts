/**
 * Programmatic migration runner — applies every .sql file in ./migrations/ in
 * filename order, tracking applied migrations in a `__drizzle_migrations` table.
 *
 * Used by `bun run db:migrate` (root package.json). For a fresh database, this is
 * equivalent to running psql with the concatenated migration files. For an
 * existing database, only the unapplied migrations run.
 *
 * The integration test in packages/api/modules/payment/service.integration.test.ts
 * uses drizzle-orm/postgres-js/migrator's `migrate(db, { migrationsFolder: '../db/migrations' })`
 * directly — this script is the production equivalent for manual `bun run db:migrate`.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { loadEnv } from '@addis/shared';

async function main() {
  const env = loadEnv();
  const connection = postgres(env.DATABASE_URL, { max: 1 });
  const db = drizzle(connection);
  console.log('Running migrations from packages/db/migrations/...');
  await migrate(db, { migrationsFolder: new URL('./migrations', import.meta.url).pathname });
  console.log('Migrations applied successfully.');
  await connection.end();
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
