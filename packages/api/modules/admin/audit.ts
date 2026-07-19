import { createHash } from 'node:crypto';
import { desc, sql } from 'drizzle-orm';
import { db, schema } from '@addis/db';

// Constant lock key for the audit chain. Any two writers taking this lock within the same
// transaction are fully serialized against each other for its duration.
const AUDIT_CHAIN_LOCK_KEY = 'addis_ride_audit_chain';

// Fields that must never end up in the audit log's `before`/`after` payload —
// either because they're credential material (passwordHash, twoFactorSecret)
// or because they're so sensitive that even auditors shouldn't see them
// (full tokens). The previous writeAudit() spread the entire row into
// `before`/`after`, meaning every role-change audit row contained the user's
// bcrypt hash and TOTP secret in cleartext — a credential leak via audit log.
const SANITIZE_FIELDS = [
  'passwordHash', 'twoFactorSecret', 'twoFactorEnabled',
  'accessToken', 'refreshToken', 'devCode',
  'sessionToken', 'cookie',
];

function sanitize(value: unknown): unknown {
  if (value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sanitize);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SANITIZE_FIELDS.some(f => k.toLowerCase().includes(f.toLowerCase()))) continue;
    out[k] = sanitize(v);
  }
  return out;
}

/**
 * Normalize undefined → null before JSON.stringify. `JSON.stringify({a: undefined})`
 * produces `{"a":...}` (omitted), but when Postgres returns the row, optional
 * columns come back as `null`. The hash chain then breaks because the
 * verification side computes the payload with `a: null` while the write side
 * computed it with `a` omitted — different strings, different hashes,
 * false-positive tamper alarm.
 */
function normalizeForHash(value: unknown): unknown {
  if (value === undefined) return null;
  if (Array.isArray(value)) return value.map(normalizeForHash);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = normalizeForHash(v);
    }
    return out;
  }
  return value;
}

/** The single writer for audit rows. Enforces hash-chaining so tampering is detectable. */
export async function writeAudit(tx: typeof db, entry: {
  actorId: string | null; action: string; entityType: string; entityId?: string | null;
  before?: unknown; after?: unknown; ipAddress?: string | null; userAgent?: string | null;
}) {
  // Without this lock, two concurrent writeAudit calls in separate transactions can both read
  // the same "last" row before either commits, both compute a hash chained off the same
  // prevHash, and both insert — forking the tamper-evident chain (or making verifyAuditChain's
  // createdAt-only ordering ambiguous for same-timestamp rows). This must be called inside the
  // same transaction (`tx`) that performs the insert so the lock is held for its duration.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${AUDIT_CHAIN_LOCK_KEY}))`);

  // Use (createdAt desc, id desc) — the same tiebreaker verifyAuditChain uses
  // forward. The previous `orderBy(desc(createdAt)).limit(1)` had no
  // tiebreaker, so two rows written in the same millisecond could chain off
  // whichever Postgres happened to return first — and verifyAuditChain's
  // forward (createdAt asc, id asc) order could iterate them in the opposite
  // direction, computing a different hash and reporting a false tamper.
  const [last] = await tx.select().from(schema.auditLogs)
    .orderBy(desc(schema.auditLogs.createdAt), desc(schema.auditLogs.id))
    .limit(1);
  const prevHash = last?.hash ?? 'GENESIS';

  // Sanitize (strip credential material) and normalize (undefined→null) so the
  // hash is stable against Postgres's null-returning behavior for optional
  // columns and so no secrets land in the audit log.
  const sanitizedEntry = {
    actorId: entry.actorId ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    before: sanitize(entry.before ?? null),
    after: sanitize(entry.after ?? null),
    ipAddress: entry.ipAddress ?? null,
    userAgent: entry.userAgent ?? null,
    prevHash,
  };
  const payload = JSON.stringify(normalizeForHash(sanitizedEntry));
  const hash = createHash('sha256').update(payload).digest('hex');
  const [row] = await tx.insert(schema.auditLogs).values({
    actorId: sanitizedEntry.actorId,
    action: sanitizedEntry.action,
    entityType: sanitizedEntry.entityType,
    entityId: sanitizedEntry.entityId,
    before: sanitizedEntry.before,
    after: sanitizedEntry.after,
    ipAddress: sanitizedEntry.ipAddress,
    userAgent: sanitizedEntry.userAgent,
    prevHash, hash,
  }).returning();
  return row;
}

/** Verifies the entire chain (or a window) — used by the audit-log integrity job / admin UI. */
export async function verifyAuditChain(limit = 10_000) {
  // Order by createdAt with `id` as a tiebreaker: rows can share a createdAt timestamp
  // (millisecond collisions under load), and Postgres does not guarantee a stable secondary
  // order without an explicit tiebreaker — without one, verification could iterate rows in a
  // different order than they were actually chained and report a false tamper detection.
  // Must match the (desc, desc) write order reversed to (asc, asc).
  const rows = await db.select().from(schema.auditLogs)
    .orderBy(schema.auditLogs.createdAt, schema.auditLogs.id)
    .limit(limit);
  let prevHash = 'GENESIS';
  for (const row of rows) {
    const sanitized = {
      actorId: row.actorId,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId ?? null,
      before: sanitize(row.before ?? null),
      after: sanitize(row.after ?? null),
      ipAddress: row.ipAddress ?? null,
      userAgent: row.userAgent ?? null,
      prevHash,
    };
    const expected = createHash('sha256').update(JSON.stringify(normalizeForHash(sanitized))).digest('hex');
    if (expected !== row.hash) return { valid: false, brokenAt: row.id };
    prevHash = row.hash;
  }
  return { valid: true };
}
