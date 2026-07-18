import { Hono } from 'hono';
import { z } from 'zod';
import { requireRole } from '../../src/middleware/auth';
import { adminService } from './service';
import { adminCatalogRoutes } from '../catalog/routes';
import { documentService } from '../identity/documents';
import { scheduleRefund } from '../payment/service';
import { Money } from '@addis/shared';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@addis/db';

export const adminRoutes = new Hono();
adminRoutes.use('*', requireRole('platform_admin'));
adminRoutes.route('/', adminCatalogRoutes);

adminRoutes.get('/dashboard', async (c) => c.json({ data: await adminService.dashboard() }));
adminRoutes.get('/users', async (c) => c.json({ data: await adminService.listUsers(Number(c.req.query('limit') ?? 20), c.req.query('q')) }));
adminRoutes.patch('/users/:id', async (c) => {
  const body = z.object({ action: z.enum(['suspend', 'change_role']), role: z.string().optional() }).parse(await c.req.json());
  const ip = c.req.header('x-forwarded-for');
  if (body.action === 'suspend') return c.json({ data: await adminService.suspendUser(c.get('session').userId, c.req.param('id'), ip) });
  return c.json({ data: await adminService.changeRole(c.get('session').userId, c.req.param('id'), body.role!, ip) });
});
adminRoutes.post('/users/:id/impersonate', async (c) => c.json({ data: await adminService.impersonate(c.get('session').userId, c.req.param('id'), c.req.header('x-forwarded-for')) }));

adminRoutes.get('/contractors/pending', async (c) => {
  const rows = await db.select().from(schema.contractorProfiles).where(eq(schema.contractorProfiles.verificationStatus, 'pending'));
  return c.json({ data: rows });
});
adminRoutes.post('/contractors/:id/verify', async (c) => c.json({ data: await documentService.verify(c.get('session').userId, c.req.param('id')) }));
adminRoutes.post('/contractors/:id/reject', async (c) => {
  const { reason } = z.object({ reason: z.string().min(3) }).parse(await c.req.json());
  return c.json({ data: await documentService.reject(c.get('session').userId, c.req.param('id'), reason) });
});

adminRoutes.get('/audit-logs', async (c) => c.json({
  data: await adminService.searchAuditLogs({ entityType: c.req.query('entityType'), actorId: c.req.query('actorId'), action: c.req.query('action') }, Number(c.req.query('limit') ?? 50)),
}));

adminRoutes.get('/subscriptions', async (c) => {
  const rows = await db.select().from(schema.subscriptions).limit(Number(c.req.query('limit') ?? 50));
  return c.json({ data: rows });
});

adminRoutes.get('/payments', async (c) => {
  const status = c.req.query('status');
  const rows = await db.select().from(schema.payments)
    .where(status ? eq(schema.payments.status, status as any) : undefined)
    .limit(Number(c.req.query('limit') ?? 50));
  return c.json({ data: rows });
});
adminRoutes.post('/payments/:id/verify', async (c) => {
  const [payment] = await db.update(schema.payments).set({ status: 'completed', updatedAt: new Date() })
    .where(and(eq(schema.payments.id, c.req.param('id')), eq(schema.payments.status, 'pending'))).returning();
  if (payment?.subscriptionId) {
    const { transitionSubscription } = await import('../subscription/state');
    await db.transaction((tx) => transitionSubscription(tx, payment.subscriptionId!, 'payment.settled'));
  }
  return c.json({ data: payment });
});

adminRoutes.post('/refunds', async (c) => {
  const body = z.object({ paymentId: z.string(), amount: z.string(), reason: z.string() }).parse(await c.req.json());
  await scheduleRefund(body.paymentId, Money.fromETBString(body.amount), body.reason);
  return c.body(null, 202);
});

adminRoutes.get('/export/:resource', async (c) => {
  const resource = c.req.param('resource');
  const tableMap: Record<string, any> = { users: schema.users, payments: schema.payments, subscriptions: schema.subscriptions, tickets: schema.supportTickets };
  const table = tableMap[resource];
  if (!table) return c.json({ error: { code: 'BAD_REQUEST', message: 'Unknown export resource', requestId: c.get('requestId') } }, 400);
  const rows = await db.select().from(table).limit(10_000);
  const csv = toCsv(rows);
  return new Response(csv, { headers: { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="${resource}.csv"` } });
});

function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [headers.join(','), ...rows.map((r) => headers.map((h) => escape(r[h])).join(','))].join('\n');
}
