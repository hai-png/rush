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
    logger.error({ err: (err as Error).message, action: input.action }, '[audit] write failed');
    if (isSecurityCritical || process.env.AUDIT_STRICT === '1') {
      logger.error({ action: input.action, tag: 'audit_critical_failed' }, 'audit.critical_write_failed');
    } else {
      logger.warn({ action: input.action, error: (err as Error).message, tag: 'dropped_audit' }, 'audit.dropped');
    }
  });
  return auditQueue;
}

// H-11 fix: on Postgres, two concurrent txns can both read the same latest.seq
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
      if (err?.code === 'P2002' && attempt < MAX_AUDIT_RETRIES) {
        await new Promise(r => setTimeout(r, 2 ** (attempt - 1)));
        continue;
      }
      throw err;
    }
  }
}

// H-12 fix: for security-critical actions, write the audit row INSIDE the
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

