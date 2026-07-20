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
