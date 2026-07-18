import { loadEnv } from '@addis/shared';
import { db, schema } from '@addis/db';
import { and, eq, lte } from 'drizzle-orm';
import { processRefundRetries } from '@addis/api/modules/payment/service';

const env = loadEnv();

const HANDLERS: Record<string, (payload: any) => Promise<void>> = {
  notification: async (p) => (await import('./handlers/notification')).handle(p),
  sms: async (p) => (await import('./handlers/sms')).handle(p),
  push: async (p) => (await import('./handlers/push')).handle(p),
  email: async (p) => (await import('./handlers/email')).handle(p),
  refund: async () => { /* refunds drained separately via processRefundRetries */ },
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

/** Cron jobs use pg_advisory_xact_lock so only one worker instance runs each job at a time. */
async function withLock(name: string, fn: () => Promise<unknown>) {
  return db.transaction(async (tx) => {
    const { rows } = await tx.execute(sqlAdvisory(name));
    if (!rows[0]?.locked) return { skipped: true, reason: 'lock-held' };
    const result = await fn();
    await tx.insert(schema.auditLogs).values({
      action: `cron.${name}`, entityType: 'cron', hash: 'n/a', // real impl computes hash chain
    } as any);
    return { ok: true, result };
  });
}
function sqlAdvisory(name: string) {
  const { sql } = require('drizzle-orm');
  return sql`select pg_try_advisory_xact_lock(hashtext(${name})) as locked`;
}

async function main() {
  setInterval(() => drainOutbox().catch(console.error), 5000);

  setInterval(() => withLock('expire-subscriptions', async () => {
    const { subscriptionRepo } = await import('@addis/api/modules/subscription/repository');
    return subscriptionRepo.expireDue();
  }).catch(console.error), 3600_000);

  setInterval(() => withLock('expire-seat-releases', async () => {
    const { lt, eq: eq2 } = await import('drizzle-orm');
    return db.update(schema.seatReleases).set({ status: 'expired', updatedAt: new Date() })
      .where(and(eq2(schema.seatReleases.status, 'open'), lt(schema.seatReleases.expiresAt, new Date())))
      .returning({ id: schema.seatReleases.id });
  }).catch(console.error), 15 * 60_000);

  setInterval(() => withLock('cleanup-pending-subscriptions', async () => {
    const { subscriptionRepo } = await import('@addis/api/modules/subscription/repository');
    return subscriptionRepo.cancelStalePending();
  }).catch(console.error), 30 * 60_000);

  setInterval(() => withLock('process-refund-retries', () => processRefundRetries()).catch(console.error), 15 * 60_000);

  setInterval(() => withLock('corporate-reset-monthly', async () => {
    const { lt } = await import('drizzle-orm');
    return db.update(schema.corporateMembers).set({ ridesUsedThisMonth: 0, lastResetAt: new Date() })
      .where(lt(schema.corporateMembers.lastResetAt, new Date(new Date().setDate(1))));
  }).catch(console.error), 24 * 3600_000);

  console.log('Addis Ride worker started.');
}
main();
