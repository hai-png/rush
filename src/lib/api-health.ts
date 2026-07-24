import { db } from '@/lib/db';

const READY_OUTBOX_THRESHOLD = 1000; // pending outbox events = degraded
const READY_REFUND_THRESHOLD = 100;  // pending refund retries = degraded

export async function GET_health() {
  const start = Date.now();

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

export async function GET_config() {
  return { data: {
    tosVersion: process.env.CURRENT_TOS_VERSION || '2026-01-01',
    minAppVersion: process.env.MIN_APP_VERSION || '1.0.0',
    maintenanceMode: process.env.MAINTENANCE_MODE === '1',
    supportEmail: process.env.SUPPORT_EMAIL || 'support@addisride.et',
  }};
}

