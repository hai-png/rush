import './instrumentation';
import { loadEnv } from '@addis/shared';
import { db, schema } from '@addis/db';
import { eq, sql, count } from 'drizzle-orm';
import { withLock, CRON_JOBS } from '@addis/api/src/cron-jobs';
import { logger } from '@addis/api/infra/logger';
import { outboxDepthGauge } from '@addis/api/modules/health/metrics';

loadEnv(); // validate env at startup

// FIX (META-016): Single WORKER_ID for both logger and DB — consistent
// log-to-DB correlation.
const WORKER_ID = `worker-${process.pid}-${Date.now()}`;
const workerLogger = logger.child({ component: 'worker', workerId: WORKER_ID });

const HANDLERS: Record<string, (payload: any) => Promise<void>> = {
  notification: async (p) => (await import('./handlers/notification')).handle(p),
  sms: async (p) => (await import('./handlers/sms')).handle(p),
  push: async (p) => (await import('./handlers/push')).handle(p),
  email: async (p) => (await import('./handlers/email')).handle(p),
  audit: async (p) => (await import('./handlers/audit')).handle(p),
  webhook: async (p) => (await import('./handlers/webhook')).handle(p),
};

const BACKOFF_SEC = [30, 60, 300, 900, 3600];
const LOCK_TTL_MS = 5 * 60_000; // 5 min — if the worker crashes, another can pick up after this

async function drainOutbox() {
  // Claim rows atomically using SELECT FOR UPDATE SKIP LOCKED + UPDATE to set
  // status='processing', lockedAt, lockedBy, and a visibilityAfter (so a
  // crashed worker's rows are re-picked after LOCK_TTL_MS). This prevents
  // two concurrent workers from both picking up the same event and
  // double-firing notifications/SMS/etc.
  //
  // FIX (OPS-001 / SEC-005): The previous implementation had a `.catch()`
  // fallback that did a plain SELECT + UPDATE with NO locking — a TOCTOU
  // race where two workers could both select the same 50 rows, both mark
  // them 'processing', and both fire the side effect (double SMS, double
  // refund, double webhook). The fallback fired on ANY SQL error, including
  // transient connection blips. Now: errors propagate — the next setInterval
  // tick retries. Fail loud, never silently degrade to an unsafe path.
  const claimed = await db.execute(sql`
    UPDATE outbox_events SET status = 'processing', locked_at = now(), locked_by = ${WORKER_ID}, visibility_after = now() + interval '${sql.raw(String(LOCK_TTL_MS / 1000))} seconds'
    WHERE id IN (
      SELECT id FROM outbox_events
      WHERE status = 'pending'
        AND next_attempt_at <= now()
        AND (locked_at IS NULL OR visibility_after < now())
      LIMIT 50
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  `);

  const rows = (claimed as any).rows ?? (claimed as any) ?? [];

  // FIX (META-011): Update the outbox depth gauge so /metrics reports the
  // current backlog. Query once per drain cycle.
  try {
    const [depth] = await db.select({ n: count() }).from(schema.outboxEvents)
      .where(eq(schema.outboxEvents.status, 'pending'));
    outboxDepthGauge.set(depth?.n ?? 0);
  } catch { /* best-effort — don't block the drain loop */ }

  for (const evt of rows) {
    try {
      await HANDLERS[evt.channel](evt.payload);
      await db.update(schema.outboxEvents).set({ status: 'delivered' as any, updatedAt: new Date() }).where(eq(schema.outboxEvents.id, evt.id));
    } catch (err) {
      const attempts = evt.attempts + 1;
      if (attempts >= evt.maxAttempts) {
        await db.update(schema.outboxEvents).set({ status: 'dead' as any, attempts, lastError: String(err), updatedAt: new Date() }).where(eq(schema.outboxEvents.id, evt.id));
        const Sentry = await import('@sentry/node');
        // FIX (OPS-004): dedicated dead-letter alert, not just the underlying error.
        Sentry.captureMessage('outbox event dead-lettered', {
          level: 'error',
          extra: { outboxEventId: evt.id, channel: evt.channel, attempts, lastError: String(err) },
        });
        Sentry.captureException(err, { extra: { outboxEventId: evt.id } });
        workerLogger.error({ outboxEventId: evt.id, channel: evt.channel, attempts, err }, 'outbox event dead-lettered');
      } else {
        const backoff = BACKOFF_SEC[Math.min(attempts - 1, BACKOFF_SEC.length - 1)];
        await db.update(schema.outboxEvents).set({
          status: 'pending' as any, attempts, lastError: String(err),
          nextAttemptAt: new Date(Date.now() + backoff * 1000), updatedAt: new Date(),
          lockedAt: null, lockedBy: null, visibilityAfter: null,
        }).where(eq(schema.outboxEvents.id, evt.id));
      }
    }
  }
}

