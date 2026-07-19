import { drizzle } from 'drizzle-orm/postgres-js';
import type { PgTransaction } from 'drizzle-orm/pg-core';
import postgres from 'postgres';
import * as schema from './schema';
import { loadEnv } from '@addis/shared';

const env = loadEnv();
const queryClient = postgres(env.DATABASE_URL, { max: env.NODE_ENV === 'production' ? 20 : 5 });
export const db = drizzle(queryClient, { schema });

/**
 * `typeof db` is the top-level PostgresJsDatabase. Inside a `db.transaction(async (tx) => ...)`,
 * `tx` is a `PgTransaction` — a different (but compatible) type. Functions that accept
 * either (e.g. repository methods with a `tx = db` default parameter) should use
 * `DbOrTx` so both call shapes type-check.
 *
 * Under `exactOptionalPropertyTypes: true`, Drizzle's PgTransaction and PostgresJsDatabase
 * types don't perfectly unify (the `$client` property is present on one but not the
 * other). The union here is the documented workaround.
 */
export type Db = typeof db;
export type DbOrTx = Db | PgTransaction<any, any, any>;
export * as schema from './schema';
