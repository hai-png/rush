// Health check endpoint. Public (no auth). Returns DB + provider status.
// Used by uptime checks (UptimeRobot, BetterStack, etc.) and load balancer probes.

import { db } from '@/lib/db';
import { loadEnv } from '@/lib/env';

export async function GET_health() {
  const start = Date.now();
  const env = loadEnv();

  // Check DB connectivity.
  let dbOk = true;
  let dbError: string | undefined;
  try {
    await db.$queryRaw`SELECT 1`;
  } catch (e) {
    dbOk = false;
    dbError = (e as Error).message;
  }

  return {
    data: {
      status: dbOk ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      latencyMs: Date.now() - start,
      checks: {
        db: { ok: dbOk, error: dbError },
        telebirr: { mode: env.TELEBIRR_ENV },
      },
      version: process.env.npm_package_version ?? 'dev',
    },
  };
}

export async function GET_healthz() {
  return { data: { status: 'alive', timestamp: new Date().toISOString() } };
}
