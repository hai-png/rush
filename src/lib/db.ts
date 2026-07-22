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
    await db.$executeRaw`PRAGMA journal_mode=WAL`
    await db.$executeRaw`PRAGMA busy_timeout=5000`
    await db.$executeRaw`PRAGMA synchronous=NORMAL`
    await db.$executeRaw`PRAGMA foreign_keys=ON`
    logger.info('[db] SQLite PRAGMAs applied: WAL, busy_timeout=5000, synchronous=NORMAL, foreign_keys=ON')
  } catch (err) {
    logger.error({ err: (err as Error).message }, '[db] failed to apply SQLite PRAGMAs')
  }
}

// Fire-and-forget; the first query will block on the pragma if needed.
applySqlitePragmas().catch(() => {})

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
