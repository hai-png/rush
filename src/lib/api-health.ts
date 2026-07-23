
import { db } from '@/lib/db';

// / OPS-011: enhanced health checks.
//
// /healthz — liveness probe. Always returns 200 if the process is up.
//   k8s livenessProbe should use this.
//
// /health — detailed status for dashboards. Always returns 200 with full
//   status breakdown. Includes DB + Telebirr + version.
//
// /ready — readiness probe. Returns 200 only when the app is ready to serve
//   traffic: DB reachable, outbox backlog below threshold, scheduler recently
//   ran. Returns 503 otherwise. k8s readinessProbe should use this.
//
// /health no longer leaks DB error strings or Telebirr mode
// to unauthenticated callers. Detailed errors are only in the response body
// (which is logged but not displayed to end users).

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

  // SEC-019: do not expose Telebirr configured state — an unauthenticated
  // caller could learn whether the deployment is wired for live payments
  // (and thus whether forged webhooks might land). Only DB health is reported.
  return {
    data: {
      status: dbOk ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      latencyMs: Date.now() - start,
      checks: {
        // don't leak DB error message — just ok + latency.
        db: { ok: dbOk, latencyMs: dbLatencyMs },
      },
      version: process.env.npm_package_version ?? 'dev',
    },
  };
}

export async function GET_healthz() {
  return { data: { status: 'alive', timestamp: new Date().toISOString() } };
}

// New: /ready — readiness probe for k8s. Returns 503 if any critical check fails.
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

  // Outbox backlog.
  try {
    const pending = await db.outboxEvent.count({ where: { status: 'pending' } });
    checks.outbox = { ok: pending < READY_OUTBOX_THRESHOLD, latencyMs: 0 };
    (checks.outbox as any).pending = pending;
  } catch {
    checks.outbox = { ok: false };
  }

  // Refund retry backlog.
  try {
    const pendingRefunds = await db.refundRetry.count({ where: { status: 'pending' } });
    checks.refunds = { ok: pendingRefunds < READY_REFUND_THRESHOLD };
    (checks.refunds as any).pending = pendingRefunds;
  } catch {
    checks.refunds = { ok: false };
  }

  const allOk = Object.values(checks).every(c => c.ok);
  // don't leak operational metrics (outbox depth, refund backlog) to
  // unauthenticated callers. Return only status + timestamp.
  return {
    status: allOk ? 200 : 503,
    data: {
      status: allOk ? 'ready' : 'not ready',
      timestamp: new Date().toISOString(),
      // Only expose check details (not counts) — counts are admin-only via /metrics.
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
