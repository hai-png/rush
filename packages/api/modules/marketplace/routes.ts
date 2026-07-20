import { TypedOpenAPIHono } from '../../src/typed-hono';
import { requireRole } from '../../src/middleware/auth';
import { CreateSeatReleaseInput, ClaimSeatInput } from './types';
import { marketplaceService } from './service';
import { db, schema } from '@addis/db';
import { eq, and, gt } from 'drizzle-orm';
import { NotFoundError } from '@addis/shared';

export const marketplaceRoutes = new TypedOpenAPIHono();

async function riderProfileIdFor(userId: string): Promise<string> {
  const [profile] = await db.select().from(schema.riderProfiles).where(eq(schema.riderProfiles.userId, userId));
  if (!profile) throw new NotFoundError('Rider profile not found');
  return profile.id;
}

marketplaceRoutes.get('/seat-releases', requireRole('rider'), async (c) => {
  const limit = Math.min(Math.max(1, Number(c.req.query('limit') ?? 20) || 20), 100);
  const rows = await db.select().from(schema.seatReleases)
    .where(and(eq(schema.seatReleases.status, 'open'), gt(schema.seatReleases.expiresAt, new Date())))
    .limit(limit);
  return c.json({ data: rows });
});
marketplaceRoutes.post('/seat-releases', requireRole('rider'), async (c) => {
  const body = CreateSeatReleaseInput.parse(await c.req.json());

  const riderId = await riderProfileIdFor(c.get('session').userId);
  const row = await marketplaceService.release(riderId, body);
  return c.json({ data: row }, 201);
});

marketplaceRoutes.get('/seat-releases/:id', requireRole('rider'), async (c) => {
  const [row] = await db.select().from(schema.seatReleases).where(eq(schema.seatReleases.id, c.req.param('id')));
  if (!row) throw new NotFoundError('Release not found');
  const riderId = await riderProfileIdFor(c.get('session').userId);
  if (row.riderId !== riderId) {

    throw new NotFoundError('Release not found');
  }
  return c.json({ data: row });
});
marketplaceRoutes.delete('/seat-releases/:id', requireRole('rider'), async (c) => {
  const riderId = await riderProfileIdFor(c.get('session').userId);
  await marketplaceService.cancelRelease(riderId, c.req.param('id'));
  return c.body(null, 204);
});

marketplaceRoutes.get('/seat-claims', requireRole('rider'), async (c) => {
  const riderId = await riderProfileIdFor(c.get('session').userId);
  const rows = await db.select().from(schema.seatClaims).where(eq(schema.seatClaims.riderId, riderId));
  return c.json({ data: rows });
});
marketplaceRoutes.post('/seat-claims', requireRole('rider'), async (c) => {
  const body = ClaimSeatInput.parse(await c.req.json());
  const riderId = await riderProfileIdFor(c.get('session').userId);
  const result = await marketplaceService.claim(riderId, body);
  return c.json({ data: { claim: result.claim, checkout: result.checkout } }, 201);
});
marketplaceRoutes.get('/seat-claims/:id', requireRole('rider'), async (c) => {
  const riderId = await riderProfileIdFor(c.get('session').userId);
  const [row] = await db.select().from(schema.seatClaims).where(eq(schema.seatClaims.id, c.req.param('id')));
  if (!row) throw new NotFoundError('Claim not found');
  if (row.riderId !== riderId) throw new NotFoundError('Claim not found');
  return c.json({ data: row });
});
