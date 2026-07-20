/**
 * Audit outbox handler.
 *
 * FIX (INFRA-003): the previous version of this handler was a no-op that only
 * `console.log`'d the payload. That meant any code path that raised an audit
 * outbox event (e.g. `payment.reconcile_skipped_no_amount`,
 * `retention.archived`, `refund.scheduled`, `admin.csv_export`) never actually
 * wrote a row to `audit_logs` — the action was effectively unaudited. The
 * synchronous `writeAudit()` calls inside HTTP request transactions still
 * worked, but every outbox-routed audit event was silently dropped.
 *
 * Now this handler materializes the outbox payload into an `audit_logs` row via
 * the same `writeAudit()` writer used by the synchronous path. This keeps the
 * hash-chained audit log consistent regardless of which path the event took.
 *
 * Idempotency: the outbox delivery is at-least-once. If a worker crashes after
 * `writeAudit()` commits but before the outbox row is marked 'delivered', the
 * next worker that picks up the row would re-write a duplicate audit entry —
 * corrupting the hash chain's "one row per event" invariant and creating
 * duplicate rows that confuse the audit UI. We prevent that by stamping the
 * outbox event id into the audit row's `after` payload and checking for an
 * existing row with that stamp before inserting.
 *
 * NOTE (INFRA-009): only the audit channel gets full idempotency in this round.
 * The sms/email/push/notification handlers still lack idempotency — a durable
 * `notification_log` table is deferred to follow-up 3.
 */
import { sql } from 'drizzle-orm';
import { db, schema } from '@addis/db';
import { writeAudit } from '@addis/api/modules/admin/audit';

type OutboxEvent = typeof schema.outboxEvents.$inferSelect;

interface AuditPayload {
  action: string;
  actorId?: string | null;
  entityType?: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
  [k: string]: unknown;
}

export async function handle(payload: AuditPayload, evt?: OutboxEvent) {
  // Idempotency: skip if a previous delivery of this same outbox event already
  // wrote an audit row. We stamp the outbox event id into the audit row's
  // `after` JSONB as `outboxEventId` and look it up via a JSONB containment
  // check. The audit_logs table has no dedicated outboxEventId column (the
  // append-only trigger + hash chain make schema changes awkward), so the
  // JSONB path is the pragmatic choice — it's covered by the existing
  // actionIdx and createdIdx indexes for the common "list recent audits" path.
  const outboxEventId = evt?.id;
  if (outboxEventId) {
    const existing = await db.execute(sql`
      SELECT 1 FROM audit_logs
      WHERE after @> ${JSON.stringify({ outboxEventId })}::jsonb
      LIMIT 1
    `);
    const rows = existing as unknown as Array<{ '?column?'?: number }>;
    if (Array.isArray(rows) && rows.length > 0) {
      if (process.env.NODE_ENV !== 'test') {
        console.log(`[audit-outbox] skipping duplicate delivery for outboxEventId=${outboxEventId}`);
      }
      return;
    }
  }

  // Materialize the payload into an audit_logs row. We stamp the outbox event
  // id into `after` so future duplicate deliveries can be detected (above).
  // Wrap in a transaction so writeAudit's advisory lock + insert commits
  // atomically with the idempotency stamp.
  await db.transaction(async (tx) => {
    await writeAudit(tx as unknown as typeof db, {
      actorId: payload.actorId ?? null,
      action: payload.action,
      entityType: payload.entityType ?? 'outbox',
      entityId: payload.entityId ?? null,
      before: payload.before,
      after: { ...(payload.after as Record<string, unknown> | undefined), outboxEventId },
      ipAddress: payload.ipAddress ?? null,
      userAgent: payload.userAgent ?? null,
    });
  });

  if (process.env.NODE_ENV !== 'test') {
    console.log(`[audit-outbox] ${payload.action} entityId=${payload.entityId ?? '-'} outboxEventId=${outboxEventId ?? '-'}`);
  }
}