/**
 * Worker entrypoint. Two responsibilities:
 *
 *   1. Drain the outbox every 5s — fan out notification/sms/push/email/audit/webhook
 *      events to their handlers with exponential backoff.
 *
 *   2. Run every cron job on a setInterval loop. The job definitions and the
 *      `withLock` helper are imported from `@addis/api/src/cron-jobs` — the same
 *      registry the HTTP cron routes use. This eliminates the previous duplication
 *      (the worker had its own copy of withLock and of every job's body, which
 *      had already drifted: the corporate-reset job used `setDate(1)` here while
 *      the cron route used `date_trunc('month', now())`).
 *
 * Running both the worker AND the HTTP cron routes against the same database is
 * safe — both take a Postgres advisory lock keyed on the job name, so whichever
 * arrives first wins; the loser's `withLock` returns `{ skipped: true }` and the
 * job is a no-op for that invocation.
 *
 * FIXES (OPS-002, OPS-003):
 *   - SIGTERM/SIGINT handlers now stop the timers and let in-flight work finish
 *     (up to 30s) before exiting. Previously, a rolling deploy killed the process
 *     immediately, leaving 'processing' outbox rows stuck until visibility_after
 *     expired (5 min) — and any handler mid-SMS-send would either send a duplicate
 *     on the next run or skip a notification entirely.
 *   - The drain loop is guarded by a `draining` flag so a slow drain (e.g.
 *     Telebirr webhook takes 8s) doesn't overlap with the next setInterval tick.
 *     Previously, N overlapping drains could claim N×50 rows and exhaust the
 *     DB pool / blow through provider rate limits.
 */
let draining = false;
let shuttingDown = false;
let drainTimer: NodeJS.Timeout | null = null;
const cronTimers: NodeJS.Timeout[] = [];

async function main() {
  drainTimer = setInterval(async () => {
    if (shuttingDown || draining) return;
    draining = true;
    try {
      await drainOutbox();
    } catch (err) {
      workerLogger.error({ err }, 'drainOutbox failed');
    } finally {
      draining = false;
    }
  }, 5000);

  for (const job of CRON_JOBS) {
    const t = setInterval(() => {
      if (shuttingDown) return;
      withLock(job.name, () => job.run()).catch(err => {
        workerLogger.error({ err, job: job.name }, 'cron job failed');
      });
    }, job.intervalMs);
    cronTimers.push(t);
  }

  workerLogger.info({ cronJobs: CRON_JOBS.length }, 'Addis Ride worker started');

  // Graceful shutdown. On SIGTERM/SIGINT, stop scheduling new work and let
  // the current drainOutbox iteration finish (up to 30s) before exiting.
  const shutdown = async (signal: string) => {
    workerLogger.info({ signal }, 'shutting down worker');
    shuttingDown = true;
    if (drainTimer) clearInterval(drainTimer);
    for (const t of cronTimers) clearInterval(t);
    // Wait up to 30s for the in-flight drain to finish.
    const deadline = Date.now() + 30_000;
    while (draining && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 200));
    }
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}
main();
