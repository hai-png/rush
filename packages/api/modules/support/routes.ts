import { Hono } from 'hono';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db, schema } from '@addis/db';
import { requireRole, requireAuth } from '../../src/middleware/auth';
import { supportService, faqService } from './service';

export const supportRoutes = new Hono();

const CreateTicket = z.object({ subject: z.string().min(3), body: z.string().min(1), category: z.string().default('general'), subscriptionId: z.string().optional(), paymentId: z.string().optional() });
const Reply = z.object({ body: z.string().min(1) });
const TicketEventInput = z.object({ event: z.enum(['staff.resolved', 'user.reopened']) });

supportRoutes.use('/tickets/*', requireAuth);
supportRoutes.use('/tickets', requireAuth);

supportRoutes.get('/tickets', async (c) => {
  const session = c.get('session');
  const isStaff = session.role === 'platform_admin';
  return c.json({ data: await supportService.listForUser(session.userId, isStaff) });
});
supportRoutes.post('/tickets', async (c) => {
  const session = c.get('session');
  const body = CreateTicket.parse(await c.req.json());
  return c.json({ data: await supportService.createTicket(session.userId, body) }, 201);
});
supportRoutes.get('/tickets/:id', async (c) => {
  const session = c.get('session');
  return c.json({ data: await supportService.getTicket(session.userId, session.role === 'platform_admin', c.req.param('id')) });
});
supportRoutes.get('/tickets/:id/messages', async (c) => {
  const session = c.get('session');
  // Reuse getTicket() so non-staff callers can only read messages for their OWN ticket —
  // otherwise this would be an IDOR into every other user's support conversation.
  await supportService.getTicket(session.userId, session.role === 'platform_admin', c.req.param('id'));
  const rows = await db.select().from(schema.ticketMessages)
    .where(eq(schema.ticketMessages.ticketId, c.req.param('id')));
  rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return c.json({ data: rows });
});
supportRoutes.post('/tickets/:id/messages', async (c) => {
  const session = c.get('session');
  const body = Reply.parse(await c.req.json());
  await supportService.reply(session.userId, session.role === 'platform_admin', c.req.param('id'), body.body);
  return c.body(null, 201);
});
/**
 * Status transitions on a ticket. Authorization is per-event:
 *   - `staff.resolved` is a staff action → requireRole('platform_admin')
 *   - `user.reopened` is an end-user action (state machine allows it from `resolved`
 *      and `closed`) → any authenticated user may call it, but only on their own ticket
 *      (enforced inside supportService.setStatus via the existing ownership check).
 * Previously this endpoint required platform_admin for BOTH events, which meant users
 * could never reopen their own resolved tickets — the state machine path was effectively
 * dead from the API's perspective.
 */
supportRoutes.patch('/tickets/:id', async (c) => {
  const session = c.get('session');
  const { event } = TicketEventInput.parse(await c.req.json());
  if (event === 'staff.resolved' && session.role !== 'platform_admin') {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Only staff may resolve tickets', requestId: c.get('requestId') } }, 403);
  }
  // For end-user events (user.reopened), verify the caller actually owns the ticket —
  // otherwise any authenticated user could reopen anyone else's ticket by guessing ids.
  // For staff events, getTicket() with isStaff=true skips the ownership check.
  await supportService.getTicket(session.userId, session.role === 'platform_admin', c.req.param('id'));
  return c.json({ data: await supportService.setStatus(session.userId, c.req.param('id'), event) });
});

supportRoutes.get('/faq', async (c) => c.json({ data: await faqService.list(c.req.query('category')) }));
