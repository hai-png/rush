import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { ErrorSchema, envelope } from '@addis/shared';
import { requireRole } from '../../src/middleware/auth';
import { CreateSubscriptionInput } from './types';
import { subscriptionService } from './service';

export const subscriptionRoutes = new OpenAPIHono();

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
  const session = c.get('session');
  const result = await subscriptionService.create({ ...body, riderId: session.userId });
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
  const result = await subscriptionService.renew(id, session.userId, paymentMethod);
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
  const result = await subscriptionService.cancel(id, session.userId);
  return c.json({ data: { status: result.to } } as any, 200);
});
