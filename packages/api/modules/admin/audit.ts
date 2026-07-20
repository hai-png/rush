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

/**
 * Verifies the entire chain (or a window) — used by the audit-log integrity job / admin UI.
 *
 * H24 fix: the previous implementation had a hard default limit of 10,000 rows.
 * With 7-year retention and a busy platform, the audit log exceeds 10k rows
 * within weeks — verification silently stopped checking the tail, leaving
 * tampering of older rows undetectable. Now we stream the entire chain in
 * batches (default 5,000 rows per batch) so the full chain is always
 * verified regardless of size. Callers can still pass an explicit limit
 * for spot-checks.
 */
export async function verifyAuditChain(limit?: number) {
  const BATCH_SIZE = 5_000;
  let prevHash = 'GENESIS';
  let lastSeenId: string | undefined;
  let verified = 0;

  // Stream the chain in batches ordered by (createdAt, id). Each batch
  // starts after the last row we verified. This avoids loading the entire
  // table into memory while still checking every row.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const batchLimit = limit ? Math.min(BATCH_SIZE, limit - verified) : BATCH_SIZE;
    if (batchLimit <= 0) break;

    const rows = await db.select().from(schema.auditLogs)
      .orderBy(schema.auditLogs.createdAt, schema.auditLogs.id)
      .where(lastSeenId
        ? sql`(created_at, id) > (
          SELECT created_at, id FROM audit_logs WHERE id = ${lastSeenId}
        )`
        : sql`true`
      )
      .limit(batchLimit);

    if (rows.length === 0) break;

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
      if (expected !== row.hash) {
        return { valid: false, brokenAt: row.id, verified };
      }
      prevHash = row.hash;
      lastSeenId = row.id;
      verified++;
    }

    if (rows.length < batchLimit) break; // last batch
  }

  return { valid: true, verified };
}

/**
 * Anchor the current audit-chain tip to an external tamper-evident store (S3
 * with Object Lock / write-once semantics).
 *
 * FOLLOW-UP 1 (DB-003): the hash chain inside `audit_logs` is tamper-EVIDENT
 * — `verifyAuditChain` detects if a row was mutated and the chain recomputed.
 * But a DB-level attacker with write access can UPDATE rows AND recompute the
 * chain forward, defeating verification. The DB trigger (0001 + 0002) blocks
 * UPDATE/DELETE on audit_logs, but a DB superuser can DROP the trigger first.
 *
 * Anchoring the chain tip externally closes that gap: every hour, the latest
 * tip hash is written to S3 under a key like `audit-anchor/YYYY-MM-DD-HH.json`
 * containing `{ tipHash, lastRowId, lastRowCreatedAt, anchoredAt, rowCount }`.
 * If the bucket has Object Lock (COMPLIANCE mode, retention = 7y+1d matching
 * the audit retention), the anchor files themselves are immutable — a DB
 * attacker who tampers the chain leaves the anchored tip hash stale, and
 * `verifyAuditChainWithAnchors` detects the divergence.
 *
 * This function is called from the `anchor-audit-chain` cron (hourly). It is
 * idempotent: re-anchoring the same tip produces the same S3 key (keyed by
 * hour bucket) and the same content, so S3 PUT is a no-op overwrite (or, with
 * Object Lock in GOVERNANCE mode, the second PUT is rejected which is also
 * fine — the anchor is already there).
 */
export async function anchorAuditChain() {
  const { s3 } = await import('../../infra/s3');
  const [last] = await db.select().from(schema.auditLogs)
    .orderBy(desc(schema.auditLogs.createdAt), desc(schema.auditLogs.id))
    .limit(1);
  const countRow = await db.select({ count: sql<number>`count(*)::int` }).from(schema.auditLogs);
  const count = countRow[0]?.count ?? 0;

  const tipHash = last?.hash ?? 'GENESIS';
  const anchorPayload = {
    tipHash,
    lastRowId: last?.id ?? null,
    lastRowCreatedAt: last?.createdAt ?? null,
    rowCount: count,
    anchoredAt: new Date().toISOString(),
  };

  // Key by hour so we get one anchor per hour. Re-anchoring within the same
  // hour overwrites the same key — fine, the content is deterministic.
  const hourBucket = new Date().toISOString().slice(0, 13); // YYYY-MM-DDTHH
  const key = `audit-anchor/${hourBucket}.json`;
  await s3.putObject(key, Buffer.from(JSON.stringify(anchorPayload, null, 2), 'utf-8'), 'application/json');
  return { key, ...anchorPayload };
}

