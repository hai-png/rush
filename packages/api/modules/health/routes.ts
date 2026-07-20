import { TypedOpenAPIHono } from '../../src/typed-hono';
import { sql } from 'drizzle-orm';
import { db } from '@addis/db';
import { redis } from '../../infra/redis';
import { statfs } from 'node:fs/promises';
import { loadEnv } from '@addis/shared';

const env = loadEnv();

export const healthRoutes = new TypedOpenAPIHono();

healthRoutes.get('/healthz', async (c) => {
  try {
    await db.execute(sql`select 1`);
    return c.text('ok', 200);
  } catch {
    return c.text('down', 503);
  }
});

healthRoutes.get('/health', async (c) => {

  const session = c.get('session');
  if (!session || session.role !== 'platform_admin') {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Admin auth required for detailed health', requestId: c.get('requestId') } }, 401);
  }

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
