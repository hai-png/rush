// Hash-chained append-only audit log. Each entry's hash = sha256(canonical-json(payload)).
// Append-only is enforced in app code — there is no update/delete path exposed.
// Note: createdAt is NOT part of the hash because SQLite's DateTime rounding can
import { db } from '@/lib/db';
import { createHash } from 'node:crypto';

export type AuditInput = {
  actorId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  ipAddress?: string;
  userAgent?: string;
};

function computeHash(input: AuditInput, prevHash: string | null): string {
  const h = createHash('sha256');
  const payload = {
    prevHash: prevHash,
    actorId: input.actorId ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    before: input.before ?? null,
    after: input.after ?? null,
  };
  h.update(JSON.stringify(payload));
  return h.digest('hex');
}

let auditQueue: Promise<void> = Promise.resolve();

export function audit(input: AuditInput): Promise<void> {
  auditQueue = auditQueue.then(() => auditInternal(input)).catch((err) => {
    console.error('[audit] write failed:', err);
  });
  return auditQueue;
}

async function auditInternal(input: AuditInput): Promise<void> {
  const latest = await db.auditLog.findFirst({
    orderBy: { createdAt: 'desc' },
    select: { hash: true },
  });
  const prevHash = latest?.hash ?? null;

  await db.auditLog.create({
    data: {
      actorId: input.actorId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      before: input.before !== undefined ? JSON.stringify(input.before) : null,
      after: input.after !== undefined ? JSON.stringify(input.after) : null,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      prevHash: prevHash,
      hash: computeHash(input, prevHash),
    },
  });
}

export async function verifyAuditChain(): Promise<{ ok: boolean; brokenAt?: string }> {
  const rows = await db.auditLog.findMany({ orderBy: { createdAt: 'asc' } });
  let prevHash: string | null = null;
  for (const row of rows) {
    if (row.prevHash !== prevHash) return { ok: false, brokenAt: row.id };
    const expected = computeHash({
      actorId: row.actorId ?? undefined,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId ?? undefined,
      before: row.before ? JSON.parse(row.before) : undefined,
      after: row.after ? JSON.parse(row.after) : undefined,
      ipAddress: row.ipAddress ?? undefined,
      userAgent: row.userAgent ?? undefined,
    }, prevHash);
    if (expected !== row.hash) return { ok: false, brokenAt: row.id };
    prevHash = row.hash;
  }
  return { ok: true };
}
