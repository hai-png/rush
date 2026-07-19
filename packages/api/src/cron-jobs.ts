import { sql } from 'drizzle-orm';
import { db, schema, type Db } from '@addis/db';
import { writeAudit } from '../modules/admin/audit';

/**
 * Shared cron-job helper. Previously the cron routes (packages/api/modules/cron/routes.ts)
 * and the worker (apps/worker/src/index.ts) had two independent copies of the same
 * `withLock(name, fn)` helper, which the worker's own code comment acknowledged "can
 * drift — worth consolidating into a shared helper."
 *
 * Both paths now import this single implementation. The lock name is the same across
 * both, so whichever deployment runs the job first wins the advisory lock — running
 * both against the same database is safe (the loser just returns `{ skipped: true }`).
 *
 * Audit entries are written via the same `writeAudit()` writer as everything else, so
 * the hash-chained audit log stays consistent regardless of which path ran the job.
 */
export async function withLock<T>(name: string, fn: () => Promise<T>): Promise<
  | { ok: true; result: T; at: string }
  | { skipped: true; reason: 'lock-held' }
> {
  return db.transaction(async (tx) => {
    const lockResult = await tx.execute(sql`select pg_try_advisory_xact_lock(hashtext(${name})) as locked`);
    // postgres-js returns an array-like with rows; cast to extract the locked boolean.
    const rows = lockResult as unknown as Array<{ locked?: boolean }>;
    if (!rows[0]?.locked) {
      return { skipped: true, reason: 'lock-held' as const };
    }
    const result = await fn();
    await writeAudit(tx as unknown as Db, {
      actorId: null,
      action: `cron.${name}`,
      entityType: 'cron',
      after: result as unknown,
    });
    return { ok: true as const, result, at: new Date().toISOString() };
  });
}

/**
 * The set of cron jobs that both the HTTP routes and the worker intervals run.
 * Each entry is the lock name (used by withLock) and the function to execute.
 *
 * Both packages/api/modules/cron/routes.ts and apps/worker/src/index.ts import
 * this map so a new job added here is automatically picked up by both paths.
 */