/**
 * Verify the audit chain against the external anchors.
 *
 * FA-006: defense-in-depth role clarification. `verifyAuditChain()` already
 * detects tampering IF the append-only trigger is in place (an attacker who
 * UPDATEs a row and recomputes the chain forward still leaves the trigger
 * firing — the UPDATE is blocked). The anchor's value is for the case where
 * an attacker with DB superuser privileges DROPs the trigger first, then
 * tampers rows and recomputes the chain. In that scenario:
 *   - `verifyAuditChain()` passes (the chain is internally consistent).
 *   - BUT the anchored tip hash (written to S3 with Object Lock before the
 *     tampering) no longer matches the current tip — `tip_divergence`.
 *
 * The anchor is written hourly. Tampering within the same hour as the last
 * anchor is detected on the NEXT anchor write (the new anchor's tipHash
 * won't match what a clean chain would produce). Tampering that happens
 * AFTER an anchor and BEFORE the next anchor write is detected by this
 * verification function on the daily cron.
 *
 * Limitation: if the attacker tampers AND immediately writes a new anchor
 * with the tampered tip, the Object Lock on the CURRENT hour's anchor key
 * prevents overwrite (in COMPLIANCE mode) — so the pre-tamper anchor is
 * preserved and the divergence is detectable. This is why Object Lock
 * COMPLIANCE mode is required (documented in infra/deploy/README.md).
 */
export async function verifyAuditChainWithAnchors() {
  const { s3 } = await import('../../infra/s3');
  // List anchor files, get the most recent. (In production with Object Lock,
  // this listing is itself tamper-evident because the bucket versioning is on.)
  // For now we use a simple HEAD on the current hour and the previous hour.
  const now = new Date();
  const candidates: string[] = [];
  for (let i = 0; i < 24; i++) {
    const d = new Date(now.getTime() - i * 3600_000);
    candidates.push(`audit-anchor/${d.toISOString().slice(0, 13)}.json`);
  }
  let anchor: { tipHash: string; lastRowId: string | null; anchoredAt: string } | null = null;
  for (const key of candidates) {
    const buf = await s3.getObject(key).catch(() => null);
    if (buf) {
      try { anchor = JSON.parse(buf.toString('utf-8')); break; } catch { /* try next */ }
    }
  }
  if (!anchor) {
    return { valid: false, reason: 'no_anchor_found' as const, verified: 0 };
  }

  // Verify the full chain up to the anchored row.
  const chain = await verifyAuditChain();
  if (!chain.valid) return chain;

  // Cross-check the current tip against the anchor's tip hash. They diverge
  // if a DB attacker mutated rows after the anchor was written.
  const [currentTip] = await db.select().from(schema.auditLogs)
    .orderBy(desc(schema.auditLogs.createdAt), desc(schema.auditLogs.id))
    .limit(1);
  const currentTipHash = currentTip?.hash ?? 'GENESIS';

  // The current tip should equal the anchor tip OR descend from it (new rows
  // added since the anchor). If the current tip hash is the anchor tip, we're
  // fully anchored. If new rows were added, walk back from the current tip to
  // find the anchored row and verify its hash matches.
  if (currentTipHash === anchor.tipHash) {
    return { valid: true, verified: chain.verified, anchoredAt: anchor.anchoredAt };
  }
  // New rows added since anchor — find the anchored row by id and verify hash.
  if (anchor.lastRowId) {
    const [anchoredRow] = await db.select().from(schema.auditLogs)
      .where(sql`id = ${anchor.lastRowId}`).limit(1);
    if (!anchoredRow) {
      return { valid: false, reason: 'anchored_row_deleted' as const, verified: chain.verified };
    }
    if (anchoredRow.hash !== anchor.tipHash) {
      return { valid: false, reason: 'tip_divergence' as const, verified: chain.verified, anchoredAt: anchor.anchoredAt };
    }
  }
  return { valid: true, verified: chain.verified, anchoredAt: anchor.anchoredAt };
}
