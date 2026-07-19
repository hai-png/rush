import { drizzle } from 'drizzle-orm/postgres-js';
import type { PgTransaction } from 'drizzle-orm/pg-core';
import postgres from 'postgres';
import * as schema from './schema';
import { loadEnv } from '@addis/shared';

const env = loadEnv();
// FIX (DATA-008): The previous config `{ max: 20 }` was the ONLY option —
// no SSL, no statement_timeout, no idle_timeout, no prepare flag. Each is
// a production-readiness gap:
//   - SSL: production DB connections to RDS/Cloud SQL must require TLS.
//     postgres-js defaults to no SSL; we now require it in production.
//   - statement_timeout: a slow query (e.g. a missing-index scan per
//     DATA-002) can hold a connection indefinitely. Default Postgres
//     statement_timeout is 0 (unlimited). The pool exhausts, every other
//     request 500s. We now set 10s.
//   - idle_timeout: connections sit forever, even across deploy restarts.
//     RDS will kill them after wait_timeout but the client won't notice
//     until the next query fails. We now set 30s.
//   - max_lifetime: recycle connections before the server-side timeout
//     fires (30 min, well under RDS's 8h default).
//   - prepare: postgres-js uses prepared statements by default. With
//     PgBouncer in transaction mode (common), prepared statements break.
//     We disable prepare so the client is compatible with PgBouncer.
const queryClient = postgres(env.DATABASE_URL, {
  max: env.NODE_ENV === 'production' ? 20 : 5,
  ssl: env.NODE_ENV === 'production' ? 'require' : undefined,
  idle_timeout: 30,           // seconds
  max_lifetime: 60 * 30,      // 30 min
  prepare: false,             // safe with PgBouncer transaction mode
});
export const db = drizzle(queryClient, { schema });

// Set a per-session statement_timeout so slow queries fail fast instead of
// holding a connection indefinitely. This runs once at startup; postgres-js
// applies it to every connection in the pool.
queryClient`SET statement_timeout = '10s'`.catch((err) => {
  // Don't crash startup if the SET fails (e.g. the DB is unreachable —
  // the first real query will surface that error). Log to stderr so
  // operators see the gap.
  console.error('[db] failed to set statement_timeout:', (err as Error).message);
});

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
