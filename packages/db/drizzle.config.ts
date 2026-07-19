import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle Kit configuration. Run `bun run db:generate` from the repo root to generate
 * SQL migrations from packages/db/src/schema.ts into packages/db/migrations/.
 * Run `bun run db:migrate` to apply them.
 *
 * The DATABASE_URL is validated by packages/shared/src/env.ts at boot time, so we
 * read it directly here without further validation.
 */
export default defineConfig({
  schema: './src/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  strict: true,
  verbose: true,
});
