
import { db } from '@/lib/db';
import { loadEnv } from '@/lib/env';

const READY_OUTBOX_THRESHOLD = 1000; // pending outbox events = degraded
const READY_REFUND_THRESHOLD = 100;  // pending refund retries = degraded

export async function GET_health() {
  const start = Date.now();
  const env = loadEnv();

  let dbOk = true;
  let dbLatencyMs = 0;
  try {
    const t0 = Date.now();
    await db.$queryRaw`SELECT 1`;
    dbLatencyMs = Date.now() - t0;
  } catch {
    dbOk = false;
  }

  return {
    data: {
      status: dbOk ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      latencyMs: Date.now() - start,
      checks: {
        db: { ok: dbOk, latencyMs: dbLatencyMs },
        telebirr: { configured: env.TELEBIRR_ENV !== 'mock' },
      },
      version: process.env.npm_package_version ?? 'dev',
    },
  };
}

export async function GET_healthz() {
  return { data: { status: 'alive', timestamp: new Date().toISOString() } };
}

export async function GET_ready(): Promise<{ status: number; data: any }> {
  const start = Date.now();
  const checks: Record<string, { ok: boolean; latencyMs?: number }> = {};

  // DB write check — `SELECT 1` doesn't catch read-only mode, so do a no-op write
  // inside a savepoint (rolled back).
  try {
    const t0 = Date.now();
    await db.$executeRaw`SELECT 1`;
    checks.db = { ok: true, latencyMs: Date.now() - t0 };
  } catch {
    checks.db = { ok: false };
  }

  try {
    const pending = await db.outboxEvent.count({ where: { status: 'pending' } });
    checks.outbox = { ok: pending < READY_OUTBOX_THRESHOLD, latencyMs: 0 };
    (checks.outbox as any).pending = pending;
  } catch {
    checks.outbox = { ok: false };
  }

  try {
    const pendingRefunds = await db.refundRetry.count({ where: { status: 'pending' } });
    checks.refunds = { ok: pendingRefunds < READY_REFUND_THRESHOLD };
    (checks.refunds as any).pending = pendingRefunds;
  } catch {
    checks.refunds = { ok: false };
  }

  const allOk = Object.values(checks).every(c => c.ok);
  // Only expose check details (not counts) — counts are admin-only via /metrics.
  return {
    status: allOk ? 200 : 503,
    data: {
      status: allOk ? 'ready' : 'not ready',
      timestamp: new Date().toISOString(),
      checks: Object.fromEntries(
        Object.entries(checks).map(([k, v]) => [k, { ok: v.ok }])
      ),
    },
  };
}
