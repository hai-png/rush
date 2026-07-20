import './instrumentation';
import { loadEnv } from '@addis/shared';
import { db, schema } from '@addis/db';
import { eq, sql, count } from 'drizzle-orm';
import { withLock, CRON_JOBS } from '@addis/api/src/cron-jobs';
import { logger } from '@addis/api/infra/logger';
import { outboxDepthGauge } from '@addis/api/modules/health/metrics';

loadEnv();

const WORKER_ID = `worker-${process.pid}-${Date.now()}`;
const workerLogger = logger.child({ component: 'worker', workerId: WORKER_ID });

const HANDLERS: Record<string, (payload: any, evt: any) => Promise<void>> = {
  notification: async (p, evt) => (await import('./handlers/notification')).handle(p, evt),
  sms: async (p, evt) => (await import('./handlers/sms')).handle(p, evt),
  push: async (p, evt) => (await import('./handlers/push')).handle(p, evt),
  email: async (p, evt) => (await import('./handlers/email')).handle(p, evt),
  audit: async (p, evt) => (await import('./handlers/audit')).handle(p, evt),
  webhook: async (p, evt) => (await import('./handlers/webhook')).handle(p, evt),
};

const BACKOFF_SEC = [30, 60, 300, 900, 3600];
const LOCK_TTL_MS = 5 * 60_000;

async function drainOutbox() {

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

  try {
    const [depth] = await db.select({ n: count() }).from(schema.outboxEvents)
      .where(eq(schema.outboxEvents.status, 'pending'));
    outboxDepthGauge.set(depth?.n ?? 0);
  } catch {  }

  for (const evt of rows) {
    try {

      await HANDLERS[evt.channel](evt.payload, evt);
      await db.update(schema.outboxEvents).set({ status: 'delivered' as any, updatedAt: new Date() }).where(eq(schema.outboxEvents.id, evt.id));
    } catch (err) {
      const attempts = evt.attempts + 1;
      if (attempts >= evt.maxAttempts) {
        await db.update(schema.outboxEvents).set({ status: 'dead' as any, attempts, lastError: String(err), updatedAt: new Date() }).where(eq(schema.outboxEvents.id, evt.id));
        const Sentry = await import('@sentry/node');

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

  const shutdown = async (signal: string) => {
    workerLogger.info({ signal }, 'shutting down worker');
    shuttingDown = true;
    if (drainTimer) clearInterval(drainTimer);
    for (const t of cronTimers) clearInterval(t);

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
