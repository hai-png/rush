import { createHash } from 'node:crypto';
import { desc, sql } from 'drizzle-orm';
import { db, schema } from '@addis/db';

// Constant lock key for the audit chain. Any two writers taking this lock within the same
// transaction are fully serialized against each other for its duration.
const AUDIT_CHAIN_LOCK_KEY = 'addis_ride_audit_chain';

/** The single writer for audit rows. Enforces hash-chaining so tampering is detectable. */
/**
 * Audit entry. Fields with `| undefined` are explicitly optional under
 * exactOptionalPropertyTypes — callers routinely pass `ipAddress: undefined` from
 * `c.req.header('x-forwarded-for') ?? undefined`, which the bare `?` form rejects.
 */
export interface AuditEntry {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null | undefined;
  before?: unknown;
  after?: unknown;
  ipAddress?: string | null | undefined;
  userAgent?: string | null | undefined;
}

export async function writeAudit(tx: typeof db, entry: AuditEntry) {
  // Without this lock, two concurrent writeAudit calls in separate transactions can both read
  // the same "last" row before either commits, both compute a hash chained off the same
  // prevHash, and both insert — forking the tamper-evident chain (or making verifyAuditChain's
  // createdAt-only ordering ambiguous for same-timestamp rows). This must be called inside the
  // same transaction (`tx`) that performs the insert so the lock is held for its duration.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${AUDIT_CHAIN_LOCK_KEY}))`);

  const [last] = await tx.select().from(schema.auditLogs).orderBy(desc(schema.auditLogs.createdAt)).limit(1);
  const prevHash = last?.hash ?? 'GENESIS';
  const payload = JSON.stringify({ ...entry, prevHash });
  const hash = createHash('sha256').update(payload).digest('hex');
  const [row] = await tx.insert(schema.auditLogs).values({ ...entry, prevHash, hash }).returning();
  return row;
}

/** Verifies the entire chain (or a window) — used by the audit-log integrity job / admin UI. */
export async function verifyAuditChain(limit = 10_000) {
  // Order by createdAt with `id` as a tiebreaker: rows can share a createdAt timestamp
  // (millisecond collisions under load), and Postgres does not guarantee a stable secondary
  // order without an explicit tiebreaker — without one, verification could iterate rows in a
  // different order than they were actually chained and report a false tamper detection.
  const rows = await db.select().from(schema.auditLogs).orderBy(schema.auditLogs.createdAt, schema.auditLogs.id).limit(limit);
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
