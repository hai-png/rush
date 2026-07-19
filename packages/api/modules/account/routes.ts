import { Hono } from 'hono';
import { z } from 'zod';
import { requireAuth } from '../../src/middleware/auth';
import { accountService } from './service';
import { identityService } from '../identity/service';
import { UnauthorizedError } from '@addis/shared';
import { db, schema } from '@addis/db';
import { eq } from 'drizzle-orm';
import { verifyPassword } from '@addis/shared';

export const accountRoutes = new Hono();
accountRoutes.use('*', requireAuth);

const UpdateAccountInput = z.object({
  name: z.string().min(2).optional(),
  homeArea: z.string().optional(),
  workArea: z.string().optional(),
}).strict();

accountRoutes.get('/', async (c) => c.json({ data: await accountService.get(c.get('session').userId) }));
accountRoutes.patch('/', async (c) => c.json({ data: await accountService.update(c.get('session').userId, UpdateAccountInput.parse(await c.req.json())) }));

/**
 * Account deletion — requires password re-authentication.
 *
 * The previous route accepted an empty body and immediately scheduled
 * deletion. Combined with cookie-auth and no CSRF token, an attacker who
 * could plant a cookie (e.g. via XSS in a subdomain) could trigger account
 * deletion. Now the caller must provide their current password, which is
 * verified before deletion proceeds.
 */
accountRoutes.post('/delete', async (c) => {
  const body = z.object({ password: z.string().min(1) }).parse(await c.req.json());
  const session = c.get('session');
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, session.userId));
  if (!user) throw new UnauthorizedError();
  if (!(await verifyPassword(body.password, user.passwordHash))) {
    throw new UnauthorizedError('Password incorrect');
  }
  await accountService.requestDeletion(session.userId);
  return c.body(null, 202);
});

accountRoutes.get('/export', async (c) => {
  const stream = await accountService.exportZip(c.get('session').userId);
  return new Response(stream as any, { headers: { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="addis-ride-export.zip"' } });
});
