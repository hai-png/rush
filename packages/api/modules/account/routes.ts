import { Hono } from 'hono';
import { accountService } from './service';

export const accountRoutes = new Hono();

accountRoutes.get('/', async (c) => c.json({ data: await accountService.get(c.get('session').userId) }));
accountRoutes.patch('/', async (c) => c.json({ data: await accountService.update(c.get('session').userId, await c.req.json()) }));
accountRoutes.post('/delete', async (c) => { await accountService.requestDeletion(c.get('session').userId); return c.body(null, 202); });
accountRoutes.get('/export', async (c) => {
  const stream = await accountService.exportZip(c.get('session').userId);
  return new Response(stream as any, { headers: { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="addis-ride-export.zip"' } });
});
