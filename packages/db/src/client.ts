import { drizzle } from 'drizzle-orm/postgres-js';
import type { PgTransaction } from 'drizzle-orm/pg-core';
import postgres from 'postgres';
import * as schema from './schema';
import { loadEnv } from '@addis/shared';

const env = loadEnv();

const queryClient = postgres(env.DATABASE_URL, {
  max: env.NODE_ENV === 'production' ? 20 : 5,
  ssl: env.NODE_ENV === 'production' ? 'require' : undefined,
  idle_timeout: 30,
  max_lifetime: 60 * 30,
  prepare: false,
});
export const db = drizzle(queryClient, { schema });

queryClient`SET statement_timeout = '10s'`.catch((err) => {

  console.error('[db] failed to set statement_timeout:', (err as Error).message);
});

export type Db = typeof db;
export type DbOrTx = Db | PgTransaction<any, any, any>;
export * as schema from './schema';
