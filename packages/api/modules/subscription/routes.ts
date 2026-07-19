import { createRoute, z } from '@hono/zod-openapi';
import { TypedOpenAPIHono } from '../../src/typed-hono';
import { ErrorSchema, envelope } from '@addis/shared';
import { requireRole } from '../../src/middleware/auth';
import { CreateSubscriptionInput } from './types';
import { subscriptionService } from './service';
import { db, schema } from '@addis/db';
import { eq } from 'drizzle-orm';
import { NotFoundError } from '@addis/shared';

// FIX (META-020): Migrated from bare OpenAPIHono to TypedOpenAPIHono so
// c.get('session') is typed consistently with the rest of the codebase.
export const subscriptionRoutes = new TypedOpenAPIHono();

const SubscriptionSchema = z.object({
  id: z.string(), riderId: z.string(), planId: z.string(), routeId: z.string().nullable(),
  status: z.string(), ridesUsed: z.number(), startDate: z.string(), endDate: z.string(),
});

/**
 * Resolve the caller's riderProfile.id from their session.userId.
 *
 * The schema FKs `subscriptions.riderId` -> `riderProfiles.id`, but the
 * previous routes passed `session.userId` (which is `users.id`) directly.
 * This caused one of two failure modes depending on FK enforcement:
 *   - FK enforced: every subscription create threw a FK violation.
 *   - FK not enforced: the row was stored with `users.id`, but
 *     `dashboard/service.ts` queries with `riderProfiles.id` — the rider's
 *     dashboard never showed their active subscription.
 * The fix is to look up the riderProfile by userId and use its id.
 */
async function riderProfileIdFor(userId: string): Promise<string> {
  const [profile] = await db.select().from(schema.riderProfiles).where(eq(schema.riderProfiles.userId, userId));
  if (!profile) throw new NotFoundError('Rider profile not found');
  return profile.id;
}

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
