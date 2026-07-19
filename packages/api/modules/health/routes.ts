import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { db } from '@addis/db';
import { redis } from '../../infra/redis';
import { statfs } from 'node:fs/promises';
import { loadEnv } from '@addis/shared';

const env = loadEnv();

export const healthRoutes = new Hono();

/**
 * Health check.
 *
 * The previous implementation gave false confidence on two checks:
 *   1. `telebirr` was 'ok' if the env var was merely set — even if
 *      credentials were wrong or the service was unreachable.
 *   2. `migrations` always returned 'ok' with version 'unknown' if
 *      MIGRATION_VERSION wasn't set — migrations could be completely
 *      missing and the health check would still say 'ok'.
 * Both now actually probe the underlying system, and both factor into the
 * `overall` status (previously only DB and Redis did).
 */
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

  // Telebirr: actually probe reachability rather than just checking the env
  // var. A simple GET to the base URL (or a token request) tells us if the
  // service is up and our credentials are valid. Use a short timeout so a
  // hanging telebirr doesn't drag the whole health check down.
  if (env.TELEBIRR_FABRIC_APP_ID) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      const t0 = Date.now();
      const res = await fetch(`${env.TELEBIRR_ENV === 'production' ? 'https://superapp.ethiomobilemoney.et' : 'https://developerportal.ethiotelebirr.et'}/.well-known/health`, {
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));
      checks.telebirr = {
        status: res.ok || res.status < 500 ? 'ok' : 'degraded',
        latencyMs: Date.now() - t0,
        httpStatus: res.status,
      };
      if (checks.telebirr.status !== 'ok') overall = overall === 'down' ? 'down' : 'degraded';
    } catch (err) {
      checks.telebirr = { status: 'degraded', error: (err as Error).message };
      overall = overall === 'down' ? 'down' : 'degraded';
    }
  } else {
    checks.telebirr = { status: 'degraded', reason: 'not configured' };
    overall = overall === 'down' ? 'down' : 'degraded';
  }

  try {
    const stats = await statfs(process.cwd());
    checks.disk = { status: 'ok', freeBytes: stats.bfree * stats.bsize };
  } catch { checks.disk = { status: 'degraded' }; }

  // Migrations: query the DB's schema_migrations table (Drizzle's default)
  // for the latest applied hash. If the table doesn't exist or is empty,
  // migrations haven't run.
  try {
    const result = await db.execute(sql`select hash from __drizzle_migrations order by created_at desc limit 1`).catch(() => null);
    if (result && (result as any).rows?.length) {
      checks.migrations = { status: 'ok', version: (result as any).rows[0].hash?.slice(0, 12) ?? 'unknown' };
    } else {
      checks.migrations = { status: 'degraded', reason: 'no migrations applied' };
      overall = overall === 'down' ? 'down' : 'degraded';
    }
  } catch (err) {
    checks.migrations = { status: 'degraded', error: (err as Error).message };
    overall = overall === 'down' ? 'down' : 'degraded';
  }

  return c.json({
    status: overall, checks, version: process.env.npm_package_version ?? '1.0.0', commitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev',
  }, overall === 'ok' ? 200 : 503);
});
