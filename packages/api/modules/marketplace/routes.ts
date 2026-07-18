import { Hono } from 'hono';
import { requireRole } from '../../src/middleware/auth';
import { CreateSeatReleaseInput, ClaimSeatInput } from './types';
import { marketplaceService } from './service';
import { db, schema } from '@addis/db';
import { eq, and, gt } from 'drizzle-orm';

export const marketplaceRoutes = new Hono();

marketplaceRoutes.get('/seat-releases', requireRole('rider'), async (c) => {
  const rows = await db.select().from(schema.seatReleases)
    .where(and(eq(schema.seatReleases.status, 'open'), gt(schema.seatReleases.expiresAt, new Date())))
    .limit(Number(c.req.query('limit') ?? 20));
  return c.json({ data: rows });
});
marketplaceRoutes.post('/seat-releases', requireRole('rider'), async (c) => {
  const body = CreateSeatReleaseInput.parse(await c.req.json());
  const row = await marketplaceService.release(c.get('session').userId, body);
  return c.json({ data: row }, 201);
});
marketplaceRoutes.get('/seat-releases/:id', requireRole('rider'), async (c) => {
  const [row] = await db.select().from(schema.seatReleases).where(eq(schema.seatReleases.id, c.req.param('id')));
  return c.json({ data: row });
});
marketplaceRoutes.delete('/seat-releases/:id', requireRole('rider'), async (c) => {
  await marketplaceService.cancelRelease(c.get('session').userId, c.req.param('id'));
  return c.body(null, 204);
});

marketplaceRoutes.get('/seat-claims', requireRole('rider'), async (c) => {
  const rows = await db.select().from(schema.seatClaims).where(eq(schema.seatClaims.riderId, c.get('session').userId));
  return c.json({ data: rows });
});
marketplaceRoutes.post('/seat-claims', requireRole('rider'), async (c) => {
  const body = ClaimSeatInput.parse(await c.req.json());
  const result = await marketplaceService.claim(c.get('session').userId, body);
  return c.json({ data: { claim: result.claim, checkout: result.checkout } }, 201);
});
marketplaceRoutes.get('/seat-claims/:id', requireRole('rider'), async (c) => {
  const [row] = await db.select().from(schema.seatClaims).where(eq(schema.seatClaims.id, c.req.param('id')));
  return c.json({ data: row });
});
