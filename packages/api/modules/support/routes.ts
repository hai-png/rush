import { TypedOpenAPIHono } from '../../src/typed-hono';
import { z } from 'zod';
import { requireAuth } from '../../src/middleware/auth';
import { supportService, faqService } from './service';

export const supportRoutes = new TypedOpenAPIHono();

const CreateTicket = z.object({ subject: z.string().min(3), body: z.string().min(1), category: z.string().default('general'), subscriptionId: z.string().optional(), paymentId: z.string().optional() });
const Reply = z.object({ body: z.string().min(1) });

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
supportRoutes.post('/tickets/:id/messages', async (c) => {
  const session = c.get('session');
  const body = Reply.parse(await c.req.json());
  await supportService.reply(session.userId, session.role === 'platform_admin', c.req.param('id'), body.body);
  return c.body(null, 201);
});
supportRoutes.patch('/tickets/:id', async (c) => {

  const session = c.get('session');
  const { event } = z.object({ event: z.enum(['staff.resolved', 'user.reopened']) }).parse(await c.req.json());
  if (event === 'staff.resolved' && session.role !== 'platform_admin') {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Only staff can resolve tickets', requestId: c.get('requestId') } }, 403);
  }
  return c.json({ data: await supportService.setStatus(session.userId, c.req.param('id'), event) });
});

supportRoutes.get('/faq', async (c) => c.json({ data: await faqService.list(c.req.query('category')) }));
