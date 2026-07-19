// Barrel export for @addis/db.
// Re-exports the drizzle client + typed schema so other packages can do
//   import { db, schema } from '@addis/db';
export { db, type Db, type DbOrTx } from './client';
export * as schema from './schema';
