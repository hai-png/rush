import './instrumentation'; // must run first: calls Sentry.init(); this file previously existed but was never imported anywhere, so worker crash reporting was silently a no-op
import { loadEnv } from '@addis/shared';
import { db, schema } from '@addis/db';
import { and, eq, lte } from 'drizzle-orm';
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

async function drainOutbox() {
  const due = await db.select().from(schema.outboxEvents)
    .where(and(eq(schema.outboxEvents.status, 'pending'), lte(schema.outboxEvents.nextAttemptAt, new Date())))
    .limit(50);

  for (const evt of due) {
    try {
      await HANDLERS[evt.channel](evt.payload);
      await db.update(schema.outboxEvents).set({ status: 'delivered', updatedAt: new Date() }).where(eq(schema.outboxEvents.id, evt.id));
    } catch (err) {
      const attempts = evt.attempts + 1;
      if (attempts >= evt.maxAttempts) {
        await db.update(schema.outboxEvents).set({ status: 'dead', attempts, lastError: String(err), updatedAt: new Date() }).where(eq(schema.outboxEvents.id, evt.id));
        const Sentry = await import('@sentry/node');
        Sentry.captureException(err, { extra: { outboxEventId: evt.id } });
      } else {
        const backoff = BACKOFF_SEC[Math.min(attempts - 1, BACKOFF_SEC.length - 1)];
        await db.update(schema.outboxEvents).set({
          status: 'pending', attempts, lastError: String(err),
          nextAttemptAt: new Date(Date.now() + backoff * 1000), updatedAt: new Date(),
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
