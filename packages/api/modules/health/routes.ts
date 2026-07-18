import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { db } from '@addis/db';
import { redis } from '../../infra/redis';
import { statfs } from 'node:fs/promises';

export const healthRoutes = new Hono();

healthRoutes.get('/health', async (c) => {
  const checks: Record<string, any> = {};
  let overall: 'ok' | 'degraded' | 'down' = 'ok';

  try {
    const t0 = Date.now();
    await db.execute(sql`select 1`);
    checks.database = { status: 'ok', latencyMs: Date.now() - t0 };
  } catch { checks.database = { status: 'down' }; overall = 'down'; }

  try {
    const t0 = Date.now();
    await redis.set('health:ping', '1', { ex: 5 });
    checks.redis = { status: 'ok', latencyMs: Date.now() - t0 };
  } catch { checks.redis = { status: 'down' }; overall = overall === 'down' ? 'down' : 'degraded'; }

  checks.telebirr = { status: process.env.TELEBIRR_FABRIC_APP_ID ? 'ok' : 'degraded' };

  try {
    const stats = await statfs(process.cwd());
    checks.disk = { status: 'ok', freeBytes: stats.bfree * stats.bsize };
  } catch { checks.disk = { status: 'degraded' }; }

  checks.migrations = { status: 'ok', version: process.env.MIGRATION_VERSION ?? 'unknown' };

  return c.json({
    status: overall, checks, version: process.env.npm_package_version ?? '1.0.0', commitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev',
  }, overall === 'ok' ? 200 : 503);
});
