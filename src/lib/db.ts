import { PrismaClient } from '@prisma/client'
import { logger } from '@/lib/logger'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  __prismaPragmasInitialized: boolean | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  })

// C-14 fix: warn when running SQLite in production. The deployment target is
// Postgres — SQLite is only suitable for local dev. In production, use
// DATABASE_PROVIDER=postgres and schema.postgres.prisma (selected via
// scripts/select-schema.sh). Connection pooling (PgBouncer) is required for
// multi-instance deployments.
async function checkProductionDb(): Promise<void> {
  if (process.env.NODE_ENV !== 'production') return;
  const url = process.env.DATABASE_URL ?? '';
  if (url.startsWith('file:')) {
    logger.warn('[db] Running SQLite in production! Use Postgres + DATABASE_PROVIDER=postgres for production. ' +
      'Set DATABASE_URL to a postgresql:// connection string and re-run scripts/select-schema.sh.');
  } else if (!url.startsWith('postgresql://') && !url.startsWith('postgres://')) {
    logger.warn(`[db] Unrecognized DATABASE_URL scheme: ${url.split(':')[0]}:// — expected postgresql://`);
  }
  // Remind about connection pooling for Postgres.
  if (url.startsWith('postgresql://') || url.startsWith('postgres://')) {
    if (!process.env.DATABASE_POOL_URL) {
      logger.info('[db] Postgres detected. For multi-instance deployments, set DATABASE_POOL_URL (PgBouncer) ' +
        'and configure the pooler connection string for Prisma.');
    }
  }
}

// Apply SQLite performance/safety PRAGMAs once per process.
// WAL mode allows concurrent readers during writes (critical for any real load).
// busy_timeout makes writers wait up to 5s instead of failing immediately with SQLITE_BUSY.
// synchronous=NORMAL is the recommended companion to WAL (safe, faster than FULL).
// foreign_keys=ON is required for Prisma's onDelete semantics to work on SQLite.
// Skip for non-SQLite databases (e.g. Postgres in production) — the pragmas are no-ops there
// but we avoid the round-trip entirely.
async function applySqlitePragmas(): Promise<void> {
  if (globalForPrisma.__prismaPragmasInitialized) return
  globalForPrisma.__prismaPragmasInitialized = true

  const url = process.env.DATABASE_URL ?? ''
  if (!url.startsWith('file:')) return // Postgres or other — skip

  try {
    // Use $queryRaw for PRAGMAs — some (e.g. journal_mode) return result rows,
    // which $executeRaw rejects on SQLite.
    await db.$queryRaw`PRAGMA journal_mode=WAL`
    await db.$queryRaw`PRAGMA busy_timeout=5000`
    await db.$queryRaw`PRAGMA synchronous=NORMAL`
    await db.$queryRaw`PRAGMA foreign_keys=ON`
    logger.info('[db] SQLite PRAGMAs applied: WAL, busy_timeout=5000, synchronous=NORMAL, foreign_keys=ON')
  } catch (err) {
    logger.error({ err: (err as Error).message }, '[db] failed to apply SQLite PRAGMAs')
  }
}

// Fire-and-forget; the first query will block on the pragma if needed.
applySqlitePragmas().catch(() => {})
checkProductionDb().catch(() => {})

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
