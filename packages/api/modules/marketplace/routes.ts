import { getSession } from '../../src/context';
import { TypedHono } from '../../src/typed-hono';
import { requireRole } from '../../src/middleware/auth';
import { CreateSeatReleaseInput, ClaimSeatInput } from './types';
import { marketplaceService } from './service';
import { getRiderProfileId } from '../identity/profile-resolver';
import { db, schema } from '@addis/db';
import { eq, and, gt } from 'drizzle-orm';

export const marketplaceRoutes = new TypedHono();

marketplaceRoutes.get('/seat-releases', requireRole('rider'), async (c) => {
  const rows = await db.select().from(schema.seatReleases)
    .where(and(eq(schema.seatReleases.status, 'open'), gt(schema.seatReleases.expiresAt, new Date())))
    .limit(Number(c.req.query('limit') ?? 20));
  return c.json({ data: rows });
});
marketplaceRoutes.post('/seat-releases', requireRole('rider'), async (c) => {
  const body = CreateSeatReleaseInput.parse(await c.req.json());
  // seat_releases.rider_id references rider_profiles.id, NOT users.id.
  const riderId = await getRiderProfileId(getSession(c).userId);
  const row = await marketplaceService.release(riderId, body);
  return c.json({ data: row }, 201);
});
marketplaceRoutes.get('/seat-releases/:id', requireRole('rider'), async (c) => {
  const [row] = await db.select().from(schema.seatReleases).where(eq(schema.seatReleases.id, c.req.param('id')));
  return c.json({ data: row });
});
marketplaceRoutes.delete('/seat-releases/:id', requireRole('rider'), async (c) => {
  const riderId = await getRiderProfileId(getSession(c).userId);
  await marketplaceService.cancelRelease(riderId, c.req.param('id'));
  return c.body(null, 204);
});

marketplaceRoutes.get('/seat-claims', requireRole('rider'), async (c) => {
  const riderId = await getRiderProfileId(getSession(c).userId);
  const rows = await db.select().from(schema.seatClaims).where(eq(schema.seatClaims.riderId, riderId));
  return c.json({ data: rows });
});
marketplaceRoutes.post('/seat-claims', requireRole('rider'), async (c) => {
  const body = ClaimSeatInput.parse(await c.req.json());
  const riderId = await getRiderProfileId(getSession(c).userId);
  const result = await marketplaceService.claim(riderId, body);
  return c.json({ data: { claim: result.claim, checkout: result.checkout } }, 201);
});
marketplaceRoutes.get('/seat-claims/:id', requireRole('rider'), async (c) => {
  const [row] = await db.select().from(schema.seatClaims).where(eq(schema.seatClaims.id, c.req.param('id')));
  return c.json({ data: row });
});
