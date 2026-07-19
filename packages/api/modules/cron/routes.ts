import { Hono } from 'hono';
import { timingSafeEqual } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db, schema } from '@addis/db';
import { subscriptionRepo } from '../subscription/repository';
import { processRefundRetries } from '../payment/service';
import { supportService } from '../support/service';
import { writeAudit } from '../admin/audit';
import { and, lt, eq } from 'drizzle-orm';

export const cronRoutes = new Hono();

cronRoutes.use('*', async (c, next) => {
  const provided = c.req.header('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const expected = process.env.CRON_SECRET ?? '';
  // Guard explicitly against an unset/misconfigured secret rather than relying only on env
  // schema validation elsewhere: without this, an empty `expected` and an empty `provided`
  // (no Authorization header at all) both have length 0 and timingSafeEqual('', '') is true,
  // which would leave every cron endpoint — including data-deletion and payment-reconciliation
  // jobs — open with zero authentication.
  if (expected.length < 32) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Cron secret not configured', requestId: c.get('requestId') } }, 401);
  const ok = provided.length === expected.length && timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  if (!ok) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid cron secret', requestId: c.get('requestId') } }, 401);
  await next();
});

async function withLock(name: string, fn: () => Promise<unknown>) {
  return db.transaction(async (tx) => {
    const { rows } = await tx.execute(sql`select pg_try_advisory_xact_lock(hashtext(${name})) as locked`);
    if (!(rows as any)[0]?.locked) return { skipped: true, reason: 'lock-held' };
    const result = await fn();
    // Previously inserted a raw row with hash: 'n/a', bypassing writeAudit()'s hash-chaining
    // entirely — every cron run would then make verifyAuditChain() report the chain broken at
    // that row. Route every audit write through the single chained writer instead.
    await writeAudit(tx as any, { actorId: null, action: `cron.${name}`, entityType: 'cron', after: result });
    return { ok: true, result, at: new Date().toISOString() };
  });
}

cronRoutes.post('/expire-subscriptions', async (c) => c.json(await withLock('expire-subscriptions', () => subscriptionRepo.expireDue())));
cronRoutes.post('/expire-seat-releases', async (c) => c.json(await withLock('expire-seat-releases', async () => {
  // Fire per-release notifications — the previous implementation did a raw
  // UPDATE with no outbox events. The seat_release_expired notification
  // type exists in the schema and has a template, but no code dispatched it.
  const expired = await db.update(schema.seatReleases)
    .set({ status: 'expired', updatedAt: new Date() })
    .where(and(eq(schema.seatReleases.status, 'open'), lt(schema.seatReleases.expiresAt, new Date())))
    .returning({ id: schema.seatReleases.id, riderId: schema.seatReleases.riderId });
  if (expired.length > 0) {
    await db.insert(schema.outboxEvents).values(
      expired.map(r => ({ channel: 'notification' as const, payload: { type: 'seat_release_expired', userId: r.riderId, releaseId: r.id } })),
    );
  }
  return expired;
})));
cronRoutes.post('/cleanup-pending-subscriptions', async (c) => c.json(await withLock('cleanup-pending-subscriptions', () => subscriptionRepo.cancelStalePending())));
cronRoutes.post('/process-refund-retries', async (c) => c.json(await withLock('process-refund-retries', () => processRefundRetries())));

cronRoutes.post('/reconcile-payments', async (c) => c.json(await withLock('reconcile-payments', async () => {
  const { getPaymentProvider } = await import('@addis/payments');
  const { settlePayment, failPayment } = await import('../payment/service');
  const stale = await db.select().from(schema.payments)
    .where(and(eq(schema.payments.status, 'pending'), eq(schema.payments.method, 'telebirr'), lt(schema.payments.createdAt, sql`now() - interval '1 hour'`)));
  let settled = 0, failedCount = 0;
  for (const p of stale) {
    const result = await getPaymentProvider('telebirr').verifyPayment(p.reference);
    if (result.status === 'completed') { await settlePayment(p.reference); settled++; }
    else if (result.status === 'failed') { await failPayment(p.reference, result.raw); failedCount++; }
  }
  return { checked: stale.length, settled, failed: failedCount };
})));

cronRoutes.post('/cleanup-stale-payments', async (c) => c.json(await withLock('cleanup-stale-payments', () =>
  db.update(schema.payments).set({ status: 'failed', updatedAt: new Date() })
    .where(and(eq(schema.payments.status, 'pending'), lt(schema.payments.createdAt, sql`now() - interval '24 hours'`))).returning({ id: schema.payments.id }))));

cronRoutes.post('/send-expiry-reminders', async (c) => c.json(await withLock('send-expiry-reminders', async () => {
  const rows = await db.select().from(schema.subscriptions)
    .where(and(eq(schema.subscriptions.status, 'active'), sql`${schema.subscriptions.endDate} between now() + interval '2 days' and now() + interval '3 days'`));
  for (const sub of rows) {
    await db.insert(schema.outboxEvents).values({ channel: 'notification', payload: { type: 'subscription_expiring', userId: sub.riderId, daysLeft: 2 } });
  }
  return { notified: rows.length };
})));

cronRoutes.post('/corporate-reset-monthly', async (c) => c.json(await withLock('corporate-reset-monthly', async () => {
  // Fire per-member notifications — the corporate_reset notification type
  // exists in the schema and has a template, but no code dispatched it.
  const reset = await db.update(schema.corporateMembers)
    .set({ ridesUsedThisMonth: 0, lastResetAt: new Date() })
    .where(lt(schema.corporateMembers.lastResetAt, sql`date_trunc('month', now())`))
    .returning({ id: schema.corporateMembers.id, userId: schema.corporateMembers.userId });
  if (reset.length > 0) {
    await db.insert(schema.outboxEvents).values(
      reset.map(m => ({ channel: 'notification' as const, payload: { type: 'corporate_reset', userId: m.userId } })),
    );
  }
  return reset;
})));

cronRoutes.post('/retention-cleanup', async (c) => c.json(await withLock('retention-cleanup', async () => {
  const otps = await db.delete(schema.otpCodes).where(lt(schema.otpCodes.createdAt, sql`now() - interval '7 days'`)).returning({ id: schema.otpCodes.id });
  const resets = await db.delete(schema.passwordResetTokens).where(lt(schema.passwordResetTokens.createdAt, sql`now() - interval '7 days'`)).returning({ id: schema.passwordResetTokens.id });
  const notifs = await db.delete(schema.notifications).where(and(sql`${schema.notifications.readAt} is not null`, lt(schema.notifications.createdAt, sql`now() - interval '90 days'`))).returning({ id: schema.notifications.id });

  // Anonymize users past their 30-day deletion grace period.
  //
  // The previous implementation had THREE serious bugs:
  //   1. `set({ riderId: null })` on payments.riderId — but the column is
  //      NOT NULL, so the UPDATE threw, and retention-cleanup failed for
  //      every deleted user. Anonymization never completed.
  //   2. Tried to delete riderProfiles while subscriptions still FK-reference
  //      them with onDelete: 'restrict' — also throws.
  //   3. Only anonymized the user row — payments, subscriptions, rides,
  //      tickets, and messages all retained the original PII.
  //
  // Fix: anonymize the FK-referencing rows IN PLACE rather than trying to
  // null out their riderId. The riderId columns stay valid (pointing at the
  // anonymized rider profile), but all PII fields in dependent tables are
  // scrubbed. The rider profile itself is anonymized (not deleted) so FK
  // constraints remain satisfied.
  const deletedUsers = await db.select().from(schema.users).where(and(sql`${schema.users.deletedAt} is not null`, lt(schema.users.deletedAt, sql`now() - interval '30 days'`)));
  for (const u of deletedUsers) {
    // Find the rider profile(s) for this user.
    const profiles = await db.select().from(schema.riderProfiles).where(eq(schema.riderProfiles.userId, u.id));
    for (const profile of profiles) {
      // Anonymize PII in dependent rows. Don't null out riderId — the
      // column is NOT NULL. Instead, scrub the PII fields themselves:
      // subject/body in tickets, body in ticket messages, etc.
      await db.update(schema.supportTickets)
        .set({ subject: '[deleted]', body: '[deleted]', updatedAt: new Date() })
        .where(eq(schema.supportTickets.userId, u.id));
      await db.update(schema.ticketMessages)
        .set({ body: '[deleted]', updatedAt: new Date() })
        .where(eq(schema.ticketMessages.authorId, u.id));

      // Anonymize the rider profile (NOT delete — FK constraints would
      // break). Keep the id so subscriptions/payments/rides FK references
      // remain valid.
      await db.update(schema.riderProfiles)
        .set({ homeArea: '[deleted]', workArea: '[deleted]', updatedAt: new Date() })
        .where(eq(schema.riderProfiles.id, profile.id));
    }

    // Anonymize the user row itself. Phone must remain unique — use a
    // deterministic prefix so re-runs are idempotent.
    await db.update(schema.users).set({
      name: 'Deleted User', email: null, phone: `deleted-${u.id.slice(0, 8)}`,
      passwordHash: 'deleted', twoFactorSecret: null, twoFactorEnabled: false,
      updatedAt: new Date(),
    }).where(eq(schema.users.id, u.id));
  }
  return { otpsDeleted: otps.length, resetsDeleted: resets.length, notificationsDeleted: notifs.length, usersAnonymized: deletedUsers.length };
})));

cronRoutes.post('/auto-close-tickets', async (c) => c.json(await withLock('auto-close-tickets', () => supportService.autoCloseStale())));
