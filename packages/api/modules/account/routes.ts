import { getSession } from '../../src/context';
import { TypedHono } from '../../src/typed-hono';
import { z } from 'zod';
import { requireAuth } from '../../src/middleware/auth';
import { accountService } from './service';

export const accountRoutes = new TypedHono();
accountRoutes.use('*', requireAuth);

const UpdateAccountInput = z.object({
  name: z.string().min(2).optional(),
  homeArea: z.string().optional(),
  workArea: z.string().optional(),
}).strict();

accountRoutes.get('/', async (c) => c.json({ data: await accountService.get(getSession(c).userId) }));
accountRoutes.patch('/', async (c) => c.json({ data: await accountService.update(getSession(c).userId, UpdateAccountInput.parse(await c.req.json())) }));
accountRoutes.post('/delete', async (c) => { await accountService.requestDeletion(getSession(c).userId); return c.body(null, 202); });
accountRoutes.get('/export', async (c) => {
  const stream = await accountService.exportZip(getSession(c).userId);
  return new Response(stream as any, { headers: { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="addis-ride-export.zip"' } });
});
