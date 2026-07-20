import { sql } from 'drizzle-orm';
import { db, schema, type Db } from '@addis/db';
import { writeAudit } from '../modules/admin/audit';

export async function withLock<T>(name: string, fn: () => Promise<T>): Promise<
  | { ok: true; result: T; at: string }
  | { skipped: true; reason: 'lock-held' }
> {
  return db.transaction(async (tx) => {
    const lockResult = await tx.execute(sql`select pg_try_advisory_xact_lock(hashtext(${name})) as locked`);

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

export const CRON_JOBS: ReadonlyArray<{
  name: string;

  route: string;

  intervalMs: number;
  run: () => Promise<unknown>;
}> = [
  {
    name: 'expire-subscriptions',
    route: 'expire-subscriptions',
    intervalMs: 60 * 60_000,
    run: async () => {
      const { subscriptionRepo } = await import('../modules/subscription/repository');
      return subscriptionRepo.expireDue();
    },
  },
  {
    name: 'expire-seat-releases',
    route: 'expire-seat-releases',
    intervalMs: 15 * 60_000,
    run: async () => {
      const { and, eq, lt } = await import('drizzle-orm');

      const expired = await db.update(schema.seatReleases)
        .set({ status: 'expired', updatedAt: new Date() })
        .where(and(eq(schema.seatReleases.status, 'open'), lt(schema.seatReleases.expiresAt, new Date())))
        .returning({ id: schema.seatReleases.id, riderId: schema.seatReleases.riderId });
      if (expired.length > 0) {
        await db.insert(schema.outboxEvents).values(
          expired.map(r => ({ channel: 'notification' as const, payload: { type: 'seat_release_expired', userId: r.riderId, releaseId: r.id } })),
        );
      }

      const staleClaims = await db.select().from(schema.seatReleases)
        .where(and(
          eq(schema.seatReleases.status, 'claimed'),
          lt(schema.seatReleases.updatedAt, new Date(Date.now() - 30 * 60_000)),
        ))
        .limit(50);
      for (const release of staleClaims) {
        await db.transaction(async (tx) => {

          const [claim] = await tx.select().from(schema.seatClaims)
            .where(eq(schema.seatClaims.seatReleaseId, release.id))
            .limit(1);
          if (!claim) return;
          const [payment] = await tx.select().from(schema.payments)
            .where(eq(schema.payments.seatClaimId, claim.id))
            .limit(1);
          if (!payment || payment.status !== 'pending') return;
          await tx.update(schema.seatReleases).set({ status: 'open', updatedAt: new Date() }).where(eq(schema.seatReleases.id, release.id));
          await tx.update(schema.seatClaims).set({ status: 'refunded', updatedAt: new Date() }).where(eq(schema.seatClaims.id, claim.id));
          await tx.update(schema.payments).set({ status: 'failed', updatedAt: new Date() }).where(eq(schema.payments.id, payment.id));
        });
      }
      return { expired: expired.length, abandonedReverted: staleClaims.length };
    },
  },
  {
    name: 'cleanup-pending-subscriptions',
    route: 'cleanup-pending-subscriptions',
    intervalMs: 30 * 60_000,
    run: async () => {
      const { subscriptionRepo } = await import('../modules/subscription/repository');
      return subscriptionRepo.cancelStalePending();
    },
  },
  {
    name: 'process-refund-retries',
    route: 'process-refund-retries',
    intervalMs: 15 * 60_000,
    run: async () => {
      const { processRefundRetries } = await import('../modules/payment/service');
      return processRefundRetries();
    },
  },
  {
    name: 'reconcile-payments',
    route: 'reconcile-payments',
    intervalMs: 30 * 60_000,
    run: async () => {
      const { and, eq, lt } = await import('drizzle-orm');
      const { getPaymentProvider } = await import('@addis/payments');
      const { settlePayment, failPayment } = await import('../modules/payment/service');
      const stale = await db.select().from(schema.payments)
        .where(and(eq(schema.payments.status, 'pending'), eq(schema.payments.method, 'telebirr'), lt(schema.payments.createdAt, sql`now() - interval '1 hour'`)));
      let settled = 0, failedCount = 0, skippedNoAmount = 0;
      for (const p of stale) {
        const result = await getPaymentProvider('telebirr').verifyPayment(p.reference);
        if (result.status === 'completed') {

          if (!result.amount) {
            console.error(
              `[reconcile-payments] paymentId=${p.id} reference=${p.reference} provider returned completed status but no amount — refusing to settle without amount verification`,
            );
            await db.insert(schema.outboxEvents).values({
              channel: 'audit',
              payload: { action: 'payment.reconcile_skipped_no_amount', entityId: p.id, reference: p.reference },
            });
            skippedNoAmount++;
            continue;
          }
          await settlePayment(p.reference, result.amount);
          settled++;
        }
        else if (result.status === 'failed') { await failPayment(p.reference, result.raw); failedCount++; }
      }
      return { checked: stale.length, settled, failed: failedCount, skippedNoAmount };
    },
  },
  {
    name: 'cleanup-stale-payments',
    route: 'cleanup-stale-payments',
    intervalMs: 60 * 60_000,
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
    intervalMs: 60 * 60_000,
    run: async () => {
      const { and, eq, sql, not, exists } = await import('drizzle-orm');

      const rows = await db.select().from(schema.subscriptions)
        .where(and(
          eq(schema.subscriptions.status, 'active'),
          sql`${schema.subscriptions.endDate} between now() + interval '2 days' and now() + interval '3 days'`,

          not(exists(
            sql`SELECT 1 FROM outbox_events
                WHERE outbox_events.channel = 'notification'
                  AND outbox_events.created_at > now() - interval '24 hours'
                  AND outbox_events.payload->>'type' = 'subscription_expiring'
                  AND outbox_events.payload->>'subscriptionId' = ${schema.subscriptions.id}`
          )),
        ));
      for (const sub of rows) {
        await db.insert(schema.outboxEvents).values({
          channel: 'notification',
          payload: { type: 'subscription_expiring', userId: sub.riderId, subscriptionId: sub.id, daysLeft: 2 },
        });
      }
      return { notified: rows.length };
    },
  },
  {
    name: 'corporate-reset-monthly',
    route: 'corporate-reset-monthly',
    intervalMs: 24 * 3600_000,
    run: async () => {
      const { lt } = await import('drizzle-orm');

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
    },
  },
  {
    name: 'retention-cleanup',
    route: 'retention-cleanup',
    intervalMs: 24 * 3600_000,
    run: async () => {
      const { and, eq, lt, sql } = await import('drizzle-orm');
      const otps = await db.delete(schema.otpCodes).where(lt(schema.otpCodes.createdAt, sql`now() - interval '7 days'`)).returning({ id: schema.otpCodes.id });
      // DB-007: password_reset_tokens table dropped — password reset uses
      // otp_codes with purpose='password_reset', pruned by the line above.
      const notifs = await db.delete(schema.notifications).where(and(sql`${schema.notifications.readAt} is not null`, lt(schema.notifications.createdAt, sql`now() - interval '90 days'`))).returning({ id: schema.notifications.id });

      const sessions = await db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, sql`now()`)).returning({ id: schema.sessions.id });

      const idempotency = await db.delete(schema.idempotencyRecords).where(lt(schema.idempotencyRecords.expiresAt, sql`now()`)).returning({ key: schema.idempotencyRecords.key });

      const deletedUsers = await db.select().from(schema.users).where(and(sql`${schema.users.deletedAt} is not null`, lt(schema.users.deletedAt, sql`now() - interval '30 days'`)));
      for (const u of deletedUsers) {
        const profiles = await db.select().from(schema.riderProfiles).where(eq(schema.riderProfiles.userId, u.id));
        for (const profile of profiles) {

          await db.update(schema.supportTickets)
            .set({ subject: '[deleted]', body: '[deleted]', updatedAt: new Date() })
            .where(eq(schema.supportTickets.userId, u.id));
          await db.update(schema.ticketMessages)
            .set({ body: '[deleted]' })
            .where(eq(schema.ticketMessages.authorId, u.id));

          await db.update(schema.riderProfiles)
            .set({ homeArea: '[deleted]', workArea: '[deleted]', updatedAt: new Date() })
            .where(eq(schema.riderProfiles.id, profile.id));
        }

        await db.update(schema.users).set({
          name: 'Deleted User', email: null, phone: `deleted-${u.id.slice(0, 8)}`,
          passwordHash: 'deleted', twoFactorSecret: null, twoFactorEnabled: false,
          updatedAt: new Date(),
        }).where(eq(schema.users.id, u.id));
      }
      return {
        otpsDeleted: otps.length,
        notificationsDeleted: notifs.length, sessionsDeleted: sessions.length,
        idempotencyDeleted: idempotency.length, usersAnonymized: deletedUsers.length,
      };
    },
  },
  {
    name: 'auto-close-tickets',
    route: 'auto-close-tickets',
    intervalMs: 60 * 60_000,
    run: async () => {
      const { supportService } = await import('../modules/support/service');
      return supportService.autoCloseStale();
    },
  },
  {
    name: 'reconcile-claims',
    route: 'reconcile-claims',
    intervalMs: 30 * 60_000,
    run: async () => {
      const { and, eq, sql } = await import("drizzle-orm");

      const { marketplaceService } = await import('../modules/marketplace/service');
      const claims = await db.select().from(schema.payments)
        .where(and(
          eq(schema.payments.status, 'completed'),
          sql`${schema.payments.seatClaimId} IS NOT NULL`,
          sql`NOT EXISTS (
            SELECT 1 FROM refund_retries WHERE payment_id = ${schema.payments.id}
          )`,
        ));
      let reconciled = 0;
      for (const p of claims) {
        try {
          await marketplaceService.onClaimPaymentSettled(p.seatClaimId!);
          reconciled++;
        } catch (err) {
          console.error('[reconcile-claims] failed', { paymentId: p.id, seatClaimId: p.seatClaimId, err });
        }
      }
      return { checked: claims.length, reconciled };
    },
  },
  {

    name: 'archive-old-records',
    route: 'archive-old-records',
    intervalMs: 24 * 3600_000,
    run: async () => {
      const { and, lt, sql, inArray } = await import('drizzle-orm');
      const { s3 } = await import('../infra/s3');
      const SEVEN_YEARS_AGO = sql`now() - interval '7 years'`;
      const result: Record<string, number> = {};

      try {
        const oldAudit = await db.select().from(schema.auditLogs)
          .where(lt(schema.auditLogs.createdAt, SEVEN_YEARS_AGO))
          .limit(1000);
        if (oldAudit.length > 0) {
          const jsonl = oldAudit.map(r => JSON.stringify(r)).join('\n');
          const archiveKey = `archive/audit_logs/${new Date().toISOString().slice(0, 10)}-${Date.now()}.jsonl`;
          await s3.putObject(archiveKey, Buffer.from(jsonl, 'utf-8'), 'application/x-jsonlines');

          await db.transaction(async (tx) => {

            await tx.execute(sql`SET LOCAL app.audit_retention_purge = 'on'`);
            await tx.delete(schema.auditLogs).where(
              inArray(schema.auditLogs.id, oldAudit.map(r => r.id))
            );

            await tx.insert(schema.outboxEvents).values({
              channel: 'audit',
              payload: { action: 'retention.archived', entityType: 'audit_logs', count: oldAudit.length, archiveKey },
            });
          });
          result.auditLogsArchived = oldAudit.length;
        }
      } catch (err) {

        console.error('[archive-old-records] audit_logs failed:', (err as Error).message);
      }

      try {
        const oldNotify = await db.select().from(schema.telebirrNotifyEvents)
          .where(lt(schema.telebirrNotifyEvents.receivedAt, SEVEN_YEARS_AGO))
          .limit(1000);
        if (oldNotify.length > 0) {
          const jsonl = oldNotify.map(r => JSON.stringify(r)).join('\n');
          const archiveKey = `archive/telebirr_notify/${new Date().toISOString().slice(0, 10)}-${Date.now()}.jsonl`;
          await s3.putObject(archiveKey, Buffer.from(jsonl, 'utf-8'), 'application/x-jsonlines');
          await db.delete(schema.telebirrNotifyEvents).where(
            inArray(schema.telebirrNotifyEvents.merchOrderId, oldNotify.map(r => r.merchOrderId))
          );
          result.telebirrNotifyArchived = oldNotify.length;
        }
      } catch (err) {
        console.error('[archive-old-records] telebirr_notify_events failed:', (err as Error).message);
      }

      try {
        const oldTickets = await db.delete(schema.supportTickets)
          .where(lt(schema.supportTickets.createdAt, SEVEN_YEARS_AGO))
          .returning({ id: schema.supportTickets.id });
        result.supportTicketsDeleted = oldTickets.length;
      } catch (err) {
        console.error('[archive-old-records] support_tickets failed:', (err as Error).message);
      }

      try {
        const oldDocs = await db.select().from(schema.contractorDocuments)
          .where(lt(schema.contractorDocuments.uploadedAt, SEVEN_YEARS_AGO))
          .limit(200);
        for (const doc of oldDocs) {
          try { await s3.deleteObject(doc.storageKey); } catch {  }
        }
        if (oldDocs.length > 0) {
          await db.delete(schema.contractorDocuments).where(
            inArray(schema.contractorDocuments.id, oldDocs.map(d => d.id))
          );
        }
        result.contractorDocsDeleted = oldDocs.length;
      } catch (err) {
        console.error('[archive-old-records] contractor_documents failed:', (err as Error).message);
      }

      try {
        const oldPayments = await db.update(schema.payments)
          .set({
            reference: sql`concat('[archived-', EXTRACT(YEAR FROM ${schema.payments.createdAt})::text, ']')`,
            prepayId: null,
            updatedAt: new Date(),
          })
          .where(and(
            lt(schema.payments.retentionExpiresAt, sql`now()`),
            sql`reference NOT LIKE '[archived-%'`,
          ))
          .returning({ id: schema.payments.id });
        result.paymentsAnonymized = oldPayments.length;
      } catch (err) {
        console.error('[archive-old-records] payments failed:', (err as Error).message);
      }

      try {
        const oldSubs = await db.update(schema.subscriptions)
          .set({ morningSlot: null, eveningSlot: null, updatedAt: new Date() })
          .where(and(
            lt(schema.subscriptions.endDate, SEVEN_YEARS_AGO),
            sql`${schema.subscriptions.morningSlot} IS NOT NULL OR ${schema.subscriptions.eveningSlot} IS NOT NULL`,
          ))
          .returning({ id: schema.subscriptions.id });
        result.subscriptionsAnonymized = oldSubs.length;
      } catch (err) {
        console.error('[archive-old-records] subscriptions failed:', (err as Error).message);
      }

      try {
        const oldRides = await db.update(schema.rides)
          .set({ pickupStop: null, updatedAt: new Date() })
          .where(and(
            lt(schema.rides.createdAt, SEVEN_YEARS_AGO),
            sql`${schema.rides.pickupStop} IS NOT NULL`,
          ))
          .returning({ id: schema.rides.id });
        result.ridesAnonymized = oldRides.length;
      } catch (err) {
        console.error('[archive-old-records] rides failed:', (err as Error).message);
      }

      return result;
    },
  },
  {

    name: 'anchor-audit-chain',
    route: 'anchor-audit-chain',
    intervalMs: 60 * 60_000,
    run: async () => {
      const { anchorAuditChain } = await import('../modules/admin/audit');
      return anchorAuditChain();
    },
  },
  {

    name: 'cleanup-old-outbox-and-notifications',
    route: 'cleanup-old-outbox-and-notifications',
    intervalMs: 24 * 60 * 60_000,
    run: async () => {
      const { lt } = await import('drizzle-orm');
      const NINETY_DAYS_AGO = sql`now() - interval '90 days'`;

      const outbox = await db.delete(schema.outboxEvents).where(
        sql`${schema.outboxEvents.status} in ('delivered', 'failed', 'permanent_failure') AND ${schema.outboxEvents.createdAt} < ${NINETY_DAYS_AGO}`,
      ).returning({ id: schema.outboxEvents.id });

      const notif = await db.delete(schema.notificationLog).where(
        lt(schema.notificationLog.sentAt, NINETY_DAYS_AGO as any),
      ).returning({ id: schema.notificationLog.id });
      return { outboxPruned: outbox.length, notificationLogPruned: notif.length };
    },
  },
  {

    name: 'verify-audit-chain-anchors',
    route: 'verify-audit-chain-anchors',
    intervalMs: 24 * 60 * 60_000,
    run: async () => {
      const { verifyAuditChainWithAnchors } = await import('../modules/admin/audit');
      const result = await verifyAuditChainWithAnchors();
      if (!result.valid) {

        await db.insert(schema.outboxEvents).values({
          channel: 'audit',
          payload: { action: 'audit_chain_tamper_detected', result },
        });
        console.error('[verify-audit-chain-anchors] TAMPER DETECTED:', JSON.stringify(result));
      }
      return result;
    },
  },
];

export const CRON_JOBS_BY_NAME: ReadonlyMap<string, (typeof CRON_JOBS)[number]> = new Map(
  CRON_JOBS.map((j) => [j.name, j]),
);
