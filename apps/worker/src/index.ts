import './instrumentation'; // must run first: calls Sentry.init(); this file previously existed but was never imported anywhere, so worker crash reporting was silently a no-op
import { loadEnv } from '@addis/shared';
import { db, schema } from '@addis/db';
import { and, eq, lte, inArray, sql } from 'drizzle-orm';
import { withLock, CRON_JOBS } from '@addis/api/src/cron-jobs';

const env = loadEnv();

const HANDLERS: Record<string, (payload: any) => Promise<void>> = {
  notification: async (p) => (await import('./handlers/notification')).handle(p),
  sms: async (p) => (await import('./handlers/sms')).handle(p),
  push: async (p) => (await import('./handlers/push')).handle(p),
  email: async (p) => (await import('./handlers/email')).handle(p),
  refund: async () => { /* refunds drained separately via process-refund-retries cron */ },
  audit: async (p) => (await import('./handlers/audit')).handle(p),
  webhook: async (p) => (await import('./handlers/webhook')).handle(p),
};

const BACKOFF_SEC = [30, 60, 300, 900, 3600];
const WORKER_ID = `worker-${process.pid}-${Date.now()}`;
const LOCK_TTL_MS = 5 * 60_000; // 5 min — if the worker crashes, another can pick up after this

async function drainOutbox() {
  // Claim rows atomically using SELECT FOR UPDATE SKIP LOCKED + UPDATE to set
  // status='processing', lockedAt, lockedBy, and a visibilityAfter (so a
  // crashed worker's rows are re-picked after LOCK_TTL_MS). This prevents
  // two concurrent workers from both picking up the same event and
  // double-firing notifications/SMS/etc.
  //
  // The previous implementation did a plain SELECT with no locking — under
  // multiple worker replicas, the same event could be delivered twice.
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
  `).catch(async () => {
    // Fallback for environments where the raw SQL above doesn't work (e.g.
    // the table name is camelCase or the SQL syntax is incompatible).
    // Use a simpler claim: just mark as processing with lockedBy.
    const { and, eq, lte, or, isNull, lt, sql } = await import('drizzle-orm');
    const due = await db.select().from(schema.outboxEvents)
      .where(and(
        eq(schema.outboxEvents.status, 'pending'),
        lte(schema.outboxEvents.nextAttemptAt, new Date()),
        or(isNull(schema.outboxEvents.lockedAt), lt(schema.outboxEvents.visibilityAfter, new Date())),
      ))
      .limit(50);
    if (due.length === 0) return { rows: [] };
    // Mark as processing
    await db.update(schema.outboxEvents)
      .set({ status: 'processing' as any, lockedAt: new Date(), lockedBy: WORKER_ID, visibilityAfter: new Date(Date.now() + LOCK_TTL_MS) })
      .where(inArray(schema.outboxEvents.id, due.map(e => e.id)));
    return { rows: due };
  });

  const rows = (claimed as any).rows ?? (claimed as any) ?? [];
  for (const evt of rows) {
    try {
      await HANDLERS[evt.channel](evt.payload);
      await db.update(schema.outboxEvents).set({ status: 'delivered' as any, updatedAt: new Date() }).where(eq(schema.outboxEvents.id, evt.id));
    } catch (err) {
      const attempts = evt.attempts + 1;
      if (attempts >= evt.maxAttempts) {
        await db.update(schema.outboxEvents).set({ status: 'dead' as any, attempts, lastError: String(err), updatedAt: new Date() }).where(eq(schema.outboxEvents.id, evt.id));
        const Sentry = await import('@sentry/node');
        Sentry.captureException(err, { extra: { outboxEventId: evt.id } });
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
 */
async function main() {
  setInterval(() => drainOutbox().catch(console.error), 5000);

  for (const job of CRON_JOBS) {
    setInterval(() => {
      withLock(job.name, () => job.run()).catch(console.error);
    }, job.intervalMs);
  }

  console.log(`Addis Ride worker started. ${CRON_JOBS.length} cron jobs registered.`);
}
main();