export const CRON_JOBS: ReadonlyArray<{
  name: string;
  /** HTTP route segment, e.g. 'expire-subscriptions' → POST /api/v1/cron/expire-subscriptions */
  route: string;
  /** Worker setInterval period in milliseconds. */
  intervalMs: number;
  run: () => Promise<unknown>;
}> = [
  {
    name: 'expire-subscriptions',
    route: 'expire-subscriptions',
    intervalMs: 60 * 60_000, // 1 hour
    run: async () => {
      const { subscriptionRepo } = await import('../modules/subscription/repository');
      return subscriptionRepo.expireDue();
    },
  },
  {
    name: 'expire-seat-releases',
    route: 'expire-seat-releases',
    intervalMs: 15 * 60_000, // 15 min
    run: async () => {
      const { and, eq, lt } = await import('drizzle-orm');
      return db.update(schema.seatReleases).set({ status: 'expired', updatedAt: new Date() })
        .where(and(eq(schema.seatReleases.status, 'open'), lt(schema.seatReleases.expiresAt, new Date())))
        .returning({ id: schema.seatReleases.id });
    },
  },
  {
    name: 'cleanup-pending-subscriptions',
    route: 'cleanup-pending-subscriptions',
    intervalMs: 30 * 60_000, // 30 min
    run: async () => {
      const { subscriptionRepo } = await import('../modules/subscription/repository');
      return subscriptionRepo.cancelStalePending();
    },
  },
  {
    name: 'process-refund-retries',
    route: 'process-refund-retries',
    intervalMs: 15 * 60_000, // 15 min
    run: async () => {
      const { processRefundRetries } = await import('../modules/payment/service');
      return processRefundRetries();
    },
  },
  {
    name: 'reconcile-payments',
    route: 'reconcile-payments',
    intervalMs: 30 * 60_000, // 30 min
    run: async () => {
      const { and, eq, lt } = await import('drizzle-orm');
      const { getPaymentProvider } = await import('@addis/payments');
      const { settlePayment, failPayment } = await import('../modules/payment/service');
      const stale = await db.select().from(schema.payments)
        .where(and(eq(schema.payments.status, 'pending'), eq(schema.payments.method, 'telebirr'), lt(schema.payments.createdAt, sql`now() - interval '1 hour'`)));
      let settled = 0, failedCount = 0;
      for (const p of stale) {
        const result = await getPaymentProvider('telebirr').verifyPayment(p.reference);
        if (result.status === 'completed') { await settlePayment(p.reference); settled++; }
        else if (result.status === 'failed') { await failPayment(p.reference, result.raw); failedCount++; }
      }
      return { checked: stale.length, settled, failed: failedCount };
    },
  },
  {
    name: 'cleanup-stale-payments',
    route: 'cleanup-stale-payments',
    intervalMs: 60 * 60_000, // 1 hour
    run: async () => {
      const { and, lt, eq } = await import('drizzle-orm');
      return db.update(schema.payments).set({ status: 'failed', updatedAt: new Date() })
        .where(and(eq(schema.payments.status, 'pending'), lt(schema.payments.createdAt, sql`now() - interval '24 hours'`)))
        .returning({ id: schema.payments.id });
    },
  },
  {
    name: 'send-expiry-reminders',
    route: 'send-expiry-reminders',
    intervalMs: 60 * 60_000, // 1 hour
    run: async () => {
      const { and, eq, sql } = await import('drizzle-orm');
      const rows = await db.select().from(schema.subscriptions)
        .where(and(eq(schema.subscriptions.status, 'active'), sql`${schema.subscriptions.endDate} between now() + interval '2 days' and now() + interval '3 days'`));
      for (const sub of rows) {
        await db.insert(schema.outboxEvents).values({ channel: 'notification', payload: { type: 'subscription_expiring', userId: sub.riderId, daysLeft: 2 } });
      }
      return { notified: rows.length };
    },
  },
  {
    name: 'corporate-reset-monthly',
    route: 'corporate-reset-monthly',
    intervalMs: 24 * 3600_000, // 1 day
    run: async () => {
      const { lt } = await import('drizzle-orm');
      return db.update(schema.corporateMembers).set({ ridesUsedThisMonth: 0, lastResetAt: new Date() })
        .where(lt(schema.corporateMembers.lastResetAt, sql`date_trunc('month', now())`))
        .returning({ id: schema.corporateMembers.id });
    },
  },
  {
    name: 'retention-cleanup',
    route: 'retention-cleanup',
    intervalMs: 24 * 3600_000, // 1 day
    run: async () => {
      const { and, eq, lt, sql } = await import('drizzle-orm');
      const otps = await db.delete(schema.otpCodes).where(lt(schema.otpCodes.createdAt, sql`now() - interval '7 days'`)).returning({ id: schema.otpCodes.id });
      const resets = await db.delete(schema.passwordResetTokens).where(lt(schema.passwordResetTokens.createdAt, sql`now() - interval '7 days'`)).returning({ id: schema.passwordResetTokens.id });
      const notifs = await db.delete(schema.notifications).where(and(sql`${schema.notifications.readAt} is not null`, lt(schema.notifications.createdAt, sql`now() - interval '90 days'`))).returning({ id: schema.notifications.id });
      // Purge expired sessions — previously never cleaned up, causing the sessions
      // table to grow without bound. verifySession() already rejects expired
      // sessions, but keeping them around wastes space and slows session lookups.
      const sessions = await db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, sql`now()`)).returning({ id: schema.sessions.id });
      // Purge old idempotency records (past their 24h retention window).
      const idempotency = await db.delete(schema.idempotencyRecords).where(lt(schema.idempotencyRecords.expiresAt, sql`now()`)).returning({ key: schema.idempotencyRecords.key });
      const deletedUsers = await db.select().from(schema.users).where(and(sql`${schema.users.deletedAt} is not null`, lt(schema.users.deletedAt, sql`now() - interval '30 days'`)));
      for (const u of deletedUsers) {
        await db.update(schema.payments).set({ riderId: null as any }).where(sql`rider_id in (select id from rider_profiles where user_id = ${u.id})`);
        await db.delete(schema.riderProfiles).where(eq(schema.riderProfiles.userId, u.id));
        await db.update(schema.users).set({ name: 'Deleted User', email: null, phone: `deleted-${u.id.slice(0, 8)}` }).where(eq(schema.users.id, u.id));
      }
      return { otpsDeleted: otps.length, resetsDeleted: resets.length, notificationsDeleted: notifs.length, sessionsDeleted: sessions.length, idempotencyDeleted: idempotency.length, usersAnonymized: deletedUsers.length };
    },
  },
  {
    name: 'auto-close-tickets',
    route: 'auto-close-tickets',
    intervalMs: 60 * 60_000, // 1 hour
    run: async () => {
      const { supportService } = await import('../modules/support/service');
      return supportService.autoCloseStale();
    },
  },
];

/**
 * Map from cron-job name → CRON_JOBS entry, for O(1) lookup by the HTTP routes
 * (which receive the job name as a path parameter).
 */
export const CRON_JOBS_BY_NAME: ReadonlyMap<string, (typeof CRON_JOBS)[number]> = new Map(
  CRON_JOBS.map((j) => [j.name, j]),
);
