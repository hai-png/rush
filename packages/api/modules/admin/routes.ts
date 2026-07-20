import { TypedOpenAPIHono } from '../../src/typed-hono';
import { z } from 'zod';
import { requireRole } from '../../src/middleware/auth';
import { clientIp } from '../../src/ip';
import { adminService } from './service';
import { adminCatalogRoutes } from '../catalog/routes';
import { documentService } from '../identity/documents';
import { corporateService } from '../corporate/service';
import { scheduleRefund } from '../payment/service';
import { Money, ALL_ROLES } from '@addis/shared';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@addis/db';

export const adminRoutes = new TypedOpenAPIHono();
adminRoutes.use('*', requireRole('platform_admin'));
adminRoutes.route('/', adminCatalogRoutes);

function boundedLimit(raw: string | undefined, def: number, max = 200): number {
  const n = Number(raw ?? def);
  if (!Number.isFinite(n) || n < 1) return def;
  return Math.min(Math.floor(n), max);
}

adminRoutes.get('/dashboard', async (c) => c.json({ data: await adminService.dashboard() }));
adminRoutes.get('/users', async (c) => c.json({ data: await adminService.listUsers(boundedLimit(c.req.query('limit'), 20, 200), c.req.query('q')) }));
adminRoutes.patch('/users/:id', async (c) => {

  const body = z.object({ action: z.enum(['suspend', 'change_role', 'reactivate']), role: z.enum(ALL_ROLES as [string, ...string[]]).optional() }).parse(await c.req.json());
  const ip = clientIp(c);
  if (body.action === 'suspend') return c.json({ data: await adminService.suspendUser(c.get('session')!.userId, c.req.param('id'), ip) });
  if (body.action === 'reactivate') return c.json({ data: await adminService.reactivateUser(c.get('session')!.userId, c.req.param('id'), ip) });
  if (!body.role) return c.json({ error: { code: 'BAD_REQUEST', message: 'role is required for change_role', requestId: c.get('requestId') } }, 400);
  return c.json({ data: await adminService.changeRole(c.get('session')!.userId, c.req.param('id'), body.role, ip) });
});
adminRoutes.post('/users/:id/impersonate', async (c) => c.json({ data: await adminService.impersonate(c.get('session')!.userId, c.req.param('id'), clientIp(c)) }));

adminRoutes.get('/contractors/pending', async (c) => {
  const rows = await db.select().from(schema.contractorProfiles).where(eq(schema.contractorProfiles.verificationStatus, 'pending'));
  return c.json({ data: rows });
});
adminRoutes.post('/contractors/:id/verify', async (c) => c.json({ data: await documentService.verify(c.get('session')!.userId, c.req.param('id')) }));
adminRoutes.post('/contractors/:id/reject', async (c) => {
  const { reason } = z.object({ reason: z.string().min(3) }).parse(await c.req.json());
  return c.json({ data: await documentService.reject(c.get('session')!.userId, c.req.param('id'), reason) });
});

adminRoutes.get('/corporates/pending', async (c) => {
  const rows = await db.select().from(schema.corporates).where(eq(schema.corporates.isActive, false));
  return c.json({ data: rows });
});
adminRoutes.post('/corporates/:id/activate', async (c) => c.json({ data: await corporateService.activate(c.req.param('id')) }));

adminRoutes.get('/audit-logs', async (c) => c.json({
  data: await adminService.searchAuditLogs({ entityType: c.req.query('entityType') ?? undefined, actorId: c.req.query('actorId') ?? undefined, action: c.req.query('action') ?? undefined }, boundedLimit(c.req.query('limit'), 50, 500)),
}));

adminRoutes.get('/subscriptions', async (c) => {
  const rows = await db.select().from(schema.subscriptions).limit(boundedLimit(c.req.query('limit'), 50, 500));
  return c.json({ data: rows });
});

