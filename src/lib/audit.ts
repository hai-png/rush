// Hash-chained append-only audit log. Each entry's hash covers the full
// payload (actor, action, entity, before/after, ipAddress, userAgent) plus
// the previous entry's hash — tampering with any field breaks the chain.
// Ordering uses a monotonic `seq` assigned in the same transaction as the
// row insert, so it's deterministic regardless of clock skew or concurrency.
import { db } from '@/lib/db';
import { createHash } from 'node:crypto';
import { logger } from '@/lib/logger';

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
    prevHash,
    actorId: input.actorId ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    before: input.before ?? null,
    after: input.after ?? null,
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
  };
  h.update(JSON.stringify(payload));
  return h.digest('hex');
}

let auditQueue: Promise<void> = Promise.resolve();

// Security-critical audit actions MUST propagate write failures to the caller
// (instead of being swallowed by the queue's catch). Without this, a failed
// audit write for e.g. `user.role_changed` would silently vanish — security
// reviews would have no record of the change.
const SECURITY_CRITICAL_ACTIONS = new Set([
  'user.role_changed',
  'user.suspended',
  'user.reactivated',
  'user.deleted',
  'user.impersonated',
  'user.password_change',
  'user.password_reset',
  'admin.session_revoked',
  'admin.bulk_suspend',
  'admin.bulk_refund',
  'refund.admin_triggered',
  'refund.scheduled',
  'corporate.member_removed',
  'system.settings',
]);

export function audit(input: AuditInput): Promise<void> {
  const isSecurityCritical = SECURITY_CRITICAL_ACTIONS.has(input.action);
  auditQueue = auditQueue.then(() => auditInternal(input)).catch((err) => {
    // Always log loudly so an alerting system can pick this up.
    logger.error({ err: (err as Error).message, action: input.action }, '[audit] write failed');
    // Emit a separate structured warn line tagged `dropped_audit` so ops can
    // count dropped non-critical audits in isolation from security-critical
    // errors above. We rely on structured logs being scraped by Grafana Loki /
    // Datadog (no prom-client in this repo — see src/lib/api-metrics.ts).
    if (!isSecurityCritical) {
      logger.warn({ action: input.action, error: (err as Error).message, tag: 'dropped_audit' }, 'audit.dropped');
    }
    // In AUDIT_STRICT=1 mode, every audit failure propagates to the caller —
    // useful in CI / staging to catch any audit-write path that would silently
    // drop in production.
    if (isSecurityCritical || process.env.AUDIT_STRICT === '1') {
      throw err;
    }
  });
  return auditQueue;
}

// H-11 fix: on Postgres, two concurrent txns can both read the same latest.seq
// and both try to insert with the same nextSeq. The @@unique on seq causes one
// to fail with P2002. We retry up to MAX_AUDIT_RETRIES times with a fresh read.
const MAX_AUDIT_RETRIES = 5;

async function auditInternal(input: AuditInput): Promise<void> {
  let attempt = 0;
  while (true) {
    attempt++;
    try {
      await db.$transaction(async (tx) => {
        const latest = await tx.auditLog.findFirst({
          orderBy: { seq: 'desc' },
          select: { hash: true, seq: true },
        });
        const prevHash = latest?.hash ?? null;
        const nextSeq = (latest?.seq ?? 0) + 1;

        await tx.auditLog.create({
          data: {
            seq: nextSeq,
            actorId: input.actorId,
            action: input.action,
            entityType: input.entityType,
            entityId: input.entityId,
            before: input.before !== undefined ? JSON.stringify(input.before) : null,
            after: input.after !== undefined ? JSON.stringify(input.after) : null,
            ipAddress: input.ipAddress,
            userAgent: input.userAgent,
            prevHash,
            hash: computeHash(input, prevHash),
          },
        });
      });
      return;
    } catch (err: any) {
      // P2002 = unique constraint violation on seq. Retry with a fresh read.
      if (err?.code === 'P2002' && attempt < MAX_AUDIT_RETRIES) {
        // Brief backoff: 1ms, 2ms, 4ms, 8ms, 16ms
        await new Promise(r => setTimeout(r, 2 ** (attempt - 1)));
        continue;
      }
      throw err;
    }
  }
}


// H-12 fix: for security-critical actions, write the audit row INSIDE the
// main business transaction so a failed audit rolls back the action. This
// prevents the "audit failed but action committed" race where an attacker
// could trigger a transient DB error to suppress the audit trail.
//
// Usage:
//   await db.$transaction(async (tx) => {
//     await tx.user.update({ where: { id }, data: { role: 'platform_admin' } });
//     await auditTx(tx, { actorId: session.id, action: 'user.role_changed', ... });
//   });
//
// Note: this bypasses the auditQueue serialisation because it's already inside
// the caller's transaction. The seq assignment + hash chain are still correct
// because they're computed from the latest row in the same tx.
export async function auditTx(tx: any, input: AuditInput): Promise<void> {
  const latest = await tx.auditLog.findFirst({
    orderBy: { seq: 'desc' },
    select: { hash: true, seq: true },
  });
  const prevHash = latest?.hash ?? null;
  const nextSeq = (latest?.seq ?? 0) + 1;
  await tx.auditLog.create({
    data: {
      seq: nextSeq,
      actorId: input.actorId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      before: input.before !== undefined ? JSON.stringify(input.before) : null,
      after: input.after !== undefined ? JSON.stringify(input.after) : null,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      prevHash,
      hash: computeHash(input, prevHash),
    },
  });
}

export async function verifyAuditChain(): Promise<{ ok: boolean; brokenAt?: string; verified: number }> {
  let prevHash: string | null = null;
  let verified = 0;
  // Paginate by `seq` (deterministic order) instead of `createdAt`.
  const pageSize = 1000;
  let cursor: number | undefined;
  while (true) {
    const rows = await db.auditLog.findMany({
      orderBy: { seq: 'asc' },
      take: pageSize,
      ...(cursor !== undefined ? { skip: 1, cursor: { seq: cursor } } : {}),
    });
    if (rows.length === 0) break;
    for (const row of rows) {
      if (row.prevHash !== prevHash) return { ok: false, brokenAt: row.id, verified };
      // JSON.parse can throw on a tampered/corrupt row — treat as a break.
      let before: unknown, after: unknown;
      try {
        before = row.before ? JSON.parse(row.before) : undefined;
        after = row.after ? JSON.parse(row.after) : undefined;
      } catch {
        return { ok: false, brokenAt: row.id, verified };
      }
      const expected = computeHash({
        actorId: row.actorId ?? undefined,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId ?? undefined,
        before,
        after,
        ipAddress: row.ipAddress ?? undefined,
        userAgent: row.userAgent ?? undefined,
      }, prevHash);
      if (expected !== row.hash) return { ok: false, brokenAt: row.id, verified };
      prevHash = row.hash;
      verified++;
    }
    cursor = rows[rows.length - 1]!.seq;
    if (rows.length < pageSize) break;
  }
  return { ok: true, verified };
}
