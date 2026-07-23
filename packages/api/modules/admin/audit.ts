import { createHash } from 'node:crypto';
import { desc } from 'drizzle-orm';
import { db, schema } from '@addis/db';

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

export async function writeAudit(tx: any, entry: {
  actorId: string | null; action: string; entityType: string; entityId?: string;
  before?: unknown; after?: unknown; ipAddress?: string | undefined; userAgent?: string | undefined;
}) {
  const [last] = await tx.select().from(schema.auditLogs)
    .orderBy(desc(schema.auditLogs.createdAt), desc(schema.auditLogs.id))
    .limit(1);
  const prevHash = last?.hash ?? 'GENESIS';

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

export async function verifyAuditChain(limit?: number) {
  const BATCH_SIZE = 5_000;
  let prevHash = 'GENESIS';
  let lastSeenId: string | undefined;
  let verified = 0;

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

    if (rows.length < batchLimit) break;
  }

  return { valid: true, verified };
}

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

  const hourBucket = new Date().toISOString().slice(0, 13);
  const key = `audit-anchor/${hourBucket}.json`;
  await s3.putObject(key, Buffer.from(JSON.stringify(anchorPayload, null, 2), 'utf-8'), 'application/json');
  return { key, ...anchorPayload };
}

export async function verifyAuditChainWithAnchors() {
  const { s3 } = await import('../../infra/s3');

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
      try { anchor = JSON.parse(buf.toString('utf-8')); break; } catch {  }
    }
  }
  if (!anchor) {
    return { valid: false, reason: 'no_anchor_found' as const, verified: 0 };
  }

  const chain = await verifyAuditChain();
  if (!chain.valid) return chain;

  const [currentTip] = await db.select().from(schema.auditLogs)
    .orderBy(desc(schema.auditLogs.createdAt), desc(schema.auditLogs.id))
    .limit(1);
  const currentTipHash = currentTip?.hash ?? 'GENESIS';

  if (currentTipHash === anchor.tipHash) {
    return { valid: true, verified: chain.verified, anchoredAt: anchor.anchoredAt };
  }

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