adminRoutes.get('/payments', async (c) => {
  const status = c.req.query('status');

  const VALID_STATUSES = ['pending', 'completed', 'failed', 'refunded'] as const;
  const statusFilter = status && (VALID_STATUSES as readonly string[]).includes(status) ? (status as typeof VALID_STATUSES[number]) : undefined;
  const rows = await db.select().from(schema.payments)
    .where(statusFilter ? eq(schema.payments.status, statusFilter) : undefined)
    .limit(boundedLimit(c.req.query('limit'), 50, 500));
  return c.json({ data: rows });
});
adminRoutes.post('/payments/:id/verify', async (c) => {

  const body = z.object({
    verifiedAmount: z.string().regex(/^\d+(\.\d{1,2})?$/, 'verifiedAmount must be a decimal ETB string'),
    reason: z.string().min(3).max(500),
  }).parse(await c.req.json());
  const adminId = c.get('session')!.userId;
  const ipAddress = clientIp(c) ?? null;

  const result = await db.transaction(async (tx) => {
    const { writeAudit } = await import('./audit');
    const { transitionSubscription } = await import('../subscription/state');
    const { Money } = await import('@addis/shared');

    const [payment] = await tx.update(schema.payments)
      .set({ status: 'completed', updatedAt: new Date() })
      .where(and(eq(schema.payments.id, c.req.param('id')), eq(schema.payments.status, 'pending')))
      .returning();
    if (!payment) return { payment: null };

    const expected = Money.fromDecimal(payment.amount);
    const actual = Money.fromETBString(body.verifiedAmount);
    if (!expected.eq(actual)) {

      await tx.update(schema.payments).set({ status: 'failed', updatedAt: new Date() }).where(eq(schema.payments.id, payment.id));
      await writeAudit(tx as any, {
        actorId: adminId, action: 'payment.manually_verified_amount_mismatch',
        entityType: 'payment', entityId: payment.id,
        before: { status: 'pending', amount: payment.amount },
        after: { status: 'failed', verifiedAmount: body.verifiedAmount, reason: body.reason },
        ipAddress,
      });
      return { payment, amountMismatch: true };
    }

    if (payment.subscriptionId) {
      await transitionSubscription(tx, payment.subscriptionId, 'payment.settled');
    }
    await writeAudit(tx as any, {
      actorId: adminId, action: 'payment.manually_verified',
      entityType: 'payment', entityId: payment.id,
      before: { status: 'pending' },
      after: { status: 'completed', verifiedAmount: body.verifiedAmount, reason: body.reason },
      ipAddress,
    });
    return { payment, amountMismatch: false };
  });

  if (!result.payment) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'No pending payment with that id', requestId: c.get('requestId') } }, 404);
  }
  if (result.amountMismatch) {
    return c.json({ error: { code: 'AMOUNT_MISMATCH', message: 'Verified amount does not match expected amount; payment marked failed', requestId: c.get('requestId') } }, 409);
  }
  return c.json({ data: result.payment });
});

adminRoutes.post('/refunds', async (c) => {

  const body = z.object({
    paymentId: z.string(),
    amount: z.string().regex(/^\d+(\.\d{1,2})?$/, 'amount must be a decimal ETB string'),
    reason: z.string().min(3).max(500),
  }).parse(await c.req.json());
  const adminId = c.get('session')!.userId;
  const ipAddress = clientIp(c) ?? null;
  try {
    await scheduleRefund(body.paymentId, Money.fromETBString(body.amount), body.reason);

    await db.insert(schema.outboxEvents).values({
      channel: 'audit',
      payload: { action: 'refund.scheduled', actorId: adminId, paymentId: body.paymentId, amount: body.amount, reason: body.reason, ipAddress },
    });
  } catch (err: any) {

    const status = err.httpStatus ?? 500;
    return c.json({ error: { code: err.code ?? 'INTERNAL', message: err.message ?? 'Refund scheduling failed', requestId: c.get('requestId') } }, status);
  }
  return c.body(null, 202);
});

const EXPORT_FIELD_DENYLIST: Record<string, string[]> = {
  users: ['passwordHash', 'twoFactorSecret', 'twoFactorEnabled', 'phone', 'email', 'name'],
  payments: ['prepayId', 'reference', 'refundRequestNo', 'riderId'],
  subscriptions: ['riderId', 'morningSlot', 'eveningSlot'],
  tickets: ['userId', 'subject', 'body'],
};

adminRoutes.get('/export/:resource', async (c) => {
  const resource = c.req.param('resource');
  const tableMap: Record<string, any> = { users: schema.users, payments: schema.payments, subscriptions: schema.subscriptions, tickets: schema.supportTickets };
  const table = tableMap[resource];
  if (!table) return c.json({ error: { code: 'BAD_REQUEST', message: 'Unknown export resource', requestId: c.get('requestId') } }, 400);
  const rawRows = await db.select().from(table).limit(10_000);
  const denylist = EXPORT_FIELD_DENYLIST[resource] ?? [];
  const rows = denylist.length ? rawRows.map((r: Record<string, unknown>) => {
    const copy = { ...r };
    for (const field of denylist) delete copy[field];
    return copy;
  }) : rawRows;
  const csv = toCsv(rows);

  const adminId = c.get('session')!.userId;
  const ipAddress = clientIp(c) ?? null;
  try {
    await db.insert(schema.outboxEvents).values({
      channel: 'audit',
      payload: { action: 'admin.csv_export', actorId: adminId, resource, rowCount: rows.length, ipAddress },
    });
  } catch (err) {
    c.get('logger')?.error({ err, resource, rowCount: rows.length }, 'admin.csv_export: audit insert failed — refusing to return CSV without audit trail');
    return c.json({ error: { code: 'INTERNAL', message: 'Export audit failed — refusing to return CSV without audit trail', requestId: c.get('requestId') } }, 500);
  }

  return new Response(csv, { headers: { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="${resource}.csv"` } });
});

function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]!);

  const FORMULA_LEAD = /^[=+\-@\t\r]/;
  const escape = (v: unknown) => {
    let s = String(v ?? '');
    if (FORMULA_LEAD.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  return [headers.join(','), ...rows.map((r) => headers.map((h) => escape(r[h])).join(','))].join('\n');
}
