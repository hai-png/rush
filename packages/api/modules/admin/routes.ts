import { TypedHono } from '../../src/typed-hono';
import { z } from 'zod';
import { requireRole } from '../../src/middleware/auth';
import { adminService } from './service';
import { adminCatalogRoutes } from '../catalog/routes';
import { documentService } from '../identity/documents';
import { corporateService } from '../corporate/service';
import { scheduleRefund } from '../payment/service';
import { faqService } from '../support/service';
import { settlePayment } from '../payment/service';
import { Money, ALL_ROLES } from '@addis/shared';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@addis/db';

export const adminRoutes = new TypedHono();
adminRoutes.use('*', requireRole('platform_admin'));
adminRoutes.route('/', adminCatalogRoutes);

adminRoutes.get('/dashboard', async (c) => c.json({ data: await adminService.dashboard() }));
adminRoutes.get('/users', async (c) => c.json({ data: await adminService.listUsers(Number(c.req.query('limit') ?? 20), c.req.query('q')) }));
adminRoutes.patch('/users/:id', async (c) => {
  const body = z.object({ action: z.enum(['suspend', 'change_role']), role: z.enum(ALL_ROLES as [string, ...string[]]).optional() }).parse(await c.req.json());
  const ip = c.req.header('x-forwarded-for');
  if (body.action === 'suspend') return c.json({ data: await adminService.suspendUser(c.get('session').userId, c.req.param('id'), ip) });
  if (!body.role) return c.json({ error: { code: 'BAD_REQUEST', message: 'role is required for change_role', requestId: c.get('requestId') } }, 400);
  return c.json({ data: await adminService.changeRole(c.get('session').userId, c.req.param('id'), body.role, ip) });
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

adminRoutes.get('/corporates/pending', async (c) => {
  const rows = await db.select().from(schema.corporates).where(eq(schema.corporates.isActive, false));
  return c.json({ data: rows });
});
adminRoutes.post('/corporates/:id/activate', async (c) => c.json({ data: await corporateService.activate(c.req.param('id')) }));

adminRoutes.get('/audit-logs', async (c) => c.json({
  data: await adminService.searchAuditLogs({ entityType: c.req.query('entityType'), actorId: c.req.query('actorId'), action: c.req.query('action') }, Number(c.req.query('limit') ?? 50)),
}));

adminRoutes.get('/subscriptions', async (c) => {
  const rows = await db.select().from(schema.subscriptions).limit(Number(c.req.query('limit') ?? 50));
  return c.json({ data: rows });
});

/**
 * Admin support queue — list all tickets (optionally filtered by status).
 * Previously missing: the admin UI's /admin/tickets page called GET /api/v1/admin/tickets,
 * which 404'd because no such route existed (only the rider-facing /api/v1/tickets was
 * available, and it restricts to the caller's own tickets unless the caller is staff).
 */
adminRoutes.get('/tickets', async (c) => {
  const status = c.req.query('status');
  const rows = await db.select().from(schema.supportTickets)
    .where(status ? eq(schema.supportTickets.status, status as any) : undefined)
    .limit(Number(c.req.query('limit') ?? 50));
  return c.json({ data: rows });
});

adminRoutes.get('/payments', async (c) => {
  const status = c.req.query('status');
  const rows = await db.select().from(schema.payments)
    .where(status ? eq(schema.payments.status, status as any) : undefined)
    .limit(Number(c.req.query('limit') ?? 50));
  return c.json({ data: rows });
});
/**
 * Manually verifies a CBE bank-transfer payment.
 *
 * Previously this bypassed settlePayment() entirely — it directly set the row to
 * 'completed' and called transitionSubscription, skipping the webhook replay-protection
 * (the merchOrderId-based idempotency check inside settlePayment) and any future
 * side-effects that settlePayment owns (outbox audit events, seat-claim fan-out).
 * Routing through settlePayment() means an admin "verify" is functionally identical
 * to a webhook settlement, including being a no-op if the payment is no longer pending.
 */
adminRoutes.post('/payments/:id/verify', async (c) => {
  const [payment] = await db.select().from(schema.payments)
    .where(and(eq(schema.payments.id, c.req.param('id')), eq(schema.payments.status, 'pending')))
    .limit(1);
  if (!payment) return c.json({ error: { code: 'NOT_FOUND', message: 'No pending payment with that id', requestId: c.get('requestId') } }, 404);

  // CBE is manual reconciliation — the admin is attesting that the bank confirmed the
  // amount was received, so we pass the payment's own amount as the reportedAmount to
  // satisfy settlePayment's mismatch guard.
  const settled = await settlePayment(payment.reference, Money.fromDecimal(payment.amount));
  await db.insert(schema.outboxEvents).values({
    channel: 'audit',
    payload: {
      action: 'admin.payment_manually_verified',
      entityId: payment.id,
      actorId: c.get('session').userId,
    },
  });
  const [updated] = await db.select().from(schema.payments).where(eq(schema.payments.id, payment.id)).limit(1);
  return c.json({ data: updated, meta: { settled } });
});

/**
 * Admin FAQ management. Previously missing: the admin FAQ page called
 * POST /api/v1/admin/faq and DELETE /api/v1/admin/faq/:id, neither of which existed.
 * The faqService already had create/update/remove implementations — they were just
 * never wired to admin routes.
 */
const CreateFaqInput = z.object({
  category: z.enum(['billing', 'routes', 'shuttle', 'account', 'corporate', 'general']),
  question: z.string().min(3),
  answer: z.string().min(1),
  questionAm: z.string().optional(),
  answerAm: z.string().optional(),
  sortOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
});
const UpdateFaqInput = CreateFaqInput.partial();

adminRoutes.get('/faq', async (c) => {
  // Admin sees ALL FAQ articles (including inactive) for management; the public
  // faqService.list() filters to isActive=true only.
  const rows = await db.select().from(schema.faqArticles).orderBy(schema.faqArticles.category, schema.faqArticles.sortOrder);
  return c.json({ data: rows });
});
adminRoutes.post('/faq', async (c) => {
  const body = CreateFaqInput.parse(await c.req.json());
  return c.json({ data: await faqService.create(body) }, 201);
});
adminRoutes.patch('/faq/:id', async (c) => {
  const body = UpdateFaqInput.parse(await c.req.json());
  return c.json({ data: await faqService.update(c.req.param('id'), body) });
});
adminRoutes.delete('/faq/:id', async (c) => { await faqService.remove(c.req.param('id')); return c.body(null, 204); });
adminRoutes.post('/faq/:id/vote', async (c) => {
  const { helpful } = z.object({ helpful: z.boolean() }).parse(await c.req.json());
  await faqService.vote(c.req.param('id'), helpful);
  return c.body(null, 204);
});

adminRoutes.post('/refunds', async (c) => {
  const body = z.object({ paymentId: z.string(), amount: z.string(), reason: z.string() }).parse(await c.req.json());
  await scheduleRefund(body.paymentId, Money.fromETBString(body.amount), body.reason);
  return c.body(null, 202);
});

// Fields that must never leave the system via a bulk export, keyed by resource name.
const EXPORT_FIELD_DENYLIST: Record<string, string[]> = {
  users: ['passwordHash', 'twoFactorSecret'],
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
  return new Response(csv, { headers: { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="${resource}.csv"` } });
});

function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  // Guard against CSV/formula injection: a value starting with =, +, -, @, tab, or CR
  // will be interpreted as a formula by Excel/Sheets when the export is opened. Prefixing
  // with a single quote neutralizes it while keeping the value legible.
  const FORMULA_LEAD = /^[=+\-@\t\r]/;
  const escape = (v: unknown) => {
    let s = String(v ?? '');
    if (FORMULA_LEAD.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  return [headers.join(','), ...rows.map((r) => headers.map((h) => escape(r[h])).join(','))].join('\n');
}
