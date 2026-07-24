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
async function checkProductionDb(): Promise<void> {
  if (process.env.NODE_ENV !== 'production') return;
  const url = process.env.DATABASE_URL ?? '';
  if (url.startsWith('file:')) {
    logger.warn('[db] Running SQLite in production! Use Postgres + DATABASE_PROVIDER=postgres for production. ' +
      'Set DATABASE_URL to a postgresql:// connection string and re-run scripts/select-schema.sh.');
  } else if (!url.startsWith('postgresql://') && !url.startsWith('postgres://')) {
    logger.warn(`[db] Unrecognized DATABASE_URL scheme: ${url.split(':')[0]}:// — expected postgresql://`);
  }
  if (url.startsWith('postgresql://') || url.startsWith('postgres://')) {
    if (!process.env.DATABASE_POOL_URL) {
      logger.info('[db] Postgres detected. For multi-instance deployments, set DATABASE_POOL_URL (PgBouncer) ' +
        'and configure the pooler connection string for Prisma.');
    }
  }
}

async function applySqlitePragmas(): Promise<void> {
  if (globalForPrisma.__prismaPragmasInitialized) return
  globalForPrisma.__prismaPragmasInitialized = true

  const url = process.env.DATABASE_URL ?? ''
  if (!url.startsWith('file:')) return // Postgres or other — skip

  try {
    await db.$queryRaw`PRAGMA journal_mode=WAL`
    await db.$queryRaw`PRAGMA busy_timeout=5000`
    await db.$queryRaw`PRAGMA synchronous=NORMAL`
    await db.$queryRaw`PRAGMA foreign_keys=ON`
    logger.info('[db] SQLite PRAGMAs applied: WAL, busy_timeout=5000, synchronous=NORMAL, foreign_keys=ON')
  } catch (err) {
    logger.error({ err: (err as Error).message }, '[db] failed to apply SQLite PRAGMAs')
  }
}

applySqlitePragmas().catch(() => {})
checkProductionDb().catch(() => {})

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db

