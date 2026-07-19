import { getSession } from '../../src/context';
import { createRoute, z } from '@hono/zod-openapi';
import { TypedOpenAPIHono } from '../../src/typed-hono';
import { ErrorSchema, envelope } from '@addis/shared';
import { requireRole } from '../../src/middleware/auth';
import { CreateSubscriptionInput } from './types';
import { subscriptionService } from './service';
import { getRiderProfileId } from '../identity/profile-resolver';

export const subscriptionRoutes = new TypedOpenAPIHono();

const SubscriptionSchema = z.object({
  id: z.string(), riderId: z.string(), planId: z.string(), routeId: z.string().nullable(),
  status: z.string(), ridesUsed: z.number(), startDate: z.string(), endDate: z.string(),
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
  const session = getSession(c);
  // subscriptions.rider_id references rider_profiles.id, NOT users.id.
  const riderId = await getRiderProfileId(session.userId);
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
  const session = getSession(c);
  const riderId = await getRiderProfileId(session.userId);
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
  const session = getSession(c);
  const riderId = await getRiderProfileId(session.userId);
  const result = await subscriptionService.cancel(id, riderId);
  return c.json({ data: { status: result.to } } as any, 200);
});

/**
 * GET / — list the caller's subscriptions (active + history). The rider dashboard
 * and account page need this to show past and current subscriptions. Was missing
 * — the frontend had no way to list a rider's own subscriptions.
 */
const listRoute = createRoute({
  method: 'get', path: '/', security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  middleware: [requireRole('rider')] as const,
  responses: { 200: { description: 'List', content: { 'application/json': { schema: envelope(z.array(SubscriptionSchema)) } } } },
});
subscriptionRoutes.openapi(listRoute, async (c) => {
  const session = getSession(c);
  const riderId = await getRiderProfileId(session.userId);
  const { eq: eqOp, desc: descFn } = await import('drizzle-orm');
  const { db, schema } = await import('@addis/db');
  const rows = await db.select().from(schema.subscriptions)
    .where(eqOp(schema.subscriptions.riderId, riderId))
    .orderBy(descFn(schema.subscriptions.createdAt));
  return c.json({ data: rows } as any, 200);
});
