import { createRoute, z } from '@hono/zod-openapi';
import { TypedOpenAPIHono } from '../../src/typed-hono';
import { ErrorSchema, envelope } from '@addis/shared';
import { requireRole } from '../../src/middleware/auth';
import { CreateSubscriptionInput } from './types';
import { subscriptionService } from './service';
import { db, schema } from '@addis/db';
import { eq, and, desc } from 'drizzle-orm';
import { NotFoundError } from '@addis/shared';

export const subscriptionRoutes = new TypedOpenAPIHono();

const SubscriptionSchema = z.object({
  id: z.string(), riderId: z.string(), planId: z.string(), routeId: z.string().nullable(),
  status: z.string(), ridesUsed: z.number(), startDate: z.string(), endDate: z.string(),
});

async function riderProfileIdFor(userId: string): Promise<string> {
  const [profile] = await db.select().from(schema.riderProfiles).where(eq(schema.riderProfiles.userId, userId));
  if (!profile) throw new NotFoundError('Rider profile not found');
  return profile.id;
}

// API-002: GET /subscriptions — list the rider's own subscriptions (active +
// history). Previously missing — riders could only see their most recent
// active sub via /dashboard/rider, with no history.
subscriptionRoutes.get('/', requireRole('rider'), async (c) => {
  const session = c.get('session')!;
  const riderId = await riderProfileIdFor(session.userId);
  const status = c.req.query('status');
  const VALID_STATUSES = ['pending_payment', 'active', 'expired', 'cancelled'] as const;
  const statusFilter = status && (VALID_STATUSES as readonly string[]).includes(status)
    ? (status as typeof VALID_STATUSES[number]) : undefined;
  const limit = Math.min(Math.max(1, Number(c.req.query('limit') ?? 50) || 50), 200);
  const rows = await db.select().from(schema.subscriptions)
    .where(and(
      eq(schema.subscriptions.riderId, riderId),
      statusFilter ? eq(schema.subscriptions.status, statusFilter) : undefined,
    ))
    .orderBy(desc(schema.subscriptions.createdAt))
    .limit(limit);
  return c.json({ data: rows });
});

const createRoute1 = createRoute({
  method: 'post', path: '/', security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  middleware: [requireRole('rider')] as const,
  request: { body: { content: { 'application/json': { schema: CreateSubscriptionInput } } } },
  responses: {
    201: { content: { 'application/json': { schema: envelope(SubscriptionSchema) } }, description: 'Created' },
    400: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Validation' },
    409: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Conflict (dup active sub / trial used)' },
  },
});

subscriptionRoutes.openapi(createRoute1, async (c) => {
  const body = c.req.valid('json');
  const session = c.get('session');
  const riderId = await riderProfileIdFor(session.userId);
  const result = await subscriptionService.create({ ...body, riderId });
  return c.json({ data: result.subscription, meta: { checkout: result.checkout } } as any, 201);
});

const renewRoute = createRoute({
  method: 'post', path: '/{id}/renew', security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  middleware: [requireRole('rider')] as const,
  request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: z.object({ paymentMethod: z.enum(['telebirr', 'cbe']) }) } } } },
  responses: { 201: { content: { 'application/json': { schema: envelope(SubscriptionSchema) } }, description: 'Renewed' } },
});
subscriptionRoutes.openapi(renewRoute, async (c) => {
  const { id } = c.req.valid('param');
  const { paymentMethod } = c.req.valid('json');
  const session = c.get('session');
  const riderId = await riderProfileIdFor(session.userId);
  const result = await subscriptionService.renew(id, riderId, paymentMethod);
  return c.json({ data: result.subscription } as any, 201);
});

const cancelRoute = createRoute({
  method: 'delete', path: '/{id}', security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  middleware: [requireRole('rider')] as const,
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { content: { 'application/json': { schema: envelope(z.object({ status: z.string() })) } }, description: 'Cancelled' } },
});
subscriptionRoutes.openapi(cancelRoute, async (c) => {
  const { id } = c.req.valid('param');
  const session = c.get('session');
  const riderId = await riderProfileIdFor(session.userId);
  const result = await subscriptionService.cancel(id, riderId);
  return c.json({ data: { status: result.to } } as any, 200);
});
