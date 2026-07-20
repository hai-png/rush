import { createRoute } from '@hono/zod-openapi';
import { TypedOpenAPIHono } from '../../src/typed-hono';
import { z } from 'zod';
import { ErrorSchema, UnauthorizedError, verifyPassword } from '@addis/shared';
import { requireAuth } from '../../src/middleware/auth';
import { accountService } from './service';
import { db, schema } from '@addis/db';
import { eq } from 'drizzle-orm';

export const accountRoutes = new TypedOpenAPIHono();
accountRoutes.use('*', requireAuth);

const UpdateAccountInput = z.object({
  name: z.string().min(2).optional(),
  homeArea: z.string().optional(),
  workArea: z.string().optional(),
}).strict();

accountRoutes.get('/', async (c) => c.json({ data: await accountService.get(c.get('session')!.userId) }));
accountRoutes.patch('/', async (c) => c.json({ data: await accountService.update(c.get('session')!.userId, UpdateAccountInput.parse(await c.req.json()) as any) }));

const deleteAccountRoute = createRoute({
  method: 'post',
  path: '/delete',
  security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  request: { body: { content: { 'application/json': { schema: z.object({ password: z.string().min(1) }) } } } },
  responses: {
    202: { description: 'Deletion scheduled (30-day grace period)' },
    401: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Password incorrect' },
  },
});

accountRoutes.openapi(deleteAccountRoute, async (c) => {
  const body = c.req.valid('json');
  const session = c.get('session')!;
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, session.userId));
  if (!user) throw new UnauthorizedError();
  if (!(await verifyPassword(body.password, user.passwordHash))) {
    throw new UnauthorizedError('Password incorrect');
  }
  await accountService.requestDeletion(session.userId);
  return c.body(null, 202);
});

accountRoutes.get('/export', async (c) => {
  const stream = await accountService.exportZip(c.get('session')!.userId);
  return new Response(stream as any, { headers: { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="addis-ride-export.zip"' } });
});
