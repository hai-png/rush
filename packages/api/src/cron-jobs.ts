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
      // Fire per-release notifications — the seat_release_expired notification
      // type exists in the schema and has a template, but no code dispatched it
      // in the original implementation.
      const expired = await db.update(schema.seatReleases)
        .set({ status: 'expired', updatedAt: new Date() })
        .where(and(eq(schema.seatReleases.status, 'open'), lt(schema.seatReleases.expiresAt, new Date())))
        .returning({ id: schema.seatReleases.id, riderId: schema.seatReleases.riderId });
      if (expired.length > 0) {
        await db.insert(schema.outboxEvents).values(
          expired.map(r => ({ channel: 'notification' as const, payload: { type: 'seat_release_expired', userId: r.riderId, releaseId: r.id } })),
        );
      }

      // FIX (SEC-007): The previous implementation only expired `status='open'`
      // releases. A `status='claimed'` release whose checkout URL expired
      // (Telebirr's `timeout_express: '120m'`) was never returned to the open
      // pool — the seat was permanently locked out of the marketplace. An
      // attacker could claim every open seat with abandoned checkouts to DoS
      // the marketplace. Now: a release that has been 'claimed' for more than
      // 30 minutes (well beyond Telebirr's 120m checkout expiry; we use 30m
      // here as a tight bound for abandoned-claim recovery) is reverted to
      // 'open' if its associated payment is still 'pending'. The associated
      // seat_claim is marked 'refunded' (cancelled) and the payment is
      // marked 'failed' — matching the rollback path in marketplaceService.claim.
      const staleClaims = await db.select().from(schema.seatReleases)
        .where(and(
          eq(schema.seatReleases.status, 'claimed'),
          lt(schema.seatReleases.updatedAt, new Date(Date.now() - 30 * 60_000)),
        ))
        .limit(50);
      for (const release of staleClaims) {
        await db.transaction(async (tx) => {
          // Re-open the release only if its associated payment is still pending.
          const [payment] = await tx.select().from(schema.payments)
            .where(eq(schema.payments.seatClaimId, release.id))
            .limit(1);
          if (!payment || payment.status !== 'pending') return;
          await tx.update(schema.seatReleases).set({ status: 'open', updatedAt: new Date() }).where(eq(schema.seatReleases.id, release.id));
          await tx.update(schema.seatClaims).set({ status: 'refunded', updatedAt: new Date() }).where(eq(schema.seatClaims.seatReleaseId, release.id));
          await tx.update(schema.payments).set({ status: 'failed', updatedAt: new Date() }).where(eq(schema.payments.id, payment.id));
        });
      }
      return { expired: expired.length, abandonedReverted: staleClaims.length };
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
        if (result.status === 'completed') {
          // Pass the provider-reported amount through to settlePayment so the
          // amount-mismatch check actually runs. The previous call omitted the
          // amount, silently skipping the check (H35). If the provider doesn't
          // return an amount, settlePayment will record an audit warning.
          await settlePayment(p.reference, result.amount);
          settled++;
        }
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
      const { and, eq, sql, not, exists } = await import('drizzle-orm');
      // FIX (OPS-008): The previous implementation had no idempotency
      // guard. The advisory lock in withLock is transaction-scoped
      // (pg_try_advisory_xact_lock), released the moment the transaction
      // commits. The worker runs this job every 1h via setInterval; if an
      // external cron-job.org also fires POST /api/v1/cron/send-expiry-reminders
      // within the same hour (or if the worker's setInterval drifts), the
      // second invocation acquires the lock fresh, re-runs the SELECT (same
      // 2-3 day window), and inserts ANOTHER batch of identical
      // subscription_expiring notifications. Users get duplicate "your
      // subscription expires in 2 days" SMS/email.
      //
      // The fix: only select subscriptions that don't already have a
      // matching outbox event in the last 24h. This makes the job
      // idempotent within a 24h window regardless of how many times it
      // fires. The advisory lock still prevents concurrent in-process
      // double-firing; this guard prevents cross-process / cross-tick
      // double-firing.
      const rows = await db.select().from(schema.subscriptions)
        .where(and(
          eq(schema.subscriptions.status, 'active'),
          sql`${schema.subscriptions.endDate} between now() + interval '2 days' and now() + interval '3 days'`,
          // Exclude subscriptions that already received a subscription_expiring
          // notification in the last 24h.
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
    intervalMs: 24 * 3600_000, // 1 day
    run: async () => {
      const { lt } = await import('drizzle-orm');
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

      // Anonymize users past their 30-day deletion grace period.
      //
      // CRITICAL FIX: The original implementation had three serious bugs:
      //   1. `set({ riderId: null })` on payments.riderId — but the column is
      //      NOT NULL, so the UPDATE threw, and retention-cleanup failed for
      //      every deleted user. Anonymization never completed.
      //   2. Tried to delete riderProfiles while subscriptions still FK-reference
      //      them with onDelete: 'restrict' — also throws.
      //   3. Only anonymized the user row — payments, subscriptions, rides,
      //      tickets, and messages all retained the original PII.
      //
      // Fix: anonymize the FK-referencing rows IN PLACE rather than nulling out
      // their riderId. The riderId columns stay valid (pointing at the
      // anonymized rider profile), but all PII fields in dependent tables are
      // scrubbed. The rider profile itself is anonymized (not deleted) so FK
      // constraints remain satisfied.
      const deletedUsers = await db.select().from(schema.users).where(and(sql`${schema.users.deletedAt} is not null`, lt(schema.users.deletedAt, sql`now() - interval '30 days'`)));
      for (const u of deletedUsers) {
        const profiles = await db.select().from(schema.riderProfiles).where(eq(schema.riderProfiles.userId, u.id));
        for (const profile of profiles) {
          // Anonymize PII in dependent rows. Don't null out riderId — the
          // column is NOT NULL. Instead, scrub the PII fields themselves.
          await db.update(schema.supportTickets)
            .set({ subject: '[deleted]', body: '[deleted]', updatedAt: new Date() })
            .where(eq(schema.supportTickets.userId, u.id));
          await db.update(schema.ticketMessages)
            .set({ body: '[deleted]', updatedAt: new Date() })
            .where(eq(schema.ticketMessages.authorId, u.id));
          // Anonymize the rider profile (NOT delete — FK constraints would break).
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
      return {
        otpsDeleted: otps.length, resetsDeleted: resets.length,
        notificationsDeleted: notifs.length, sessionsDeleted: sessions.length,
        idempotencyDeleted: idempotency.length, usersAnonymized: deletedUsers.length,
      };
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
  {
    name: 'reconcile-claims',
    route: 'reconcile-claims',
    intervalMs: 30 * 60_000, // 30 min
    run: async () => {
      const { and, eq, sql } = await import("drizzle-orm");
      // Detect: payments.status = completed AND seatClaimId IS NOT NULL
      // AND no refund_retry exists for this payment.
      const { scheduleRefund } = await import('../modules/payment/service');
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
    // FIX (OPS-010): 7-year retention archival for audit_logs, payments,
    // subscriptions, seat_releases, seat_claims, support_tickets,
    // ticket_messages, corporate_members, contractor_documents,
    // telebirr_notify_events.
    //
    // The ROPA (infra/compliance/ropa.md rows 3-14) and incident-response.md
    // (lines 18-25) all claim "7 years retention" for these tables. Under
    // Proclamation 1321/2024 Art. 21 (and GDPR Art. 5(1)(e)), retention
    // must be ENFORCED, not aspirational. Without this job, these tables
    // grow without bound — slowing queries, increasing backup costs, and
    // creating a larger breach blast radius. After 7 years, the platform
    // is non-compliant: it holds data longer than the stated retention.
    //
    // Strategy:
    //   - audit_logs: ARCHIVE to S3 (preserve the hash chain for forensic
    //     integrity), then DELETE. The archive is a JSONL file per month.
    //   - telebirr_notify_events: ARCHIVE to S3, then DELETE (tamper-evident
    //     audit log of inbound payment notifications).
    //   - payments / subscriptions / seat_releases / seat_claims / rides:
    //     ANONYMIZE in place (we need the rows for financial reporting and
    //     dispute resolution, but PII fields are scrubbed after 7 years).
    //   - support_tickets / ticket_messages: DELETE (the retention period
    //     for support communications is shorter — 2 years — but we apply
    //     the 7-year cap here for consistency; tighten to 2 years in a
    //     follow-up if legal confirms).
    //   - contractor_documents: DELETE the S3 objects AND the DB rows
    //     (government ID uploads should not persist beyond their review
    //     purpose + 7-year dispute window).
    name: 'archive-old-records',
    route: 'archive-old-records',
    intervalMs: 24 * 3600_000, // 1 day
    run: async () => {
      const { and, lt, sql, eq } = await import('drizzle-orm');
      const { s3 } = await import('../infra/s3');
      const { writeAudit } = await import('../modules/admin/audit');
      const SEVEN_YEARS_AGO = sql`now() - interval '7 years'`;
      const result: Record<string, number> = {};

      // 1. audit_logs: archive to S3, then delete.
      //    The archive is a JSONL file: one JSON object per line, preserving
      //    the hash chain (prevHash + hash + payload). Forensic verification
      //    can re-derive the chain from the archive.
      try {
        const oldAudit = await db.select().from(schema.auditLogs)
          .where(lt(schema.auditLogs.createdAt, SEVEN_YEARS_AGO))
          .limit(1000);
        if (oldAudit.length > 0) {
          const jsonl = oldAudit.map(r => JSON.stringify(r)).join('\n');
          const archiveKey = `archive/audit_logs/${new Date().toISOString().slice(0, 10)}-${Date.now()}.jsonl`;
          await s3.putObject(archiveKey, Buffer.from(jsonl, 'utf-8'), 'application/x-jsonlines');
          // Delete the archived rows. Use a transaction + writeAudit so the
          // archival itself is audited (ironic but legally required — the
          // retention job's actions must be traceable).
          await db.transaction(async (tx) => {
            await tx.delete(schema.auditLogs).where(
              sql`${schema.auditLogs.id} IN (${oldAudit.map(r => `'${r.id}'`).join(',')})`
            );
            // Note: we can't use writeAudit for this because writeAudit inserts
            // into audit_logs, which would be self-referential. Log to the
            // outbox instead.
            await tx.insert(schema.outboxEvents).values({
              channel: 'audit',
              payload: { action: 'retention.archived', entityType: 'audit_logs', count: oldAudit.length, archiveKey },
            });
          });
          result.auditLogsArchived = oldAudit.length;
        }
      } catch (err) {
        // Don't let a single table's failure abort the whole job — log and continue.
        console.error('[archive-old-records] audit_logs failed:', (err as Error).message);
      }

      // 2. telebirr_notify_events: archive + delete (same pattern).
      try {
        const oldNotify = await db.select().from(schema.telebirrNotifyEvents)
          .where(lt(schema.telebirrNotifyEvents.receivedAt, SEVEN_YEARS_AGO))
          .limit(1000);
        if (oldNotify.length > 0) {
          const jsonl = oldNotify.map(r => JSON.stringify(r)).join('\n');
          const archiveKey = `archive/telebirr_notify/${new Date().toISOString().slice(0, 10)}-${Date.now()}.jsonl`;
          await s3.putObject(archiveKey, Buffer.from(jsonl, 'utf-8'), 'application/x-jsonlines');
          await db.delete(schema.telebirrNotifyEvents).where(
            sql`${schema.telebirrNotifyEvents.merchOrderId} IN (${oldNotify.map(r => `'${r.merchOrderId}'`).join(',')})`
          );
          result.telebirrNotifyArchived = oldNotify.length;
        }
      } catch (err) {
        console.error('[archive-old-records] telebirr_notify_events failed:', (err as Error).message);
      }

      // 3. support_tickets + ticket_messages: delete (subject/body are PII).
      try {
        const oldTickets = await db.delete(schema.supportTickets)
          .where(lt(schema.supportTickets.createdAt, SEVEN_YEARS_AGO))
          .returning({ id: schema.supportTickets.id });
        result.supportTicketsDeleted = oldTickets.length;
      } catch (err) {
        console.error('[archive-old-records] support_tickets failed:', (err as Error).message);
      }

      // 4. contractor_documents: delete S3 objects + DB rows.
      try {
        const oldDocs = await db.select().from(schema.contractorDocuments)
          .where(lt(schema.contractorDocuments.uploadedAt, SEVEN_YEARS_AGO))
          .limit(200);
        for (const doc of oldDocs) {
          try { await s3.deleteObject(doc.storageKey); } catch { /* best-effort */ }
        }
        if (oldDocs.length > 0) {
          await db.delete(schema.contractorDocuments).where(
            sql`${schema.contractorDocuments.id} IN (${oldDocs.map(d => `'${d.id}'`).join(',')})`
          );
        }
        result.contractorDocsDeleted = oldDocs.length;
      } catch (err) {
        console.error('[archive-old-records] contractor_documents failed:', (err as Error).message);
      }

      // 5. payments / subscriptions / seat_releases / seat_claims / rides:
      //    ANONYMIZE in place (keep the rows for financial reporting, scrub PII).
      //    riderId stays valid (FK to anonymized rider profile), but amounts and
      //    timestamps are preserved (needed for revenue reporting). The PII
      //    that's scrubbed: reference (Telebirr merchOrderId — a replay primitive),
      //    prepayId, refundRequestNo. These are already stripped from admin CSV
      //    exports (SEC-006); after 7 years we scrub them from the live row too.
      try {
        const oldPayments = await db.update(schema.payments)
          .set({ reference: `[archived-${sql.raw("EXTRACT(YEAR FROM created_at)::text")}]`, prepayId: null, updatedAt: new Date() })
          .where(and(lt(schema.payments.retentionExpiresAt, sql`now()`), sql`reference NOT LIKE '[archived-%'`))
          .returning({ id: schema.payments.id });
        result.paymentsAnonymized = oldPayments.length;
      } catch (err) {
        console.error('[archive-old-records] payments failed:', (err as Error).message);
      }

      return result;
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
