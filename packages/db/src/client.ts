import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { loadEnv } from '@addis/shared';

const env = loadEnv();
const queryClient = postgres(env.DATABASE_URL, { max: env.NODE_ENV === 'production' ? 20 : 5 });
export const db = drizzle(queryClient, { schema });
export type Db = typeof db;
export * as schema from './schema';
