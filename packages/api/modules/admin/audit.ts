import { createHash } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import { db, schema } from '@addis/db';

/** The single writer for audit rows. Enforces hash-chaining so tampering is detectable. */
export async function writeAudit(tx: typeof db, entry: {
  actorId: string | null; action: string; entityType: string; entityId?: string | null;
  before?: unknown; after?: unknown; ipAddress?: string | null; userAgent?: string | null;
}) {
  const [last] = await tx.select().from(schema.auditLogs).orderBy(desc(schema.auditLogs.createdAt)).limit(1);
  const prevHash = last?.hash ?? 'GENESIS';
  const payload = JSON.stringify({ ...entry, prevHash });
  const hash = createHash('sha256').update(payload).digest('hex');
  const [row] = await tx.insert(schema.auditLogs).values({ ...entry, prevHash, hash }).returning();
  return row;
}

/** Verifies the entire chain (or a window) — used by the audit-log integrity job / admin UI. */
export async function verifyAuditChain(limit = 10_000) {
  const rows = await db.select().from(schema.auditLogs).orderBy(schema.auditLogs.createdAt).limit(limit);
  let prevHash = 'GENESIS';
  for (const row of rows) {
    const payload = JSON.stringify({
      actorId: row.actorId, action: row.action, entityType: row.entityType, entityId: row.entityId,
      before: row.before, after: row.after, ipAddress: row.ipAddress, userAgent: row.userAgent, prevHash,
    });
    const expected = createHash('sha256').update(payload).digest('hex');
    if (expected !== row.hash) return { valid: false, brokenAt: row.id };
    prevHash = row.hash;
  }
  return { valid: true };
}
